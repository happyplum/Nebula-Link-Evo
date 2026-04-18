/**
 * Frame counter utility for tracking frame processing metrics
 *
 * Factory function that creates a frame counter with:
 * - FPS tracking (rolling 1-second window)
 * - Frame drop tracking with reasons
 * - Byte throughput tracking
 * - Rolling window eviction
 *
 * @module frame-counter
 */

/**
 * Summary of frame processing metrics
 */
export interface FrameCounterSummary {
  /** Frames per second (calculated over rolling 1s window) */
  fps: number;
  /** Total frames processed since creation or reset */
  totalFrames: number;
  /** Total frames dropped since creation or reset */
  totalDrops: number;
  /** Count of drops by reason */
  dropReasons: Record<string, number>;
  /** Bytes per second (calculated over rolling 1s window) */
  bytesPerSecond: number;
  /** Actual window duration used for calculations (in milliseconds) */
  windowDuration: number;
}

/**
 * Frame counter instance returned by createFrameCounter
 */
export interface FrameCounter {
  /** Records a successfully processed frame */
  recordFrame(timestamp?: number): void;
  /** Records a dropped frame with a reason */
  recordDrop(reason: string, timestamp?: number): void;
  /** Records bytes transferred */
  recordBytes(byteCount: number): void;
  /** Gets current summary of all metrics */
  getSummary(): FrameCounterSummary;
  /** Resets all counters */
  reset(): void;
}

/**
 * Creates a frame counter instance for tracking frame processing metrics
 *
 * @param windowDurationMs - Rolling window duration in milliseconds (default: 1000ms)
 * @returns FrameCounter instance
 *
 * @example
 * ```typescript
 * const counter = createFrameCounter(1000);
 *
 * // Record frames
 * counter.recordFrame();
 * counter.recordFrame();
 *
 * // Record drops
 * counter.recordDrop('network-error');
 *
 * // Record bytes
 * counter.recordBytes(1024);
 *
 * // Get summary
 * const summary = counter.getSummary();
 * console.log(`FPS: ${summary.fps}`);
 * ```
 */
export function createFrameCounter(windowDurationMs: number = 1000): FrameCounter {
  // Rolling window data
  const frameTimestamps: number[] = [];
  const dropTimestamps: Array<{ reason: string; timestamp: number }> = [];
  const byteEntries: Array<{ count: number; timestamp: number }> = [];

  // Accumulative counters
  let totalFrames = 0;
  let totalDrops = 0;
  const dropReasons: Map<string, number> = new Map();

  /**
   * Evicts entries older than the rolling window
   */
  const evictOldEntries = (now: number): void => {
    const cutoff = now - windowDurationMs;

    // Evict old frame timestamps
    let frameIndex = 0;
    while (frameIndex < frameTimestamps.length && frameTimestamps[frameIndex] < cutoff) {
      frameIndex++;
    }
    frameTimestamps.splice(0, frameIndex);

    // Evict old drop timestamps
    let dropIndex = 0;
    while (dropIndex < dropTimestamps.length && dropTimestamps[dropIndex].timestamp < cutoff) {
      dropIndex++;
    }
    dropTimestamps.splice(0, dropIndex);

    // Evict old byte entries
    let byteIndex = 0;
    while (byteIndex < byteEntries.length && byteEntries[byteIndex].timestamp < cutoff) {
      byteIndex++;
    }
    byteEntries.splice(0, byteIndex);
  };

  return {
    /**
     * Records a successfully processed frame
     * @param timestamp - Optional timestamp (default: Date.now())
     */
    recordFrame(timestamp?: number): void {
      const now = timestamp ?? Date.now();
      frameTimestamps.push(now);
      totalFrames++;
    },

    /**
     * Records a dropped frame with a reason
     * @param reason - The reason for the drop
     * @param timestamp - Optional timestamp (default: Date.now())
     */
    recordDrop(reason: string, timestamp?: number): void {
      const now = timestamp ?? Date.now();
      dropTimestamps.push({ reason, timestamp: now });
      totalDrops++;

      // Update drop reason count
      const currentCount = dropReasons.get(reason) ?? 0;
      dropReasons.set(reason, currentCount + 1);
    },

    /**
     * Records bytes transferred
     * @param byteCount - Number of bytes transferred
     */
    recordBytes(byteCount: number): void {
      const now = Date.now();
      byteEntries.push({ count: byteCount, timestamp: now });
    },

    /**
     * Gets current summary of all metrics
     * @returns FrameCounterSummary with current metric values
     * @note fps and bytesPerSecond are counts within the rolling window, only semantically accurate as "per second" when the window duration is 1000ms (default)
     */
    getSummary(): FrameCounterSummary {
      const now = Date.now();

      // Evict old entries before calculating metrics
      evictOldEntries(now);

      // Calculate FPS based on valid timestamps in window
      const fps = frameTimestamps.length;

      // Calculate bytes per second
      const totalBytes = byteEntries.reduce((sum, entry) => sum + entry.count, 0);
      const bytesPerSecond = totalBytes; // Already normalized to 1s window

      // Calculate actual window duration (for edge cases)
      let windowDuration = windowDurationMs;
      if (frameTimestamps.length > 0) {
        const oldest = frameTimestamps[0];
        const duration = now - oldest;
        windowDuration = Math.max(duration, 1); // Avoid division by zero
      }

      // Convert drop reasons Map to Record
      const dropReasonsRecord: Record<string, number> = {};
      for (const [reason, count] of dropReasons.entries()) {
        dropReasonsRecord[reason] = count;
      }

      return {
        fps,
        totalFrames,
        totalDrops,
        dropReasons: dropReasonsRecord,
        bytesPerSecond,
        windowDuration,
      };
    },

    /**
     * Resets all counters and clears all tracking data
     */
    reset(): void {
      frameTimestamps.length = 0;
      dropTimestamps.length = 0;
      byteEntries.length = 0;
      totalFrames = 0;
      totalDrops = 0;
      dropReasons.clear();
    },
  };
}
