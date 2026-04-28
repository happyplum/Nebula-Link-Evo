import { describe, it, expect } from 'vitest';
import { LoopGuardService } from '../../../../services/loop-guard/loop-guard-service.js';

function makeAction(
  toolName: string,
  argsHash: string,
  resultHash: string,
): import('../../../../services/loop-guard/types.js').LoopGuardAction {
  return { toolName, argsHash, resultHash, timestamp: Date.now() };
}

describe('LoopGuardService', () => {
  it('returns clean verdict with empty history', () => {
    const guard = new LoopGuardService();
    const verdict = guard.check();
    expect(verdict.level).toBe('clean');
    expect(verdict.detector).toBe('none');
  });

  it('detects identical action warning at threshold', () => {
    const guard = new LoopGuardService({ identicalAction: { warnAt: 3, blockAt: 5 } });
    const action = makeAction('click', 'hash1', 'res1');
    guard.recordAction(action);
    guard.recordAction(action);
    guard.recordAction(action);

    const verdict = guard.check();
    expect(verdict.level).toBe('warning');
    expect(verdict.detector).toBe('identical_action');
    expect(verdict.repeatedCount).toBe(3);
  });

  it('detects identical action blocked at threshold', () => {
    const guard = new LoopGuardService({ identicalAction: { warnAt: 3, blockAt: 5 } });
    const action = makeAction('click', 'hash1', 'res1');
    for (let i = 0; i < 5; i++) guard.recordAction(action);

    const verdict = guard.check();
    expect(verdict.level).toBe('blocked');
    expect(verdict.detector).toBe('identical_action');
    expect(verdict.repeatedCount).toBe(5);
  });

  it('detects no-progress warning at threshold', () => {
    const guard = new LoopGuardService({ noProgress: { warnAt: 4, blockAt: 6 } });
    // Different tools/args but same result hash
    guard.recordAction(makeAction('click', 'h1', 'same_result'));
    guard.recordAction(makeAction('type', 'h2', 'same_result'));
    guard.recordAction(makeAction('scroll', 'h3', 'same_result'));
    guard.recordAction(makeAction('click', 'h4', 'same_result'));

    const verdict = guard.check();
    expect(verdict.level).toBe('warning');
    expect(verdict.detector).toBe('no_progress');
    expect(verdict.repeatedCount).toBe(4);
  });

  it('detects no-progress blocked at threshold', () => {
    const guard = new LoopGuardService({ noProgress: { warnAt: 4, blockAt: 6 } });
    for (let i = 0; i < 6; i++) {
      guard.recordAction(makeAction(`tool${i}`, `h${i}`, 'same_result'));
    }

    const verdict = guard.check();
    expect(verdict.level).toBe('blocked');
    expect(verdict.detector).toBe('no_progress');
    expect(verdict.repeatedCount).toBe(6);
  });

  it('detects ping-pong warning at threshold', () => {
    const guard = new LoopGuardService({ pingPong: { warnAt: 3, blockAt: 5 } });
    // Alternating A B A B (4 actions, alternation count = 4 → warnAt=3, blockAt=5 → warning)
    guard.recordAction(makeAction('toolA', 'hA', 'resA'));
    guard.recordAction(makeAction('toolB', 'hB', 'resB'));
    guard.recordAction(makeAction('toolA', 'hA', 'resA'));
    guard.recordAction(makeAction('toolB', 'hB', 'resB'));

    const verdict = guard.check();
    expect(verdict.level).toBe('warning');
    expect(verdict.detector).toBe('ping_pong');
    expect(verdict.repeatedCount).toBeGreaterThanOrEqual(3);
  });

  it('detects ping-pong blocked at threshold', () => {
    const guard = new LoopGuardService({ pingPong: { warnAt: 3, blockAt: 5 } });
    for (let i = 0; i < 10; i++) {
      const tool = i % 2 === 0 ? 'toolA' : 'toolB';
      const hash = i % 2 === 0 ? 'hA' : 'hB';
      const res = i % 2 === 0 ? 'resA' : 'resB';
      guard.recordAction(makeAction(tool, hash, res));
    }

    const verdict = guard.check();
    expect(verdict.level).toBe('blocked');
    expect(verdict.detector).toBe('ping_pong');
  });

  it('detects hard cap critical', () => {
    const guard = new LoopGuardService({ hardCap: 5, windowSize: 100 });
    for (let i = 0; i < 5; i++) {
      guard.recordAction(makeAction(`tool${i}`, `h${i}`, `res${i}`));
    }

    const verdict = guard.check();
    expect(verdict.level).toBe('critical');
    expect(verdict.detector).toBe('hard_cap');
    expect(verdict.repeatedCount).toBe(5);
  });

  it('reset clears history and returns clean', () => {
    const guard = new LoopGuardService({ identicalAction: { warnAt: 2, blockAt: 4 } });
    guard.recordAction(makeAction('click', 'h1', 'r1'));
    guard.recordAction(makeAction('click', 'h1', 'r1'));
    expect(guard.check().level).toBe('warning');

    guard.reset();
    expect(guard.check().level).toBe('clean');
  });

  it('enforces rolling window by dropping oldest entries', () => {
    const guard = new LoopGuardService({ windowSize: 3, hardCap: 100 });
    guard.recordAction(makeAction('a', 'h1', 'r1'));
    guard.recordAction(makeAction('b', 'h2', 'r2'));
    guard.recordAction(makeAction('c', 'h3', 'r3'));
    guard.recordAction(makeAction('d', 'h4', 'r4'));

    // windowSize=3, oldest 'a' should be dropped
    // Now history has: b, c, d — all different → clean
    expect(guard.check().level).toBe('clean');
  });

  it('respects custom config overrides', () => {
    const guard = new LoopGuardService({ identicalAction: { warnAt: 2, blockAt: 3 } });
    guard.recordAction(makeAction('click', 'h1', 'r1'));
    guard.recordAction(makeAction('click', 'h1', 'r1'));

    const verdict = guard.check();
    expect(verdict.level).toBe('warning');
    expect(verdict.repeatedCount).toBe(2);
  });

  it('mixed actions break identical streak', () => {
    const guard = new LoopGuardService({ identicalAction: { warnAt: 3, blockAt: 5 } });
    guard.recordAction(makeAction('click', 'h1', 'r1'));
    guard.recordAction(makeAction('click', 'h1', 'r1'));
    // Different action breaks streak
    guard.recordAction(makeAction('type', 'h2', 'r2'));
    guard.recordAction(makeAction('click', 'h1', 'r1'));

    // Streak is only 1 after the break
    expect(guard.check().level).toBe('clean');
  });
});
