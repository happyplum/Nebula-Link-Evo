import { describe, expect, it } from 'vitest';
import { validateCreateAgentTaskRequest, validateResponseValue } from './validation.js';

function validRequest() {
  return {
    schema: 'nebula.ai.agent-task/1.0',
    clientTaskId: 'client-1',
    modelRole: 'decision',
    input: { objective: '检查登录页', passwordRef: 'secret://login/password' },
    responseSchema: {
      type: 'object',
      properties: { passed: { type: 'boolean' }, note: { type: 'string', maxLength: 100 } },
      required: ['passed'],
      additionalProperties: false,
    },
    toolPolicy: { allow: [] },
    skillPolicy: { allow: [] },
    budgets: { maxDurationMs: 30_000, maxModelTurns: 3, maxToolCalls: 2, maxTokens: 1_000 },
  };
}

describe('Agent task validation', () => {
  it('normalizes a valid request and produces a stable hash', () => {
    const first = validateCreateAgentTaskRequest(validRequest());
    const second = validateCreateAgentTaskRequest(validRequest());

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.request.responseSchema.additionalProperties).toBe(false);
  });

  it('accepts one exact Skill pin and rejects ambiguous multi-Skill composition', () => {
    const request = validRequest();
    request.skillPolicy.allow = [
      {
        skillId: 'document.requirements_extract',
        version: '1.0.0',
        contentHash: 'a'.repeat(64),
      },
    ] as never;
    expect(validateCreateAgentTaskRequest(request).request.skillPolicy.allow).toHaveLength(1);
    request.skillPolicy.allow.push({
      skillId: 'test.failure_classify',
      version: '1.0.0',
      contentHash: 'b'.repeat(64),
    } as never);
    expect(() => validateCreateAgentTaskRequest(request)).toThrow('at most 1 Skill');
  });

  it('rejects inline secrets but permits secret references', () => {
    const request = validRequest();
    request.input = { password: 'plaintext' } as typeof request.input;

    expect(() => validateCreateAgentTaskRequest(request)).toThrow(
      'must be supplied as a secret reference'
    );
  });

  it('requires a hidden binding and immutable step constraints for browser execution', () => {
    const request = validRequest();
    request.toolPolicy.allow = ['browser-control.operation_execute'];

    expect(() => validateCreateAgentTaskRequest(request)).toThrow('browserBinding is required');
  });

  it('rejects tool constraints that this phase cannot enforce', () => {
    const request = validRequest();
    request.toolPolicy = {
      allow: ['vision.resolve_target'],
      constraints: { 'vision.resolve_target': { maxCalls: 1 } },
    } as typeof request.toolPolicy;

    expect(() => validateCreateAgentTaskRequest(request)).toThrow(
      'only implemented for browser-control.operation_execute'
    );
  });

  it('accepts screenshot/DOM capture and rejects unsupported video capture', () => {
    const request = {
      ...validRequest(),
      browserBinding: {
        browserSessionId: 'session-1',
        tabId: 'tab-1',
        browserLeaseId: 'lease-1',
        browserLeaseToken: 'secret',
        browserLeaseSequence: 1,
        access: 'observe',
      },
      toolPolicy: {
        allow: ['browser-control.operation_execute'],
        constraints: {
          'browser-control.operation_execute': {
            steps: [
              {
                stepId: 'state',
                kind: 'observe',
                operation: 'page_state',
                capture: { beforeScreenshot: true, afterScreenshot: true, domSnapshot: true },
              },
            ],
          },
        },
      },
    };

    expect(
      validateCreateAgentTaskRequest(request).browserSteps.get('state')?.capture
    ).toMatchObject({ beforeScreenshot: true, afterScreenshot: true, domSnapshot: true });
    request.toolPolicy.constraints['browser-control.operation_execute'].steps[0].capture = {
      videoSegment: true,
    };
    expect(() => validateCreateAgentTaskRequest(request)).toThrow('video capture is not available');
  });

  it('redacts the lease token and blocks actions on observe bindings', () => {
    const request = {
      ...validRequest(),
      browserBinding: {
        browserSessionId: 'session-1',
        tabId: 'tab-1',
        browserLeaseId: 'lease-1',
        browserLeaseToken: 'top-secret',
        browserLeaseSequence: 2,
        access: 'observe',
      },
      toolPolicy: {
        allow: ['browser-control.operation_execute'],
        constraints: {
          'browser-control.operation_execute': {
            steps: [{ stepId: 'click-login', kind: 'act', operation: 'click' }],
          },
        },
      },
    };

    expect(() => validateCreateAgentTaskRequest(request)).toThrow(
      'Observe binding cannot authorize act step'
    );
    request.browserBinding.access = 'control';
    const validated = validateCreateAgentTaskRequest(request);
    expect(JSON.stringify(validated.persistedRequest)).not.toContain('top-secret');
    expect(validated.browserSteps.get('click-login')?.operation).toBe('click');
  });

  it('requires an exact policy/grant intersection for effect-bearing steps', () => {
    const request = {
      ...validRequest(),
      correlation: { runId: 'run-1' },
      browserBinding: {
        browserSessionId: 'session-1',
        tabId: 'tab-1',
        browserLeaseId: 'lease-1',
        browserLeaseToken: 'secret',
        browserLeaseSequence: 1,
        access: 'control' as const,
      },
      toolPolicy: {
        allow: ['browser-control.operation_execute'],
        constraints: {
          'browser-control.operation_execute': {
            steps: [
              {
                stepId: 'delete-one',
                kind: 'act',
                operation: 'click',
                effectId: 'effect-delete',
                maxAffectedItems: 1,
              },
            ],
          },
        },
      },
    };
    expect(() => validateCreateAgentTaskRequest(request)).toThrow('sideEffectAuthorization');

    const authorized = {
      ...request,
      sideEffectAuthorization: {
        contextType: 'run' as const,
        contextId: 'run-1',
        environment: 'staging' as const,
        policyVersion: 'side-effect-policy/1.0',
        policyEvaluationId: 'evaluation-1',
        policyResult: 'approval_required' as const,
        projectionSha256: 'a'.repeat(64),
        effects: [
          {
            stepId: 'delete-one',
            effectId: 'effect-delete',
            kind: 'delete' as const,
            maxAffectedItems: 1,
            reversibility: 'compensatable' as const,
          },
        ],
        grant: {
          grantId: 'grant-1',
          status: 'active' as const,
          approvedProjectionSha256: 'a'.repeat(64),
        },
      },
    };
    expect(
      validateCreateAgentTaskRequest(authorized).request.sideEffectAuthorization
    ).toBeDefined();
    authorized.sideEffectAuthorization.grant.approvedProjectionSha256 = 'b'.repeat(64);
    expect(() => validateCreateAgentTaskRequest(authorized)).toThrow('inactive or stale');
  });

  it('validates structured response values deterministically', () => {
    const schema = validRequest().responseSchema;
    expect(() => validateResponseValue(schema, { passed: true, note: 'ok' })).not.toThrow();
    expect(() => validateResponseValue(schema, { passed: true, extra: 1 })).toThrow(
      'is not allowed'
    );
    expect(() => validateResponseValue(schema, { passed: 'yes' })).toThrow('must be boolean');
  });
});
