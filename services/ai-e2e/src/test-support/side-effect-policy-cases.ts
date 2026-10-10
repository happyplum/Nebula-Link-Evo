export const sideEffectPolicyCases = (['local', 'test', 'staging', 'production'] as const).flatMap(
  (environment) =>
    (['auth_change', 'create', 'delete'] as const).map((kind) => ({
      environment,
      kind,
      reversibility: 'compensatable' as const,
      result:
        environment === 'production' && kind !== 'auth_change'
          ? 'denied'
          : environment === 'staging' && kind === 'delete'
            ? 'approval_required'
            : 'auto_allowed',
    }))
);
