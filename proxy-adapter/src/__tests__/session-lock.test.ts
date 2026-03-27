import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionLock } from '../services/session-lock.js';

describe('SessionLock', () => {
  let sessionLock: SessionLock;

  beforeEach(() => {
    sessionLock = SessionLock.getInstance();
    sessionLock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    sessionLock.clear();
    vi.useRealTimers();
  });

  describe('singleton pattern', () => {
    it('should return same instance', () => {
      const instance1 = SessionLock.getInstance();
      const instance2 = SessionLock.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('acquire', () => {
    it('should acquire lock for unlocked session', () => {
      const result = sessionLock.acquire('session-1', 'run-1');
      expect(result).toBe(true);
      expect(sessionLock.isLocked('session-1')).toBe(true);
      expect(sessionLock.getRunId('session-1')).toBe('run-1');
    });

    it('should fail to acquire lock for already locked session', () => {
      sessionLock.acquire('session-1', 'run-1');
      const result = sessionLock.acquire('session-1', 'run-2');
      expect(result).toBe(false);
      expect(sessionLock.getRunId('session-1')).toBe('run-1');
    });

    it('should allow multiple sessions with different IDs', () => {
      const result1 = sessionLock.acquire('session-1', 'run-1');
      const result2 = sessionLock.acquire('session-2', 'run-2');
      
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(sessionLock.getActiveLockCount()).toBe(2);
    });
  });

  describe('release', () => {
    it('should release lock and allow new acquire', () => {
      // First acquire succeeds
      const result1 = sessionLock.acquire('session-1', 'run-1');
      expect(result1).toBe(true);
      expect(sessionLock.isLocked('session-1')).toBe(true);

      // Release lock
      sessionLock.release('session-1', 'run-1');
      expect(sessionLock.isLocked('session-1')).toBe(false);

      // Second acquire should now succeed
      const result2 = sessionLock.acquire('session-1', 'run-2');
      expect(result2).toBe(true);
    });

    it('should not release if runId does not match', () => {
      sessionLock.acquire('session-1', 'run-1');
      
      // Try to release with different runId
      sessionLock.release('session-1', 'run-2');
      
      // Lock should still be held
      expect(sessionLock.isLocked('session-1')).toBe(true);
      expect(sessionLock.getRunId('session-1')).toBe('run-1');
    });

    it('should handle release of non-existent session gracefully', () => {
      // Should not throw
      expect(() => {
        sessionLock.release('non-existent', 'run-1');
      }).not.toThrow();
    });
  });

  describe('isLocked', () => {
    it('should return false for unlocked session', () => {
      expect(sessionLock.isLocked('session-1')).toBe(false);
    });

    it('should return true for locked session', () => {
      sessionLock.acquire('session-1', 'run-1');
      expect(sessionLock.isLocked('session-1')).toBe(true);
    });

    it('should return false after release', () => {
      sessionLock.acquire('session-1', 'run-1');
      sessionLock.release('session-1', 'run-1');
      expect(sessionLock.isLocked('session-1')).toBe(false);
    });
  });

  describe('TTL auto-release', () => {
    it('should auto-release lock after 30 seconds', () => {
      // Spy on setInterval to capture the interval ID
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      
      sessionLock.acquire('session-1', 'run-1');
      expect(sessionLock.isLocked('session-1')).toBe(true);
      
      // Get the interval ID and clear it to prevent renewal
      const intervalId = setIntervalSpy.mock.results[0].value as NodeJS.Timeout;
      clearInterval(intervalId);

      // Fast-forward 31 seconds and run pending timers
      vi.advanceTimersByTime(31_000);
      vi.runOnlyPendingTimers();

      // Lock should be auto-released
      expect(sessionLock.isLocked('session-1')).toBe(false);
      
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it('should allow new acquire after TTL expires', () => {
      // Spy on setInterval to capture the interval ID
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      
      // First acquire succeeds
      const result1 = sessionLock.acquire('session-1', 'run-1');
      expect(result1).toBe(true);
      
      // Get the interval ID and clear it to prevent renewal
      const intervalId = setIntervalSpy.mock.results[0].value as NodeJS.Timeout;
      clearInterval(intervalId);

      // Fast-forward 31 seconds and run pending timers
      vi.advanceTimersByTime(31_000);
      vi.runOnlyPendingTimers();

      // Lock should be auto-released
      expect(sessionLock.isLocked('session-1')).toBe(false);

      // New acquire should succeed
      const result2 = sessionLock.acquire('session-1', 'run-2');
      expect(result2).toBe(true);
      
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it('should not auto-release before TTL', () => {
      // Spy on setInterval to capture the interval ID
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      
      sessionLock.acquire('session-1', 'run-1');
      expect(sessionLock.isLocked('session-1')).toBe(true);
      
      // Get the interval ID and clear it to prevent renewal
      const intervalId = setIntervalSpy.mock.results[0].value as NodeJS.Timeout;
      clearInterval(intervalId);

      // Fast-forward 29 seconds
      vi.advanceTimersByTime(29_000);

      // Lock should still be held
      expect(sessionLock.isLocked('session-1')).toBe(true);
      
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });
  });

  describe('TTL renewal', () => {
    it('should renew lock every 10 seconds', () => {
      sessionLock.acquire('session-1', 'run-1');
      
      // Fast-forward 10 seconds (first renewal)
      vi.advanceTimersByTime(10_000);
      expect(sessionLock.isLocked('session-1')).toBe(true);
      
      // Fast-forward another 20 seconds (total 30 seconds from start)
      vi.advanceTimersByTime(20_000);
      expect(sessionLock.isLocked('session-1')).toBe(true);
    });

    it('should maintain lock beyond initial TTL with renewals', () => {
      sessionLock.acquire('session-1', 'run-1');
      
      // Fast-forward 40 seconds (should have renewed at 10s and 30s)
      vi.advanceTimersByTime(40_000);
      expect(sessionLock.isLocked('session-1')).toBe(true);
    });

    it('should stop renewal after manual release', () => {
      sessionLock.acquire('session-1', 'run-1');
      sessionLock.release('session-1', 'run-1');
      
      // Fast-forward 40 seconds (no error should occur)
      vi.advanceTimersByTime(40_000);
      expect(sessionLock.isLocked('session-1')).toBe(false);
    });
  });

  describe('getActiveLockCount', () => {
    it('should return 0 when no locks', () => {
      expect(sessionLock.getActiveLockCount()).toBe(0);
    });

    it('should return correct count with multiple locks', () => {
      sessionLock.acquire('session-1', 'run-1');
      sessionLock.acquire('session-2', 'run-2');
      sessionLock.acquire('session-3', 'run-3');
      
      expect(sessionLock.getActiveLockCount()).toBe(3);
    });

    it('should update count after release', () => {
      sessionLock.acquire('session-1', 'run-1');
      sessionLock.acquire('session-2', 'run-2');
      expect(sessionLock.getActiveLockCount()).toBe(2);
      
      sessionLock.release('session-1', 'run-1');
      expect(sessionLock.getActiveLockCount()).toBe(1);
    });

    it('should update count after TTL', () => {
      // Spy on setInterval to capture the interval IDs
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      
      sessionLock.acquire('session-1', 'run-1');
      sessionLock.acquire('session-2', 'run-2');
      expect(sessionLock.getActiveLockCount()).toBe(2);
      
      // Get the first interval ID and clear it to prevent renewal of session-1
      const intervalId1 = setIntervalSpy.mock.results[0].value as NodeJS.Timeout;
      clearInterval(intervalId1);
      
      // Auto-release session-1
      vi.advanceTimersByTime(31_000);
      vi.runOnlyPendingTimers();
      expect(sessionLock.getActiveLockCount()).toBe(1);
      
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });
  });

  describe('concurrent scenarios', () => {
    it('should block concurrent acquire attempts', () => {
      // First run acquires lock
      const result1 = sessionLock.acquire('session-1', 'run-1');
      expect(result1).toBe(true);
      
      // Second run tries to acquire same session
      const result2 = sessionLock.acquire('session-1', 'run-2');
      expect(result2).toBe(false);
      
      // Third run tries to acquire same session
      const result3 = sessionLock.acquire('session-1', 'run-3');
      expect(result3).toBe(false);
    });

    it('should allow sequential runs after release', () => {
      // Run 1
      const result1 = sessionLock.acquire('session-1', 'run-1');
      expect(result1).toBe(true);
      sessionLock.release('session-1', 'run-1');
      
      // Run 2
      const result2 = sessionLock.acquire('session-1', 'run-2');
      expect(result2).toBe(true);
      sessionLock.release('session-1', 'run-2');
      
      // Run 3
      const result3 = sessionLock.acquire('session-1', 'run-3');
      expect(result3).toBe(true);
    });

    it('should handle concurrent locks for different sessions', () => {
      const result1 = sessionLock.acquire('session-1', 'run-1');
      const result2 = sessionLock.acquire('session-2', 'run-2');
      const result3 = sessionLock.acquire('session-3', 'run-3');
      
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
      expect(sessionLock.getActiveLockCount()).toBe(3);
    });
  });

  describe('clear', () => {
    it('should clear all locks', () => {
      sessionLock.acquire('session-1', 'run-1');
      sessionLock.acquire('session-2', 'run-2');
      sessionLock.acquire('session-3', 'run-3');
      
      expect(sessionLock.getActiveLockCount()).toBe(3);
      
      sessionLock.clear();
      
      expect(sessionLock.getActiveLockCount()).toBe(0);
      expect(sessionLock.isLocked('session-1')).toBe(false);
      expect(sessionLock.isLocked('session-2')).toBe(false);
      expect(sessionLock.isLocked('session-3')).toBe(false);
    });

    it('should clear timers to prevent memory leaks', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      
      sessionLock.acquire('session-1', 'run-1');
      sessionLock.acquire('session-2', 'run-2');
      
      sessionLock.clear();
      
      // Should have cleared timers for 2 sessions
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
      expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
      
      clearTimeoutSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });
  });
});
