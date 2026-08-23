import { randomUUID } from 'node:crypto';
import {
  inImmediateTransaction,
  stableStringify,
  type DatabaseLike,
  type SupportedDatabase,
} from './semantic-repository-utils.js';

type DbRow = Record<string, unknown>;

export interface CoordinatorBrowserJob {
  id: string;
  queueSeq: number;
  contextType: 'run' | 'authoring';
  contextId: string;
  state: 'acquiring' | 'active' | 'releasing';
  browserSessionId?: string;
}

export interface CoordinatorTodo {
  runId: string;
  runLifecycle: string;
  runStateVersion: number;
  businessVersionId: string;
  deploymentRevisionId: string;
  browserJobId: string;
  browserSessionId: string;
  policyEvaluationId?: string;
  approvalGrantId?: string;
  todoId: string;
  todoStateVersion: number;
  todoKey: string;
  input: Record<string, unknown>;
  inputSecretRefs: string[];
  authContext: Record<string, unknown>;
  scriptRevisionId: string;
  script: Record<string, unknown>;
  pageRevisionId: string;
  page: Record<string, unknown>;
  deployment: Record<string, unknown>;
}

export interface ActivePageTask {
  pageTaskId: string;
  runId: string;
  runLifecycle: string;
  todoId: string;
  state: string;
  browserSessionId: string;
  tabId: string;
  aiTaskId?: string;
  startedAt: string;
}

export interface ExternalLink {
  id: string;
  service: 'ai_chat_service' | 'proxy_adapter';
  kind: string;
  externalId: string;
  externalState?: string;
  lastExternalSeq?: number;
  resultRef?: string;
  secretRef?: string;
  tokenHash?: string;
  terminal: boolean;
}

export interface CoordinatorAuthoringTask {
  jobId: string;
  jobLifecycle: string;
  businessVersionId: string;
  browserJobId: string;
  browserSessionId: string;
  taskId: string;
  taskKey: string;
  type: string;
  state: 'ready' | 'running';
  targetType?: string;
  targetId?: string;
  input: Record<string, unknown>;
  startedAt?: string;
}

export class SemanticCoordinatorRepository {
  private readonly db: DatabaseLike;

  constructor(database: SupportedDatabase) {
    this.db = database as unknown as DatabaseLike;
  }

  getActiveBrowserJob(): CoordinatorBrowserJob | null {
    const row = this.db
      .prepare(
        `SELECT * FROM browser_jobs
         WHERE state IN ('acquiring','active','releasing')
         ORDER BY queue_seq LIMIT 1`
      )
      .get() as DbRow | undefined;
    return row ? mapBrowserJob(row) : null;
  }

  getVerificationAmendmentToSchedule(): string | null {
    const row = this.db
      .prepare(
        `SELECT amendments.id
         FROM authoring_amendments AS amendments
         JOIN authoring_jobs AS jobs ON jobs.id = amendments.job_id
         JOIN browser_jobs AS browser ON browser.id = jobs.browser_job_id
         LEFT JOIN authoring_tasks AS tasks
           ON tasks.job_id = jobs.id AND tasks.task_key = 'verify-amendment:' || amendments.id
         WHERE amendments.state = 'verifying'
           AND jobs.lifecycle NOT IN ('completed','cancelled','failed')
           AND (
             tasks.id IS NULL OR jobs.lifecycle IN ('paused','waiting_decision')
             OR browser.state IN ('completed','cancelled','failed')
           )
         ORDER BY amendments.created_at LIMIT 1`
      )
      .get() as { id: string } | undefined;
    return row?.id ?? null;
  }

  attachBrowserSession(job: CoordinatorBrowserJob, sessionId: string): void {
    inImmediateTransaction(this.db, () => {
      if (job.contextType === 'run') {
        const run = this.db
          .prepare('SELECT browser_job_id, browser_session_id, state_version, next_event_seq FROM test_runs WHERE id = ?')
          .get(job.contextId) as DbRow | undefined;
        if (!run || run.browser_job_id !== job.id) throw new Error('Browser job does not own the run');
        if (run.browser_session_id && run.browser_session_id !== sessionId) {
          throw new Error('Run is already attached to another browser session');
        }
        if (!run.browser_session_id) {
          const now = new Date().toISOString();
          const nextVersion = Number(run.state_version) + 1;
          const seq = Number(run.next_event_seq);
          this.db
            .prepare(
              `UPDATE test_runs SET browser_session_id = ?, state_version = ?, next_event_seq = ?
               WHERE id = ?`
            )
            .run(sessionId, nextVersion, seq + 1, job.contextId);
          this.db
            .prepare(
              `INSERT INTO run_events
                (id, run_id, seq, schema_version, type, entity_type, entity_id,
                 state_version, payload_json, occurred_at, created_at)
               VALUES (?, ?, ?, 1, 'browser_session.attached', 'run', ?, ?, ?, ?, ?)`
            )
            .run(
              randomUUID(),
              job.contextId,
              seq,
              job.contextId,
              nextVersion,
              stableStringify({ browserJobId: job.id, browserSessionId: sessionId }),
              now,
              now
            );
        }
      }
    });
  }

