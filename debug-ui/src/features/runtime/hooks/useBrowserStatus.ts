import { useCallback, useEffect, useRef } from 'react';

import {
  useRuntimeStore,
  type ServiceStatus,
} from '@/features/runtime/store/runtime.store.js';

/** Debug health endpoint returns rich playwright state. */
interface DebugHealthPlaywright {
  isOpen: boolean;
  url: string | null;
  title: string | null;
  status: 'unknown' | 'ready' | 'unhealthy';
}

interface DebugHealthResponse {
  services: {
    playwright?: DebugHealthPlaywright;
  };
}

const POLL_INTERVAL_MS = 4_000;

/** Maps the debug-health status string to our ServiceStatus union. */
function toServiceStatus(s: string | undefined): ServiceStatus {
  if (s === 'ready' || s === 'healthy') return 'ready';
  if (s === 'unhealthy') return 'unhealthy';
  return 'unknown';
}

/**
 * Polls `/debug/api/health` using serial setTimeout (not setInterval) to
 * prevent stale slow responses from overwriting fresh state.
 *
 * Exposes `refreshNow()` for immediate health probes on visibilitychange
 * and transport switch.
 *
 * Mount once in MonitorMainShell — the component that hosts LiveView.
 */
export function useBrowserStatus(): { refreshNow: () => Promise<void> } {
  const setPlaywrightIsOpen = useRuntimeStore((s) => s.setPlaywrightIsOpen);
  const setPlaywrightUrl = useRuntimeStore((s) => s.setPlaywrightUrl);
  const setPlaywrightStatus = useRuntimeStore((s) => s.setPlaywrightStatus);
  const setPlaywrightStatusHydrated = useRuntimeStore((s) => s.setPlaywrightStatusHydrated);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const disposedRef = useRef(false);

  // Stable setter refs so callbacks don't go stale
  const settersRef = useRef({
    setPlaywrightIsOpen,
    setPlaywrightUrl,
    setPlaywrightStatus,
    setPlaywrightStatusHydrated,
  });
  settersRef.current = {
    setPlaywrightIsOpen,
    setPlaywrightUrl,
    setPlaywrightStatus,
    setPlaywrightStatusHydrated,
  };

  const pollOnce = useCallback(async () => {
    // Abort any in-flight request from previous poll cycle
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;

    try {
      const res = await fetch('/debug/api/health', { signal: controller.signal });
      if (!res.ok || disposedRef.current) return;

      const data: DebugHealthResponse = await res.json();
      // Stale response guard: if a newer poll started, discard this result
      if (disposedRef.current || requestId !== requestIdRef.current) return;

      // Mark hydration complete — distinguishes "unprobed" from "confirmed closed"
      settersRef.current.setPlaywrightStatusHydrated(true);

      const pw = data.services?.playwright;
      if (!pw) return;

      settersRef.current.setPlaywrightIsOpen(pw.isOpen);
      settersRef.current.setPlaywrightUrl(pw.url ?? null);
      settersRef.current.setPlaywrightStatus(toServiceStatus(pw.status));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      // Network error — keep last known state, retry next cycle
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  const scheduleNext = useCallback(
    (delay = POLL_INTERVAL_MS) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (disposedRef.current) return;

      timerRef.current = setTimeout(async () => {
        await pollOnce();
        scheduleNext(POLL_INTERVAL_MS);
      }, delay);
    },
    [pollOnce],
  );

  const refreshNow = useCallback(async () => {
    // Cancel pending timer and abort in-flight request
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await pollOnce();
    scheduleNext(POLL_INTERVAL_MS);
  }, [pollOnce, scheduleNext]);

  useEffect(() => {
    disposedRef.current = false;
    void pollOnce().finally(() => scheduleNext(POLL_INTERVAL_MS));

    return () => {
      disposedRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      timerRef.current = null;
      abortRef.current = null;
    };
  }, [pollOnce, scheduleNext]);

  return { refreshNow };
}
