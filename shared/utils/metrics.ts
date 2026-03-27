/**
 * Performance monitoring module using PerformanceObserver
 *
 * This module provides performance metrics collection for measuring
 * execution time of operations throughout the application.
 *
 * Key features:
 * - Uses PerformanceObserver for automatic metric collection
 * - Stores measurements in Map<string, number[]>
 * - Calculates statistics: avg, p95, count
 * - No manual P95/P99 calculation bugs
 *
 * @module metrics
 */

/**
 * Statistics for a metric
 */
export interface MetricStats {
  avg: number;
  p95: number;
  count: number;
}

/**
 * Performance metrics collector using PerformanceObserver
 *
 * @remarks
 * Uses PerformanceObserver to automatically collect performance measurements
 * instead of performance.getEntriesByName() which has a bug where it only
 * gets the first measurement result.
 *
 * @example
 * ```typescript
 * const metrics = new Metrics();
 *
 * // Measure operation
 * const endTimer = metrics.startTimer('database-query');
 * await database.query();
 * endTimer();
 *
 * // Get statistics
 * const stats = metrics.getStats('database-query');
 * console.log(`Average: ${stats.avg}ms, P95: ${stats.p95}ms, Count: ${stats.count}`);
 * ```
 */
export class Metrics {
  /**
   * Internal storage for metric measurements
   * Maps metric name to array of duration values
   */
  private measurements: Map<string, number[]> = new Map();

  /**
   * PerformanceObserver instance for automatic metric collection
   */
  private observer: PerformanceObserver;

  /**
   * Creates a new Metrics instance and sets up PerformanceObserver
   *
   * @remarks
   * The PerformanceObserver listens for 'measure' entries and automatically
   * collects all measurements into the internal Map storage.
   */
  constructor() {
    this.observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const entry of entries) {
        if (entry.entryType === 'measure') {
          const name = entry.name;
          const duration = entry.duration;

          // Initialize array if needed
          if (!this.measurements.has(name)) {
            this.measurements.set(name, []);
          }

          // Store measurement
          this.measurements.get(name)!.push(duration);
        }
      }
    });

    // Observe performance measure entries
    this.observer.observe({ entryTypes: ['measure'] });
  }

  /**
   * Starts a timer for a metric and returns a stop function
   *
   * @param metricName - Name of the metric to track
   * @returns A function that stops the timer and records the measurement
   *
   * @example
   * ```typescript
   * const endTimer = metrics.startTimer('api-call');
   * await fetch(url);
   * endTimer(); // Measurement automatically collected
   * ```
   *
   * @remarks
   * Uses performance.mark() for start/end markers and performance.measure()
   * to create the measurement. The PerformanceObserver automatically collects
   * the measurement when the stop function is called.
   */
  startTimer(metricName: string): () => void {
    const startMark = `${metricName}-start`;
    const endMark = `${metricName}-end`;

    performance.mark(startMark);

    return () => {
      performance.mark(endMark);
      performance.measure(metricName, startMark, endMark);
      // Measurement automatically collected by PerformanceObserver

      // Clean up marks to avoid memory leaks
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
    };
  }

  /**
   * Gets statistics for a specific metric
   *
   * @param metricName - Name of the metric to query
   * @returns Statistics object containing avg, p95, and count
   *
   * @remarks
   * If no measurements exist for the metric, returns { avg: 0, p95: 0, count: 0 }
   */
  getStats(metricName: string): MetricStats {
    const samples = this.measurements.get(metricName) || [];

    if (samples.length === 0) {
      return { avg: 0, p95: 0, count: 0 };
    }

    // Calculate average
    const sum = samples.reduce((acc, val) => acc + val, 0);
    const avg = sum / samples.length;

    // Calculate P95 (95th percentile)
    const sorted = [...samples].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Index] || 0;

    return {
      avg,
      p95,
      count: samples.length
    };
  }

  /**
   * Gets all measurements for a specific metric
   *
   * @param metricName - Name of the metric to query
   * @returns Array of all measurement values, or empty array if not found
   */
  getMeasurements(metricName: string): number[] {
    return this.measurements.get(metricName) || [];
  }

  /**
   * Clears all measurements for a specific metric
   *
   * @param metricName - Name of the metric to clear
   */
  clearMetric(metricName: string): void {
    this.measurements.delete(metricName);
  }

  /**
   * Clears all measurements for all metrics
   *
   * @remarks
   * Useful for resetting metrics between test runs or at application start
   */
  clearAllMetrics(): void {
    this.measurements.clear();
  }

  /**
   * Gets list of all metric names that have been collected
   *
   * @returns Array of metric names
   */
  getMetricNames(): string[] {
    return Array.from(this.measurements.keys());
  }

  /**
   * Disconnects the PerformanceObserver
   *
   * @remarks
   * Call this when Metrics instance is no longer needed to allow garbage collection
   */
  disconnect(): void {
    this.observer.disconnect();
  }
}

/**
 * Global singleton instance of Metrics for convenience
 *
 * @example
 * ```typescript
 * import { metrics } from '@nebula-link-evo/shared/utils/metrics.js';
 *
 * const endTimer = metrics.startTimer('operation');
 * // ... do work ...
 * endTimer();
 * ```
 */
export const metrics = new Metrics();
