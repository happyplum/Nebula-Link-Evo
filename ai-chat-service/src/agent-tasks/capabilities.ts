import { AGENT_TASK_LIMITS } from './validation.js';

export function buildAgentTaskCapabilities(
  serviceVersion: string,
  localControlPlane: boolean,
  loadedSkillVersions = 0
) {
  return {
    schema: 'nebula.service-capabilities/1.0' as const,
    service: 'ai-chat-service' as const,
    serviceVersion,
    protocols: {
      'nebula.ai.agent-task': { major: 1, minor: 0 },
      'nebula.ai.skill': { major: 1, minor: 0 },
      'nebula.browser.operation': { major: 1, minor: 0 },
    },
    features: {
      agentTasks: true,
      decisionModelRole: true,
      visionAnalysisTool: 'runtime_dependent',
      modelHiddenBrowserBinding: true,
      structuredOutput: true,
      durableTaskState: true,
      taskEvents: true,
      taskCommands: true,
      skillsRuntime: true,
      operationCaptureArtifacts: true,
      sideEffectAuthorization: 'preauthorized_steps_only',
      operationPresentationAnimation: false,
      localControlPlane,
    },
    limits: {
      maxRequestBytes: AGENT_TASK_LIMITS.requestBytes,
      maxResponseSchemaBytes: AGENT_TASK_LIMITS.responseSchemaBytes,
      maxResponseSchemaDepth: AGENT_TASK_LIMITS.responseSchemaDepth,
      maxDurationMs: AGENT_TASK_LIMITS.maxDurationMs,
      maxModelTurns: AGENT_TASK_LIMITS.maxModelTurns,
      maxToolCalls: AGENT_TASK_LIMITS.maxToolCalls,
      maxTokens: AGENT_TASK_LIMITS.maxTokens,
      maxAllowedTools: AGENT_TASK_LIMITS.maxAllowedTools,
      maxBrowserSteps: AGENT_TASK_LIMITS.maxBrowserSteps,
      maxSkillsPerTask: AGENT_TASK_LIMITS.maxSkillsPerTask,
      loadedSkillVersions,
    },
    generatedAt: new Date().toISOString(),
  };
}

export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
