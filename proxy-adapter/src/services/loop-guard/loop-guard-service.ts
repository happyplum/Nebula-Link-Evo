import type {
  LoopGuardAction,
  LoopGuardVerdict,
  LoopGuardConfig,
} from './types.js';
import { DEFAULT_LOOP_GUARD_CONFIG } from './types.js';
import { normalizeActionSignature } from './fingerprint.js';

export class LoopGuardService {
  private history: LoopGuardAction[] = [];
  private readonly config: LoopGuardConfig;

  constructor(config?: Partial<LoopGuardConfig>) {
    this.config = { ...DEFAULT_LOOP_GUARD_CONFIG, ...config };
  }

  /** Record a completed action. Call AFTER tool execution completes. */
  recordAction(action: LoopGuardAction): void {
    this.history.push(action);
    if (this.history.length > this.config.windowSize) {
      this.history.shift();
    }
  }

  /** Check current state. Call BEFORE each tool call. */
  check(): LoopGuardVerdict {
    if (this.history.length === 0) {
      return this.clean();
    }

    // Priority 1: hard cap
    if (this.history.length >= this.config.hardCap) {
      return {
        level: 'critical',
        detector: 'hard_cap',
        message: `Reached hard cap of ${this.config.hardCap} actions`,
        repeatedCount: this.history.length,
      };
    }

    // Priority 2: identical action
    const identical = this.detectIdenticalAction();
    if (identical) return identical;

    // Priority 3: no progress
    const noProgress = this.detectNoProgress();
    if (noProgress) return noProgress;

    // Priority 4: ping-pong
    const pingPong = this.detectPingPong();
    if (pingPong) return pingPong;

    return this.clean();
  }

  /** Reset history for a new execution run. */
  reset(): void {
    this.history = [];
  }

  private clean(): LoopGuardVerdict {
    return { level: 'clean', detector: 'none', message: '', repeatedCount: 0 };
  }

  private detectIdenticalAction(): LoopGuardVerdict | null {
    const last = this.history[this.history.length - 1];
    const sig = normalizeActionSignature(last.toolName, last.argsHash);

    let streak = 1;
    for (let i = this.history.length - 2; i >= 0; i--) {
      const prevSig = normalizeActionSignature(
        this.history[i].toolName,
        this.history[i].argsHash,
      );
      if (prevSig === sig) {
        streak++;
      } else {
        break;
      }
    }

    const threshold = this.config.identicalAction;
    if (streak >= threshold.blockAt) {
      return {
        level: 'blocked',
        detector: 'identical_action',
        message: `Identical action ${last.toolName} repeated ${streak} times`,
        repeatedCount: streak,
      };
    }
    if (streak >= threshold.warnAt) {
      return {
        level: 'warning',
        detector: 'identical_action',
        message: `Identical action ${last.toolName} repeated ${streak} times`,
        repeatedCount: streak,
      };
    }
    return null;
  }

  private detectNoProgress(): LoopGuardVerdict | null {
    const lastHash = this.history[this.history.length - 1].resultHash;

    let streak = 1;
    for (let i = this.history.length - 2; i >= 0; i--) {
      if (this.history[i].resultHash === lastHash) {
        streak++;
      } else {
        break;
      }
    }

    const threshold = this.config.noProgress;
    if (streak >= threshold.blockAt) {
      return {
        level: 'blocked',
        detector: 'no_progress',
        message: `No progress detected: same result for ${streak} consecutive actions`,
        repeatedCount: streak,
      };
    }
    if (streak >= threshold.warnAt) {
      return {
        level: 'warning',
        detector: 'no_progress',
        message: `No progress detected: same result for ${streak} consecutive actions`,
        repeatedCount: streak,
      };
    }
    return null;
  }

  private detectPingPong(): LoopGuardVerdict | null {
    if (this.history.length < 4) return null;

    // Collect distinct signatures from last N actions
    const recent = this.history.slice(-this.config.windowSize);
    const sigs = recent.map((a) =>
      normalizeActionSignature(a.toolName, a.argsHash),
    );

    // Need exactly 2 unique signatures alternating
    const uniqueSigs = [...new Set(sigs)];
    if (uniqueSigs.length !== 2) return null;

    const [sigA, sigB] = uniqueSigs;

    // Verify alternating pattern from the end
    let alternating = true;
    let alternationCount = 1;
    for (let i = sigs.length - 2; i >= 0; i--) {
      if (sigs[i] === sigs[i + 1]) {
        alternating = false;
        break;
      }
      alternationCount++;
    }

    if (!alternating) return null;

    // Check that results are stable within each group
    const groupA = recent.filter(
      (a) => normalizeActionSignature(a.toolName, a.argsHash) === sigA,
    );
    const groupB = recent.filter(
      (a) => normalizeActionSignature(a.toolName, a.argsHash) === sigB,
    );

    const resultsStableA = groupA.every((a) => a.resultHash === groupA[0].resultHash);
    const resultsStableB = groupB.every((a) => a.resultHash === groupB[0].resultHash);

    if (!resultsStableA || !resultsStableB) return null;

    const threshold = this.config.pingPong;
    if (alternationCount >= threshold.blockAt) {
      return {
        level: 'blocked',
        detector: 'ping_pong',
        message: `Ping-pong detected: alternating between ${sigA} and ${sigB} for ${alternationCount} turns`,
        repeatedCount: alternationCount,
      };
    }
    if (alternationCount >= threshold.warnAt) {
      return {
        level: 'warning',
        detector: 'ping_pong',
        message: `Ping-pong detected: alternating between ${sigA} and ${sigB} for ${alternationCount} turns`,
        repeatedCount: alternationCount,
      };
    }
    return null;
  }
}
