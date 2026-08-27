import type {
  ApiSuccess,
  AuthoringAmendment,
  AuthoringSnapshot,
  BusinessVersion,
  RunSnapshot,
  SemanticWorkspace,
} from './types.js';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as
    | ApiSuccess<T>
    | { detail?: string; title?: string }
    | null;
  if (!response.ok) {
    const problem = body as { detail?: string; title?: string } | null;
    throw new Error(problem?.detail ?? problem?.title ?? `请求失败（${response.status}）`);
  }
  return (body as ApiSuccess<T>).data;
}

function idempotencyKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

export const semanticApi = {
  listVersions(projectId: string) {
    return request<{ versions: BusinessVersion[] }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/business-versions`
    ).then((result) => result.versions);
  },

  getWorkspace(versionId: string) {
    return request<SemanticWorkspace>(
      `/api/v1/business-versions/${encodeURIComponent(versionId)}/workspace`
    );
  },

  createAuthoringJob(input: {
    versionId: string;
    mode: 'repair' | 'recheck' | 'bootstrap';
    intent?: 'author_assets' | 'locate_in_browser';
    targetType?: string;
    targetId?: string;
    currentUrl?: string;
    reason?: string;
  }) {
    return request<{ id: string; taskId: string; browserJobId: string }>(
      `/api/v1/business-versions/${encodeURIComponent(input.versionId)}/authoring-jobs`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey(`authoring:${input.mode}`) },
        body: JSON.stringify({
          schema: 'nebula.ai-e2e.create-authoring-job/1.0',
          mode: input.mode,
          ...(input.intent ? { intent: input.intent } : {}),
          ...(input.targetType ? { targetType: input.targetType } : {}),
          ...(input.targetId ? { targetId: input.targetId } : {}),
          ...(input.currentUrl ? { currentUrl: input.currentUrl } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
          createdBy: 'workspace-user',
        }),
      }
    );
  },

  getAuthoringSnapshot(jobId: string) {
    return request<AuthoringSnapshot>(`/api/v1/authoring-jobs/${encodeURIComponent(jobId)}`);
  },

  commandAuthoringJob(jobId: string, stateVersion: number, action: 'pause' | 'resume' | 'cancel') {
    return request<{ lifecycle: string; stateVersion: number }>(
      `/api/v1/authoring-jobs/${encodeURIComponent(jobId)}/commands`,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey(`authoring:${action}`),
          'If-Match': String(stateVersion),
        },
        body: JSON.stringify({
          schema: 'nebula.ai-e2e.authoring-command/1.0',
          action,
          reason: '工作台人工控制',
          createdBy: 'workspace-user',
        }),
      }
    );
  },

  listAmendments(jobId: string) {
    return request<{ amendments: AuthoringAmendment[] }>(
      `/api/v1/authoring-jobs/${encodeURIComponent(jobId)}/amendments`
    ).then((result) => result.amendments);
  },

  commandAmendment(
    amendmentId: string,
    command: { action: 'queue_at_safe_boundary' } | { action: 'reject'; reason: string }
  ) {
    return request<AuthoringAmendment>(
      `/api/v1/authoring-amendments/${encodeURIComponent(amendmentId)}/commands`,
      { method: 'POST', body: JSON.stringify(command) }
    );
  },

  answerAmendmentDecision(amendmentId: string, decisionId: string, answer: 'approve' | 'reject') {
    return request<AuthoringAmendment>(
      `/api/v1/authoring-amendments/${encodeURIComponent(amendmentId)}/decisions/${encodeURIComponent(decisionId)}/answer`,
      {
        method: 'POST',
        body: JSON.stringify({
          schema: 'nebula.ai-e2e.impact-decision-answer/1.0',
          answer,
          reason: answer === 'approve' ? '工作台人工批准范围扩展' : '工作台人工拒绝范围扩展',
          answeredBy: 'workspace-user',
        }),
      }
    );
  },

  createRun(input: {
    projectId: string;
    businessVersionId: string;
    scenarioRevisionId: string;
    deploymentRevisionId: string;
  }) {
    return request<{
      id: string;
      stateVersion: number;
      lifecycle: string;
      admission: 'ready' | 'approval_required' | 'denied';
    }>(`/api/v1/projects/${encodeURIComponent(input.projectId)}/runs`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey('run') },
      body: JSON.stringify({
        schema: 'nebula.ai-e2e.create-run/1.0',
        businessVersionId: input.businessVersionId,
        scenarioRevisionId: input.scenarioRevisionId,
        deploymentRevisionId: input.deploymentRevisionId,
        inputs: {},
        evidencePolicy: 'default',
      }),
    });
  },

  getRunSnapshot(runId: string) {
    return request<RunSnapshot>(`/api/v1/runs/${encodeURIComponent(runId)}`);
  },

  commandRun(
    runId: string,
    stateVersion: number,
    action: 'start' | 'pause' | 'resume' | 'cancel' | 'close_browser'
  ) {
    return request<Record<string, unknown>>(`/api/v1/runs/${encodeURIComponent(runId)}/commands`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey(`run:${action}`),
        'If-Match': String(stateVersion),
      },
      body: JSON.stringify({
        schema: 'nebula.ai-e2e.run-command/1.0',
        action,
        createdBy: 'workspace-user',
      }),
    });
  },

  answerRunDecision(runId: string, decisionId: string, answerKey: string) {
    return request<Record<string, unknown>>(
      `/api/v1/runs/${encodeURIComponent(runId)}/decisions/${encodeURIComponent(decisionId)}/answer`,
      {
        method: 'POST',
        body: JSON.stringify({
          answerKey,
          reason: '工作台人工决策',
          answeredBy: 'workspace-user',
        }),
      }
    );
  },

  resumeTodo(runId: string, todoId: string) {
    return request<Record<string, unknown>>(
      `/api/v1/runs/${encodeURIComponent(runId)}/todos/${encodeURIComponent(todoId)}/resume`,
      { method: 'POST' }
    );
  },
};
