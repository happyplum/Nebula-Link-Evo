import type { AgentTaskBrowserStep } from '@nebula-link-evo/shared/types/agent-task';
import type { SemanticAssetType, SemanticWorkspaceV1 } from '../contracts/semantic-control.js';
import { buildSemanticBrowserSteps } from '../services/semantic-task-projection.js';
import { collectSideEffects, type PlannedEffect } from './side-effect-policy.js';
import { hashValue } from '../database/repositories/semantic-repository-utils.js';

export interface VerificationCandidate {
  assetType: SemanticAssetType;
  assetId: string;
  revisionId: string;
  payload: Record<string, unknown>;
}

/** Authoring verifies each referenced script once, independently of scenario repeats. */
export function buildAuthoringVerificationPlan(
  candidates: VerificationCandidate[],
  workspace: SemanticWorkspaceV1
) {
  const scripts = candidates.filter((candidate) => candidate.assetType === 'functional_script');
  const scheduled = new Set(scripts.map((script) => script.assetId));
  for (const scenario of candidates.filter(
    (candidate) => candidate.assetType === 'test_scenario'
  )) {
    for (const call of Array.isArray(scenario.payload.calls) ? scenario.payload.calls : []) {
      if (!call || typeof call !== 'object') throw new Error('候选场景调用无效');
      const scriptId = (call as Record<string, unknown>).functionalScriptId;
      if (typeof scriptId !== 'string') throw new Error('候选场景缺少脚本');
      if (scheduled.has(scriptId)) continue;
      const script = workspace.functionalScripts.find((entry) => entry.id === scriptId);
      if (!script) throw new Error('候选场景引用的脚本不存在');
      scripts.push({
        assetType: 'functional_script',
        assetId: scriptId,
        revisionId: script.currentRevision.id,
        payload: script.currentRevision.payload,
      });
      scheduled.add(scriptId);
    }
  }
  const effects: PlannedEffect[] = [];
  const steps = scripts.flatMap((script, scriptIndex) => {
    const declarations = collectSideEffects(script.payload, script.assetId, script.revisionId, 1);
    return buildSemanticBrowserSteps(script.payload).map((step, stepIndex) => {
      const stepId = `verify-${scriptIndex + 1}-${stepIndex + 1}-${step.stepId}`.slice(0, 120);
      if (step.effectId) {
        const effect = declarations.find(
          (entry) => entry.effectId === step.effectId && entry.stepId === step.stepId
        );
        if (!effect) throw new Error('验证步骤缺少精确副作用声明');
        effects.push({ ...effect, stepId });
      }
      return { ...step, stepId };
    });
  });
  if (steps.length > 100) throw new Error('候选验证展开后超过 Agent task 的 100 步上限');
  if (steps.length === 0)
    steps.push({
      stepId: 'verify-current-page',
      kind: 'observe',
      operation: 'page_state',
      capture: { domSnapshot: true, afterScreenshot: true },
    } as AgentTaskBrowserStep);
  return {
    steps,
    effects,
    scriptHashes: scripts.map((script) => ({
      assetId: script.assetId,
      revisionId: script.revisionId,
      payloadSha256: hashValue(script.payload),
    })),
  };
}
