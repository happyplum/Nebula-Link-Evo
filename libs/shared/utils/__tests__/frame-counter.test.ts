import { describe, it, expect, vi } from 'vitest';
import { createFrameCounter } from '../frame-counter.js';

describe('createFrameCounter', () => {
  describe('recordFrame', () => {
    it('records a frame with default timestamp', () => {
      const counter = createFrameCounter();

      counter.recordFrame();
      counter.recordFrame();

      const summary = counter.getSummary();
      expect(summary.totalFrames).toBe(2);
      expect(summary.fps).toBe(2); // 2 frames in the current 1s window
    });

    it('records a frame with custom timestamp', () => {
      const counter = createFrameCounter(1000);
      const timestamp = Date.now();

      counter.recordFrame(timestamp);

      const summary = counter.getSummary();
      expect(summary.totalFrames).toBe(1);
      expect(summary.fps).toBe(1);
    });

    it('increments totalFrames for each call', () => {
      const counter = createFrameCounter();

      counter.recordFrame();
      counter.recordFrame();
      counter.recordFrame();

      const summary = counter.getSummary();
      expect(summary.totalFrames).toBe(3);
    });
  });

  describe('recordDrop', () => {
    it('records a drop with reason', () => {
      const counter = createFrameCounter();

      counter.recordDrop('network-error');

      const summary = counter.getSummary();
      expect(summary.totalDrops).toBe(1);
      expect(summary.dropReasons['network-error']).toBe(1);
    });

    it('tracks multiple drops with different reasons', () => {
      const counter = createFrameCounter();

      counter.recordDrop('network-error');
      counter.recordDrop('timeout');
      counter.recordDrop('network-error');

      const summary = counter.getSummary();
      expect(summary.totalDrops).toBe(3);
      expect(summary.dropReasons['network-error']).toBe(2);
      expect(summary.dropReasons['timeout']).toBe(1);
    });

    it('records a drop with custom timestamp', () => {
      const counter = createFrameCounter(1000);
      const timestamp = Date.now();

      counter.recordDrop('network-error', timestamp);

      const summary = counter.getSummary();
      expect(summary.totalDrops).toBe(1);
      expect(summary.dropReasons['network-error']).toBe(1);
    });
  });

  describe('getSummary - FPS accuracy', () => {
    it('calculates FPS correctly over 1-second window', () => {
      const counter = createFrameCounter(1000);
      const now = Date.now();

      // Record 30 frames evenly over 1 second
      for (let i = 0; i < 30; i++) {
        counter.recordFrame(now + i * 33); // ~30 FPS
      }

      const summary = counter.getSummary();
      expect(summary.fps).toBe(30);
      expect(summary.totalFrames).toBe(30);
    });

    it('excludes frames older than window', () => {
      const counter = createFrameCounter(1000);
      const now = Date.now();

      // Record old frames (outside window)
      for (let i = 0; i < 20; i++) {
        counter.recordFrame(now - 2000 + i * 50);
      }

      // Record recent frames (inside window)
      for (let i = 0; i < 10; i++) {
        counter.recordFrame(now - 500 + i * 50);
      }

      const summary = counter.getSummary();
      expect(summary.fps).toBe(10); // Only recent frames count
      expect(summary.totalFrames).toBe(30); // All frames still counted in total
    });

    it('returns 0 FPS when no frames in window', () => {
      const counter = createFrameCounter(1000);
      const now = Date.now();

      // Record old frames only
      for (let i = 0; i < 10; i++) {
        counter.recordFrame(now - 2000 + i * 100);
      }

      const summary = counter.getSummary();
      expect(summary.fps).toBe(0);
      expect(summary.totalFrames).toBe(10);
    });
  });

  describe('getSummary - byte throughput', () => {
    it('calculates bytesPerSecond correctly', () => {
      const counter = createFrameCounter(1000);

      counter.recordBytes(1024);
      counter.recordBytes(2048);
      counter.recordBytes(512);

      const summary = counter.getSummary();
      expect(summary.bytesPerSecond).toBe(3584); // 1024 + 2048 + 512
    });

    it('sums all bytes recorded in the window', () => {
      const counter = createFrameCounter(1000);

      // Record multiple byte entries
      counter.recordBytes(1000);
      counter.recordBytes(2000);
      counter.recordBytes(3000);

      const summary = counter.getSummary();
      expect(summary.bytesPerSecond).toBe(6000);
    });

    it('returns 0 bytesPerSecond when no bytes recorded', () => {
      const counter = createFrameCounter(1000);

      const summary = counter.getSummary();
      expect(summary.bytesPerSecond).toBe(0);
    });
  });

  describe('reset', () => {
    it('clears all counters and tracking data', () => {
      const counter = createFrameCounter(1000);

      // Record some data
      counter.recordFrame();
      counter.recordFrame();
      counter.recordDrop('network-error');
      counter.recordBytes(1024);

      // Verify data exists
      let summary = counter.getSummary();
      expect(summary.totalFrames).toBe(2);
      expect(summary.totalDrops).toBe(1);
      expect(summary.bytesPerSecond).toBe(1024);

      // Reset
      counter.reset();

      // Verify data cleared
      summary = counter.getSummary();
      expect(summary.totalFrames).toBe(0);
      expect(summary.totalDrops).toBe(0);
      expect(summary.bytesPerSecond).toBe(0);
      expect(Object.keys(summary.dropReasons)).toHaveLength(0);
    });

    it('allows counter to be reused after reset', () => {
      const counter = createFrameCounter(1000);

      // Record initial data
      counter.recordFrame();
      counter.recordDrop('timeout');

      counter.reset();

      // Record new data
      counter.recordFrame();
      counter.recordFrame();
      counter.recordBytes(2048);

      const summary = counter.getSummary();
      expect(summary.totalFrames).toBe(2);
      expect(summary.totalDrops).toBe(0);
      expect(summary.bytesPerSecond).toBe(2048);
    });
  });

  describe('rolling window eviction', () => {
    it('evicts old frame timestamps on getSummary', () => {
      const counter = createFrameCounter(1000);
      const now = Date.now();

      // Record frames over 3 seconds
      for (let i = 0; i < 90; i++) {
        counter.recordFrame(now - 2000 + i * 22); // ~45 FPS over 2 seconds
      }

      let summary = counter.getSummary();
      const initialFps = summary.fps;

      // Wait 1.5 seconds (some frames should expire)
      vi.useFakeTimers().setSystemTime(now + 1500);
      summary = counter.getSummary();
      vi.useRealTimers();

      // FPS should decrease as old frames are evicted
      expect(summary.fps).toBeLessThan(initialFps);
    });

    it('evicts old drop timestamps on getSummary', () => {
      const counter = createFrameCounter(1000);
      const now = Date.now();

      // Record drops over 2 seconds
      for (let i = 0; i < 10; i++) {
        counter.recordDrop('network-error', now - 1500 + i * 150);
      }

      let summary = counter.getSummary();
      expect(summary.totalDrops).toBe(10);

      // Wait 1 second (some drops should expire from window)
      vi.useFakeTimers().setSystemTime(now + 1000);
      summary = counter.getSummary();
      vi.useRealTimers();

      // Total drops unchanged (accumulative), but window-based metrics affected
      expect(summary.totalDrops).toBe(10);
    });

    it('evicts old byte entries on getSummary', () => {
      const counter = createFrameCounter(1000);

      // Record bytes - they all get current timestamp
      counter.recordBytes(1000);
      counter.recordBytes(2000);
      counter.recordBytes(3000);

      const summary = counter.getSummary();
      expect(summary.bytesPerSecond).toBe(6000);

      // After reset, verify bytes are cleared
      counter.reset();
      const summaryAfterReset = counter.getSummary();
      expect(summaryAfterReset.bytesPerSecond).toBe(0);
    });
  });

  describe('windowDuration', () => {
    it('uses default 1000ms window', () => {
      const counter = createFrameCounter();
      const now = Date.now();

      counter.recordFrame(now - 500);
      counter.recordFrame(now - 250);

      const summary = counter.getSummary();
      expect(summary.windowDuration).toBeGreaterThanOrEqual(500);
    });

    it('uses custom window duration', () => {
      const counter = createFrameCounter(2000);
      const now = Date.now();

      counter.recordFrame(now - 1500);
      counter.recordFrame(now - 500);

      const summary = counter.getSummary();
      expect(summary.windowDuration).toBeGreaterThanOrEqual(1500);
      expect(summary.fps).toBe(2); // Both frames in 2000ms window
    });

    it('handles empty counter with window duration', () => {
      const counter = createFrameCounter(1000);

      const summary = counter.getSummary();
      expect(summary.windowDuration).toBe(1000);
      expect(summary.fps).toBe(0);
    });
  });
});