  getReadyTodo(jobId: string): CoordinatorTodo | null {
    const row = this.db
      .prepare(
        `SELECT runs.id AS run_id, runs.lifecycle AS run_lifecycle,
                runs.state_version AS run_state_version,
                runs.business_version_id, runs.deployment_revision_id,
                runs.browser_job_id, runs.browser_session_id,
                runs.current_policy_evaluation_id, runs.active_approval_grant_id,
                todos.id AS todo_id, todos.state_version AS todo_state_version,
                todos.todo_key, todos.input_json_redacted, todos.input_secret_refs_json,
                todos.auth_context_json,
                todos.functional_script_revision_id AS script_revision_id,
                scripts.payload_json AS script_payload_json,
                todos.page_definition_revision_id AS page_revision_id,
                pages.payload_json AS page_payload_json,
                deployments.payload_json AS deployment_payload_json
         FROM test_runs AS runs
         JOIN run_todos AS todos ON todos.run_id = runs.id
         JOIN functional_script_revisions AS scripts
           ON scripts.id = todos.functional_script_revision_id
         JOIN page_definition_revisions AS pages
           ON pages.id = todos.page_definition_revision_id
         JOIN deployment_profile_revisions AS deployments
           ON deployments.id = runs.deployment_revision_id
         WHERE runs.browser_job_id = ? AND runs.lifecycle = 'running'
           AND runs.browser_session_id IS NOT NULL AND todos.state = 'ready'
           AND NOT EXISTS (
             SELECT 1 FROM page_tasks
             WHERE run_id = runs.id AND state IN ('created','running','paused')
           )
         ORDER BY todos.rowid LIMIT 1`
      )
      .get(jobId) as DbRow | undefined;
    return row ? mapCoordinatorTodo(row) : null;
  }

  getTodoForPageTask(pageTaskId: string): CoordinatorTodo | null {
    const row = this.db
      .prepare(
        `SELECT runs.id AS run_id, runs.lifecycle AS run_lifecycle,
                runs.state_version AS run_state_version,
                runs.business_version_id, runs.deployment_revision_id,
                runs.browser_job_id, runs.browser_session_id,
                runs.current_policy_evaluation_id, runs.active_approval_grant_id,
                todos.id AS todo_id, todos.state_version AS todo_state_version,
                todos.todo_key, todos.input_json_redacted, todos.input_secret_refs_json,
                todos.auth_context_json,
                todos.functional_script_revision_id AS script_revision_id,
                scripts.payload_json AS script_payload_json,
                todos.page_definition_revision_id AS page_revision_id,
                pages.payload_json AS page_payload_json,
                deployments.payload_json AS deployment_payload_json
         FROM page_tasks AS tasks
         JOIN test_runs AS runs ON runs.id = tasks.run_id
         JOIN run_todos AS todos ON todos.id = json_extract(tasks.todo_ids_json, '$[0]')
         JOIN functional_script_revisions AS scripts
           ON scripts.id = todos.functional_script_revision_id
         JOIN page_definition_revisions AS pages
           ON pages.id = todos.page_definition_revision_id
         JOIN deployment_profile_revisions AS deployments
           ON deployments.id = runs.deployment_revision_id
         WHERE tasks.id = ?`
      )
      .get(pageTaskId) as DbRow | undefined;
    return row ? mapCoordinatorTodo(row) : null;
  }

