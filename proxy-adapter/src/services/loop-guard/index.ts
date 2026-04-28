export type {
  PageFingerprint,
  LoopGuardAction,
  LoopGuardVerdict,
  DetectorThreshold,
  LoopGuardConfig,
  RawLoopGuardConfig,
} from './types.js';

export { DEFAULT_LOOP_GUARD_CONFIG } from './types.js';
export {
  hashArgs,
  hashResult,
  computePageFingerprint,
  normalizeActionSignature,
} from './fingerprint.js';
export { InterventionEngine, DEFAULT_TEMPLATES } from './intervention.js';
export type { NudgeTemplates } from './intervention.js';
export { LoopGuardService } from './loop-guard-service.js';
