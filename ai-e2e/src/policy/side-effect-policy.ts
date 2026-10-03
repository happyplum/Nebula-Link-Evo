import { DomainError } from '../services/service-error.js';

export const SIDE_EFFECT_POLICY_VERSION = 'side-effect-policy/1.0';
export type PolicyResult = 'auto_allowed' | 'approval_required' | 'denied';
export interface PlannedEffect {
  stepId: string;
  effectId: string;
  kind: 'create' | 'update' | 'delete' | 'auth_change';
  resourceType: string;
  maxAffectedItems: number;
  reversibility: 'reversible' | 'compensatable' | 'irreversible';
  usesFileUpload: boolean;
  [key: string]: unknown;
}

export function evaluateSideEffectPolicy(
  environment: string,
  projection: { effects: Array<Record<string, unknown>> }
): { result: PolicyResult; reasonCodes: string[] } {
  if (!['local', 'test', 'staging', 'production'].includes(environment)) {
    return { result: 'denied', reasonCodes: ['environment_invalid'] };
  }
  if (
    projection.effects.some(
      (effect) =>
        !['create', 'update', 'delete', 'auth_change'].includes(String(effect.kind)) ||
        !['reversible', 'compensatable', 'irreversible'].includes(String(effect.reversibility)) ||
        !Number.isSafeInteger(effect.maxAffectedItems) ||
        Number(effect.maxAffectedItems) < 1
    )
  ) {
    return { result: 'denied', reasonCodes: ['side_effect_bound_invalid'] };
  }
  if (
    environment === 'production' &&
    projection.effects.some(
      (effect) => effect.kind !== 'auth_change' || effect.usesFileUpload === true
    )
  ) {
    return { result: 'denied', reasonCodes: ['production_business_write_denied'] };
  }
  if (
    environment === 'staging' &&
    projection.effects.some(
      (effect) =>
        effect.kind === 'delete' ||
        effect.reversibility === 'irreversible' ||
        effect.usesFileUpload === true ||
        Number(effect.maxAffectedItems) > 1
    )
  ) {
    return { result: 'approval_required', reasonCodes: ['staging_high_risk_approval'] };
  }
  return { result: 'auto_allowed', reasonCodes: ['declared_effects_within_policy'] };
}

export function collectSideEffects(
  script: Record<string, unknown>,
  callKey: string,
  scriptRevisionId: string,
  repeatCount: number
): PlannedEffect[] {
  const declarations = new Map(
    (Array.isArray(script.sideEffects) ? script.sideEffects : [])
      .filter(isObject)
      .map((effect) => [String(effect.id), effect])
  );
  return (Array.isArray(script.steps) ? script.steps : []).filter(isObject).flatMap((step) => {
    if (typeof step.sideEffectId !== 'string') return [];
    const effect = declarations.get(step.sideEffectId);
    if (!effect)
      throw new DomainError(
        'validation_error',
        `Side-effect '${step.sideEffectId}' is not declared`,
        'side_effect_declaration_required'
      );
    const affected = isObject(effect.affectedItems) ? effect.affectedItems : {};
    const bound = affected.kind === 'single' ? 1 : affected.maxItems;
    if (
      typeof bound !== 'number' ||
      !Number.isSafeInteger(bound) ||
      bound < 1 ||
      !Number.isSafeInteger(bound * repeatCount)
    ) {
      throw new DomainError(
        'validation_error',
        `Side-effect '${step.sideEffectId}' has no finite affectedItems bound`,
        'side_effect_bound_invalid'
      );
    }
    return [
      {
        callKey,
        scriptRevisionId,
        stepId: String(step.id),
        effectId: step.sideEffectId,
        kind: effect.kind as PlannedEffect['kind'],
        resourceType: String(effect.resourceType),
        maxAffectedItems: bound * repeatCount,
        reversibility: effect.reversibility as PlannedEffect['reversibility'],
        usesFileUpload: isObject(step.action) && step.action.type === 'set_files',
      },
    ];
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