  getActivePageTask(jobId: string): ActivePageTask | null {
    const row = this.db
      .prepare(
        `SELECT tasks.id AS page_task_id, tasks.run_id, runs.lifecycle AS run_lifecycle,
                json_extract(tasks.todo_ids_json, '$[0]') AS todo_id,
                tasks.state, tasks.browser_session_id, tasks.tab_id, tasks.ai_task_id,
                tasks.started_at
         FROM page_tasks AS tasks
         JOIN test_runs AS runs ON runs.id = tasks.run_id
         WHERE runs.browser_job_id = ? AND tasks.state IN ('created','running','paused')
         ORDER BY tasks.task_no DESC LIMIT 1`
      )
      .get(jobId) as DbRow | undefined;
    if (!row) return null;
    return {
      pageTaskId: String(row.page_task_id),
      runId: String(row.run_id),
      runLifecycle: String(row.run_lifecycle),
      todoId: String(row.todo_id),
      state: String(row.state),
      browserSessionId: String(row.browser_session_id),
      tabId: String(row.tab_id),
      ...(row.ai_task_id ? { aiTaskId: String(row.ai_task_id) } : {}),
      startedAt: String(row.started_at),
    };
  }

  getAuthoringTask(jobId: string, state: 'ready' | 'running'): CoordinatorAuthoringTask | null {
    const row = this.db
      .prepare(
        `SELECT jobs.id AS job_id, jobs.lifecycle AS job_lifecycle,
                jobs.business_version_id, jobs.browser_job_id,
                browser.browser_session_id,
                tasks.id AS task_id, tasks.task_key, tasks.type, tasks.state,
                tasks.target_type, tasks.target_id, tasks.input_json_redacted,
                tasks.started_at
         FROM authoring_jobs AS jobs
         JOIN browser_jobs AS browser ON browser.id = jobs.browser_job_id
         JOIN authoring_tasks AS tasks ON tasks.job_id = jobs.id
         WHERE jobs.id = ? AND browser.state = 'active'
           AND browser.browser_session_id IS NOT NULL AND tasks.state = ?
         ORDER BY tasks.created_at LIMIT 1`
      )
      .get(jobId, state) as DbRow | undefined;
    if (!row) return null;
    return {
      jobId: String(row.job_id),
      jobLifecycle: String(row.job_lifecycle),
      businessVersionId: String(row.business_version_id),
      browserJobId: String(row.browser_job_id),
      browserSessionId: String(row.browser_session_id),
      taskId: String(row.task_id),
      taskKey: String(row.task_key),
      type: String(row.type),
      state,
      ...(row.target_type ? { targetType: String(row.target_type) } : {}),
      ...(row.target_id ? { targetId: String(row.target_id) } : {}),
      input: parseObject(row.input_json_redacted),
      ...(row.started_at ? { startedAt: String(row.started_at) } : {}),
    };
  }

