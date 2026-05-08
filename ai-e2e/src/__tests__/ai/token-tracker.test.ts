import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBudgetTracker } from '../../ai/token-tracker.js';

describe('TokenBudgetTracker', () => {
  let tracker: TokenBudgetTracker;

  beforeEach(() => {
    tracker = new TokenBudgetTracker(1000);
  });

  describe('record', () => {
    it('should record token usage by category', () => {
      tracker.record('analysis', 100, 50);
      tracker.record('generation', 200, 100);

      const analysis = tracker.getUsageByCategory('analysis');
      expect(analysis).toEqual({ prompt: 100, completion: 50 });

      const generation = tracker.getUsageByCategory('generation');
      expect(generation).toEqual({ prompt: 200, completion: 100 });
    });

    it('should accumulate usage for the same category', () => {
      tracker.record('analysis', 100, 50);
      tracker.record('analysis', 50, 25);

      expect(tracker.getUsageByCategory('analysis')).toEqual({
        prompt: 150,
        completion: 75,
      });
    });
  });

  describe('getTotalUsage', () => {
    it('should sum all categories', () => {
      tracker.record('analysis', 100, 50);
      tracker.record('generation', 200, 100);

      expect(tracker.getTotalUsage()).toEqual({
        prompt: 300,
        completion: 150,
      });
    });

    it('should return zeros when no usage recorded', () => {
      expect(tracker.getTotalUsage()).toEqual({ prompt: 0, completion: 0 });
    });
  });

  describe('getRemainingBudget', () => {
    it('should calculate remaining budget', () => {
      tracker.record('test', 200, 100);
      expect(tracker.getRemainingBudget()).toBe(700);
    });

    it('should return full budget when no usage', () => {
      expect(tracker.getRemainingBudget()).toBe(1000);
    });

    it('should return negative when over budget', () => {
      tracker.record('test', 800, 400);
      expect(tracker.getRemainingBudget()).toBe(-200);
    });
  });

  describe('isOverBudget', () => {
    it('should return false when under budget', () => {
      tracker.record('test', 100, 50);
      expect(tracker.isOverBudget()).toBe(false);
    });

    it('should return false when at exact budget', () => {
      tracker.record('test', 500, 500);
      expect(tracker.isOverBudget()).toBe(false);
    });

    it('should return true when over budget', () => {
      tracker.record('test', 800, 400);
      expect(tracker.isOverBudget()).toBe(true);
    });
  });

  describe('getUsageByCategory', () => {
    it('should return undefined for unknown category', () => {
      expect(tracker.getUsageByCategory('nonexistent')).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('should clear all recorded usage', () => {
      tracker.record('test', 100, 50);
      tracker.reset();

      expect(tracker.getTotalUsage()).toEqual({ prompt: 0, completion: 0 });
      expect(tracker.getUsageByCategory('test')).toBeUndefined();
      expect(tracker.getRemainingBudget()).toBe(1000);
    });
  });
});
