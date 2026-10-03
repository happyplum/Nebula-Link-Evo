import type {
  CreateRunRequest,
  FormalRunCreationResult,
  RunCommandRequest,
  RunDecisionAnswerRequest,
} from '../../../../src/contracts/semantic-run.js';
import type { BusinessVersion } from '../../../../src/contracts/business-version.js';
import type {
  AmendmentRecord as AuthoringAmendment,
  CreateAuthoringJobRequest,
  CreateAuthoringJobResult,
  AuthoringCommandRequest,
  AuthoringCommandResult,
  AmendmentCommandRequest,
  AmendmentDecisionAnswerRequest,
} from '../../../../src/contracts/semantic-authoring.js';
import type {
  AuthoringSnapshotV1 as AuthoringSnapshot,
  RunSnapshotV1 as RunSnapshot,
  SemanticWorkspaceV1 as SemanticWorkspace,
} from '../../../../src/contracts/semantic-control.js';

import { requestJson } from '../../shared/api/request.js';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await requestJson<T>(path, init)).data;
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

  createAuthoringJob(
    input: { versionId: string } & Omit<
      CreateAuthoringJobRequest,
      'schema' | 'createdBy' | 'parentRunId'
    >
  ) {
    return request<CreateAuthoringJobResult>(
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
        } satisfies CreateAuthoringJobRequest),
      }
    );
  },

  getAuthoringSnapshot(jobId: string) {
    return request<AuthoringSnapshot>(`/api/v1/authoring-jobs/${encodeURIComponent(jobId)}`);
  },

  commandAuthoringJob(
    jobId: string,
    stateVersion: number,
    action: AuthoringCommandRequest['action']
  ) {
    return request<AuthoringCommandResult>(
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
        } satisfies AuthoringCommandRequest),
      }
    );
  },

  listAmendments(jobId: string) {
    return request<{ amendments: AuthoringAmendment[] }>(
      `/api/v1/authoring-jobs/${encodeURIComponent(jobId)}/amendments`
    ).then((result) => result.amendments);
  },

  commandAmendment(amendmentId: string, command: AmendmentCommandRequest) {
    return request<AuthoringAmendment>(
      `/api/v1/authoring-amendments/${encodeURIComponent(amendmentId)}/commands`,
      { method: 'POST', body: JSON.stringify(command) }
    );
  },

  answerAmendmentDecision(
    amendmentId: string,
    decisionId: string,
    answer: AmendmentDecisionAnswerRequest['answer']
  ) {
    return request<AuthoringAmendment>(
      `/api/v1/authoring-amendments/${encodeURIComponent(amendmentId)}/decisions/${encodeURIComponent(decisionId)}/answer`,
      {
        method: 'POST',
        body: JSON.stringify({
          schema: 'nebula.ai-e2e.impact-decision-answer/1.0',
          answer,
          reason: answer === 'approve' ? '工作台人工批准范围扩展' : '工作台人工拒绝范围扩展',
          answeredBy: 'workspace-user',
        } satisfies AmendmentDecisionAnswerRequest),
      }
    );
  },

  createRun(
    input: { projectId: string } & Pick<
      CreateRunRequest,
      'businessVersionId' | 'scenarioRevisionId' | 'deploymentRevisionId'
    >
  ) {
    return request<FormalRunCreationResult>(
      `/api/v1/projects/${encodeURIComponent(input.projectId)}/runs`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey('run') },
        body: JSON.stringify({
          schema: 'nebula.ai-e2e.create-run/1.0',
          businessVersionId: input.businessVersionId,
          scenarioRevisionId: input.scenarioRevisionId,
          deploymentRevisionId: input.deploymentRevisionId,
          inputs: {},
          evidencePolicy: 'default',
        } satisfies CreateRunRequest),
      }
    );
  },

  getRunSnapshot(runId: string) {
    return request<RunSnapshot>(`/api/v1/runs/${encodeURIComponent(runId)}`);
  },

  commandRun(runId: string, stateVersion: number, action: RunCommandRequest['action']) {
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
      } satisfies RunCommandRequest),
    });
  },

  answerRunDecision(
    runId: string,
    decisionId: string,
    answerKey: RunDecisionAnswerRequest['answerKey']
  ) {
    return request<Record<string, unknown>>(
      `/api/v1/runs/${encodeURIComponent(runId)}/decisions/${encodeURIComponent(decisionId)}/answer`,
      {
        method: 'POST',
        body: JSON.stringify({
          answerKey,
          reason: '工作台人工决策',
          answeredBy: 'workspace-user',
        } satisfies RunDecisionAnswerRequest),
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