  getAuthoringExternalLink(taskId: string, kind: 'agent_task' | 'browser_lease'): ExternalLink | null {
    const row = this.db
      .prepare(
        `SELECT * FROM external_task_links
         WHERE authoring_task_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(taskId, kind) as DbRow | undefined;
    return row ? mapExternalLink(row) : null;
  }

  getAuthoringJobLifecycle(jobId: string): string | null {
    const row = this.db.prepare('SELECT lifecycle FROM authoring_jobs WHERE id = ?').get(jobId) as
      | { lifecycle: string }
      | undefined;
    return row?.lifecycle ?? null;
  }

  setPageTaskAgentTask(pageTaskId: string, agentTaskId: string): void {
    const result = this.db
      .prepare(
        `UPDATE page_tasks SET ai_task_id = COALESCE(ai_task_id, ?)
         WHERE id = ? AND state IN ('created','running','paused')
           AND (ai_task_id IS NULL OR ai_task_id = ?)`
      )
      .run(agentTaskId, pageTaskId, agentTaskId);
    if (Number(result.changes) !== 1) throw new Error('Active page task could not accept Agent task');
  }

  getExternalLink(pageTaskId: string, kind: 'agent_task' | 'browser_lease'): ExternalLink | null {
    const row = this.db
      .prepare(
        `SELECT * FROM external_task_links
         WHERE page_task_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(pageTaskId, kind) as DbRow | undefined;
    return row ? mapExternalLink(row) : null;
  }

  getRunBrowserSession(runId: string): { jobId: string; sessionId: string; jobState: string } | null {
    const row = this.db
      .prepare(
        `SELECT runs.browser_job_id, runs.browser_session_id, jobs.state
         FROM test_runs AS runs JOIN browser_jobs AS jobs ON jobs.id = runs.browser_job_id
         WHERE runs.id = ? AND runs.browser_session_id IS NOT NULL`
      )
      .get(runId) as DbRow | undefined;
    return row
      ? {
          jobId: String(row.browser_job_id),
          sessionId: String(row.browser_session_id),
          jobState: String(row.state),
        }
      : null;
  }

  getRunLifecycle(runId: string): string | null {
    const row = this.db.prepare('SELECT lifecycle FROM test_runs WHERE id = ?').get(runId) as
      | { lifecycle: string }
      | undefined;
    return row?.lifecycle ?? null;
  }

  pauseRunForCoordinator(runId: string, reason: Record<string, unknown>): void {
    inImmediateTransaction(this.db, () => {
      const row = this.db
        .prepare('SELECT lifecycle, state_version, next_event_seq FROM test_runs WHERE id = ?')
        .get(runId) as DbRow | undefined;
      if (!row || !['ready', 'running'].includes(String(row.lifecycle))) return;
      const now = new Date().toISOString();
      const nextVersion = Number(row.state_version) + 1;
      const seq = Number(row.next_event_seq);
      this.db
        .prepare(
          `UPDATE test_runs SET lifecycle = 'paused', state_version = ?, next_event_seq = ?,
             pause_reason_json = ? WHERE id = ?`
        )
        .run(nextVersion, seq + 1, stableStringify(reason), runId);
      this.db
        .prepare(
          `INSERT INTO run_events
            (id, run_id, seq, schema_version, type, entity_type, entity_id,
             state_version, payload_json, occurred_at, created_at)
           VALUES (?, ?, ?, 1, 'run.coordinator_paused', 'run', ?, ?, ?, ?, ?)`
        )
        .run(randomUUID(), runId, seq, runId, nextVersion, stableStringify(reason), now, now);
    });
  }
}

function mapBrowserJob(row: DbRow): CoordinatorBrowserJob {
  return {
    id: String(row.id),
    queueSeq: Number(row.queue_seq),
    contextType: row.root_context_type as CoordinatorBrowserJob['contextType'],
    contextId: String(row.root_context_id),
    state: row.state as CoordinatorBrowserJob['state'],
    ...(row.browser_session_id ? { browserSessionId: String(row.browser_session_id) } : {}),
  };
}

function mapCoordinatorTodo(row: DbRow): CoordinatorTodo {
  return {
    runId: String(row.run_id),
    runLifecycle: String(row.run_lifecycle),
    runStateVersion: Number(row.run_state_version),
    businessVersionId: String(row.business_version_id),
    deploymentRevisionId: String(row.deployment_revision_id),
    browserJobId: String(row.browser_job_id),
    browserSessionId: String(row.browser_session_id),
    ...(row.current_policy_evaluation_id
      ? { policyEvaluationId: String(row.current_policy_evaluation_id) }
      : {}),
    ...(row.active_approval_grant_id
      ? { approvalGrantId: String(row.active_approval_grant_id) }
      : {}),
    todoId: String(row.todo_id),
    todoStateVersion: Number(row.todo_state_version),
    todoKey: String(row.todo_key),
    input: parseObject(row.input_json_redacted),
    inputSecretRefs: parseArray(row.input_secret_refs_json).filter(
      (value): value is string => typeof value === 'string'
    ),
    authContext: parseObject(row.auth_context_json),
    scriptRevisionId: String(row.script_revision_id),
    script: parseObject(row.script_payload_json),
    pageRevisionId: String(row.page_revision_id),
    page: parseObject(row.page_payload_json),
    deployment: parseObject(row.deployment_payload_json),
  };
}

function mapExternalLink(row: DbRow): ExternalLink {
  return {
    id: String(row.id),
    service: row.service as ExternalLink['service'],
    kind: String(row.kind),
    externalId: String(row.external_id),
    ...(row.external_state ? { externalState: String(row.external_state) } : {}),
    ...(row.last_external_seq !== null && row.last_external_seq !== undefined
      ? { lastExternalSeq: Number(row.last_external_seq) }
      : {}),
    ...(row.result_ref ? { resultRef: String(row.result_ref) } : {}),
    ...(row.secret_ref ? { secretRef: String(row.secret_ref) } : {}),
    ...(row.token_hash ? { tokenHash: String(row.token_hash) } : {}),
    terminal: Boolean(row.terminal_at),
  };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseArray(value: unknown): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}
