import { describe, expect, it } from 'vitest';
import type { SemanticWorkspaceV1 } from '../../contracts/semantic-control.js';
import { functionalScriptFixture } from '../../test-support/functional-script-fixture.js';
import { buildAuthoringVerificationPlan } from '../authoring-verification-plan.js';

describe('Authoring verification risk projection', () => {
  it('deduplicates scenario references without repeats and binds colliding effect IDs to each executed script', () => {
    const script = (resourceType: string, kind: string) =>
      functionalScriptFixture({
        steps: [
          {
            id: 'write',
            name: '受控动作',
            intent: '执行声明动作',
            action: {
              type: 'click',
              target: {
                semantic: '提交',
                candidates: [
                  { strategy: 'role', role: 'button', name: { kind: 'literal', value: '提交' } },
                ],
                expected: { cardinality: 'exactly_one' },
              },
            },
            sideEffectId: 'same-effect',
            postconditions: [],
          },
        ],
        sideEffects: [
          {
            id: 'same-effect',
            kind,
            resourceType,
            affectedItems: { kind: 'single' },
            reversibility: 'compensatable',
          },
        ],
      });
    const candidatePayload = script('candidate-resource', 'create');
    const workspace = {
      functionalScripts: [
        {
          id: 'referenced',
          currentRevision: {
            id: 'referenced-revision',
            payload: script('referenced-resource', 'delete'),
          },
        },
        {
          id: 'unrelated',
          currentRevision: {
            id: 'unrelated-revision',
            payload: script('unrelated-resource', 'delete'),
          },
        },
      ],
    } as unknown as SemanticWorkspaceV1;
    const plan = buildAuthoringVerificationPlan(
      [
        {
          assetType: 'functional_script',
          assetId: 'candidate',
          revisionId: 'candidate-revision',
          payload: candidatePayload,
        },
        {
          assetType: 'test_scenario',
          assetId: 'scenario',
          revisionId: 'scenario-revision',
          payload: {
            calls: [
              { functionalScriptId: 'candidate', repeat: 100 },
              { functionalScriptId: 'referenced', repeat: 50 },
              { functionalScriptId: 'referenced', repeat: 20 },
            ],
          },
        },
      ],
      workspace
    );
    expect(plan.effects).toMatchObject([
      {
        scriptRevisionId: 'candidate-revision',
        effectId: 'same-effect',
        kind: 'create',
        resourceType: 'candidate-resource',
        maxAffectedItems: 1,
      },
      {
        scriptRevisionId: 'referenced-revision',
        effectId: 'same-effect',
        kind: 'delete',
        resourceType: 'referenced-resource',
        maxAffectedItems: 1,
      },
    ]);
    expect(plan.effects).toHaveLength(2);
    expect(new Set(plan.effects.map((effect) => effect.stepId)).size).toBe(2);
    expect(plan.scriptHashes.map((entry) => entry.assetId)).toEqual(['candidate', 'referenced']);
  });
});
