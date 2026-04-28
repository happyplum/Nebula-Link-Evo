import { describe, it, expect } from 'vitest';
import { InterventionEngine } from '../../../../services/loop-guard/intervention.js';
import type { LoopGuardVerdict } from '../../../../services/loop-guard/types.js';

function makeVerdict(
  overrides: Partial<LoopGuardVerdict> = {},
): LoopGuardVerdict {
  return {
    level: 'clean',
    detector: 'test-detector',
    message: '',
    repeatedCount: 0,
    ...overrides,
  };
}

describe('InterventionEngine', () => {
  const engine = new InterventionEngine();

  describe('getNudge', () => {
    it('returns undefined for clean verdict', () => {
      expect(engine.getNudge(makeVerdict({ level: 'clean' }))).toBeUndefined();
    });

    it('returns warning nudge with Chinese text and toolName', () => {
      const verdict = makeVerdict({
        level: 'warning',
        detector: 'identical-action',
        repeatedCount: 3,
      });
      const nudge = engine.getNudge(verdict);
      expect(nudge).toBeDefined();
      expect(nudge!).toContain('重复行为');
      expect(nudge!).toContain('identical-action');
      expect(nudge!).toContain('3');
    });

    it('returns blocked nudge', () => {
      const verdict = makeVerdict({
        level: 'blocked',
        detector: 'no-progress',
        repeatedCount: 6,
      });
      const nudge = engine.getNudge(verdict);
      expect(nudge).toBeDefined();
      expect(nudge!).toContain('被拦截');
      expect(nudge!).toContain('no-progress');
    });

    it('returns critical nudge', () => {
      const verdict = makeVerdict({
        level: 'critical',
        detector: 'hard-cap',
        repeatedCount: 30,
      });
      const nudge = engine.getNudge(verdict);
      expect(nudge).toBeDefined();
      expect(nudge!).toContain('强制终止');
    });
  });

  describe('shouldBlockExecution', () => {
    it('returns false for clean', () => {
      expect(engine.shouldBlockExecution(makeVerdict({ level: 'clean' }))).toBe(false);
    });

    it('returns false for warning', () => {
      expect(engine.shouldBlockExecution(makeVerdict({ level: 'warning' }))).toBe(false);
    });

    it('returns true for blocked', () => {
      expect(engine.shouldBlockExecution(makeVerdict({ level: 'blocked' }))).toBe(true);
    });

    it('returns false for critical — handled at integration layer', () => {
      expect(engine.shouldBlockExecution(makeVerdict({ level: 'critical' }))).toBe(false);
    });
  });

  describe('shouldInjectNudge', () => {
    it('returns false for clean', () => {
      expect(engine.shouldInjectNudge(makeVerdict({ level: 'clean' }))).toBe(false);
    });

    it('returns true for warning', () => {
      expect(engine.shouldInjectNudge(makeVerdict({ level: 'warning' }))).toBe(true);
    });

    it('returns true for blocked', () => {
      expect(engine.shouldInjectNudge(makeVerdict({ level: 'blocked' }))).toBe(true);
    });

    it('returns true for critical', () => {
      expect(engine.shouldInjectNudge(makeVerdict({ level: 'critical' }))).toBe(true);
    });
  });

  describe('formatBlockError', () => {
    it('includes tool name and count with Chinese text', () => {
      const verdict = makeVerdict({
        level: 'blocked',
        detector: 'ping-pong',
        repeatedCount: 5,
      });
      const msg = engine.formatBlockError(verdict);
      expect(msg).toContain('被拦截');
      expect(msg).toContain('ping-pong');
      expect(msg).toContain('5');
    });
  });

  describe('custom templates', () => {
    it('overrides default templates', () => {
      const custom = new InterventionEngine({
        warning: 'CUSTOM WARNING: {toolName} x{count}',
        blocked: 'CUSTOM BLOCKED: {toolName} x{count}',
      });
      const verdict = makeVerdict({
        level: 'warning',
        detector: 'my-det',
        repeatedCount: 7,
      });
      expect(custom.getNudge(verdict)).toBe('CUSTOM WARNING: my-det x7');
    });

    it('uses default critical template when only warning/blocked overridden', () => {
      const custom = new InterventionEngine({
        warning: 'custom-warn',
      });
      const verdict = makeVerdict({ level: 'critical' });
      const nudge = custom.getNudge(verdict);
      expect(nudge).toContain('强制终止');
    });
  });

  describe('template variable replacement', () => {
    it('replaces {toolName}, {count}, and {detector}', () => {
      const custom = new InterventionEngine({
        blocked: '{toolName} | {count} | {detector}',
      });
      const verdict = makeVerdict({
        level: 'blocked',
        detector: 'some-detector',
        repeatedCount: 42,
      });
      expect(custom.formatBlockError(verdict)).toBe(
        'some-detector | 42 | some-detector',
      );
    });
  });
});
