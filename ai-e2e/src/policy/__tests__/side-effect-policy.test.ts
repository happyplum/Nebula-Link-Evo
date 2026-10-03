import { describe, expect, it } from 'vitest';
import { collectSideEffects, evaluateSideEffectPolicy } from '../side-effect-policy.js';
import { sideEffectPolicyCases } from '../../test-support/side-effect-policy-cases.js';

describe('shared side-effect policy', () => {
  it.each(sideEffectPolicyCases)(
    '$environment $kind => $result',
    ({ environment, kind, reversibility, result }) => {
      expect(
        evaluateSideEffectPolicy(environment, {
          effects: [{ kind, reversibility, maxAffectedItems: 1 }],
        }).result
      ).toBe(result);
    }
  );
  it.each(['local', 'test', 'staging', 'production'])(
    'rejects an unbounded effect in %s',
    (environment) => {
      expect(
        evaluateSideEffectPolicy(environment, {
          effects: [{ kind: 'create', reversibility: 'compensatable', maxAffectedItems: Infinity }],
        }).result
      ).toBe('denied');
    }
  );
  it.each([{ maxAffectedItems: 2 }, { reversibility: 'irreversible' }, { usesFileUpload: true }])(
    'requires a staging grant for %j',
    (risk) => {
      expect(
        evaluateSideEffectPolicy('staging', {
          effects: [
            { kind: 'create', reversibility: 'compensatable', maxAffectedItems: 1, ...risk },
          ],
        }).result
      ).toBe('approval_required');
    }
  );
  it('rejects a production upload even when mislabeled as auth_change', () => {
    expect(
      evaluateSideEffectPolicy('production', {
        effects: [
          {
            kind: 'auth_change',
            reversibility: 'reversible',
            maxAffectedItems: 1,
            usesFileUpload: true,
          },
        ],
      }).result
    ).toBe('denied');
  });
  it('requires declarations and declaration bounds, and applies Run repeats exactly once', () => {
    const script = {
      steps: [{ id: 's', sideEffectId: 'e', action: { type: 'click' } }],
      sideEffects: [
        {
          id: 'e',
          kind: 'create',
          resourceType: 'order',
          reversibility: 'compensatable',
          affectedItems: { kind: 'single' },
        },
      ],
    };
    expect(collectSideEffects(script, 'call', 'revision', 2)[0].maxAffectedItems).toBe(2);
    expect(() => collectSideEffects({ ...script, sideEffects: [] }, 'call', 'revision', 1)).toThrow(
      /not declared/
    );
    expect(() =>
      collectSideEffects(
        {
          ...script,
          sideEffects: [{ ...script.sideEffects[0], affectedItems: { kind: 'bounded' } }],
        },
        'call',
        'revision',
        1
      )
    ).toThrow(/finite/);
  });
});
