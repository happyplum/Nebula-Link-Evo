/**
 * Session-level lock manager with TTL support
 * 
 * Prevents concurrent runs for the same session with automatic timeout.
 * Uses singleton pattern and in-memory storage for performance.
 */

export interface SessionLockEntry {
  runId: string;
  acquiredAt: number;
  timeoutId: NodeJS.Timeout;
  renewalIntervalId: NodeJS.Timeout;
}

export class SessionLock {
  private static instance: SessionLock;

  private readonly locks = new Map<string, SessionLockEntry>();
  private readonly TTL = 30_000; // 30 seconds in milliseconds
  private readonly RENEWAL_INTERVAL = 10_000; // 10 seconds in milliseconds

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): SessionLock {
    if (!SessionLock.instance) {
      SessionLock.instance = new SessionLock();
    }
    return SessionLock.instance;
  }

  /**
   * Acquire lock for session
   * @param sessionId - Session identifier
   * @param runId - Run identifier
   * @returns true if lock acquired, false if session already locked
   */
  acquire(sessionId: string, runId: string): boolean {
    if (this.locks.has(sessionId)) {
      return false;
    }

    const acquiredAt = Date.now();

    // Set up auto-release timeout
    const timeoutId = setTimeout(() => {
      this.release(sessionId, runId);
    }, this.TTL);

    // Set up renewal interval
    const renewalIntervalId = setInterval(() => {
      this.renew(sessionId, runId);
    }, this.RENEWAL_INTERVAL);

    this.locks.set(sessionId, {
      runId,
      acquiredAt,
      timeoutId,
      renewalIntervalId,
    });

    return true;
  }

  /**
   * Release lock for session
   * @param sessionId - Session identifier
   * @param runId - Run identifier (must match acquired runId)
   */
  release(sessionId: string, runId: string): void {
    const entry = this.locks.get(sessionId);
    
    if (!entry) {
      return;
    }

    // Verify runId matches
    if (entry.runId !== runId) {
      return;
    }

    // Clear timers
    clearTimeout(entry.timeoutId);
    clearInterval(entry.renewalIntervalId);

    this.locks.delete(sessionId);
  }

  /**
   * Check if session is locked
   * @param sessionId - Session identifier
   * @returns true if session has active lock
   */
  isLocked(sessionId: string): boolean {
    return this.locks.has(sessionId);
  }

  /**
   * Get runId for locked session
   * @param sessionId - Session identifier
   * @returns runId if locked, undefined otherwise
   */
  getRunId(sessionId: string): string | undefined {
    return this.locks.get(sessionId)?.runId;
  }

  /**
   * Renew lock (update acquired timestamp to extend TTL)
   * @param sessionId - Session identifier
   * @param runId - Run identifier (must match)
   */
  private renew(sessionId: string, runId: string): void {
    const entry = this.locks.get(sessionId);
    
    if (!entry || entry.runId !== runId) {
      return;
    }

    // Update timestamp
    entry.acquiredAt = Date.now();

    // Reset TTL timeout
    clearTimeout(entry.timeoutId);
    entry.timeoutId = setTimeout(() => {
      this.release(sessionId, runId);
    }, this.TTL);
  }

  /**
   * Clear all locks (for testing purposes)
   */
  clear(): void {
    for (const entry of this.locks.values()) {
      clearTimeout(entry.timeoutId);
      clearInterval(entry.renewalIntervalId);
    }
    this.locks.clear();
  }

  /**
   * Get number of active locks (for monitoring)
   */
  getActiveLockCount(): number {
    return this.locks.size;
  }
}
