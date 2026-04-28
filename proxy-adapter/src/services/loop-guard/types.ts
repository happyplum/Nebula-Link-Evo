interface PageFingerprint {
  url: string;
  title: string;
  textHash: string;
  elementCount: number;
}

interface LoopGuardAction {
  toolName: string;
  argsHash: string;
  resultHash: string;
  timestamp: number;
  pageFingerprint?: PageFingerprint;
}

interface LoopGuardVerdict {
  level: 'clean' | 'warning' | 'blocked' | 'critical';
  detector: string;
  message: string;
  nudge?: string;
  repeatedCount: number;
}

interface DetectorThreshold {
  warnAt: number;
  blockAt: number;
}

interface LoopGuardConfig {
  identicalAction: DetectorThreshold;
  noProgress: DetectorThreshold;
  pingPong: DetectorThreshold;
  hardCap: number;
  windowSize: number;
}

const DEFAULT_LOOP_GUARD_CONFIG: LoopGuardConfig = {
  identicalAction: { warnAt: 3, blockAt: 5 },
  noProgress: { warnAt: 4, blockAt: 6 },
  pingPong: { warnAt: 3, blockAt: 5 },
  hardCap: 30,
  windowSize: 15,
};

interface RawLoopGuardConfig {
  identicalAction?: Partial<DetectorThreshold>;
  noProgress?: Partial<DetectorThreshold>;
  pingPong?: Partial<DetectorThreshold>;
  hardCap?: number | string;
  windowSize?: number | string;
}

export type {
  PageFingerprint,
  LoopGuardAction,
  LoopGuardVerdict,
  DetectorThreshold,
  LoopGuardConfig,
  RawLoopGuardConfig,
};

export { DEFAULT_LOOP_GUARD_CONFIG };
