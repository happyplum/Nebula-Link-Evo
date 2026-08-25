import { useCallback, useEffect, useRef } from 'react';

import { applyPlaywrightStatus } from '@/features/runtime/lib/apply-playwright-status.js';
import { debugStreamClient } from '@/features/runtime/lib/debug-stream-client.js';
import { useDebugStream } from '@/features/runtime/hooks/useDebugStream.js';
import { useRuntimeStore, type ServiceStatus } from '@/features/runtime/store/runtime.store.js';

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
const STREAM_FALLBACK_GRACE_MS = 5_000;

/** Maps the debug-health status string to our ServiceStatus union. */
function toServiceStatus(s: string | undefined): ServiceStatus {
  if (s === 'ready' || s === 'healthy') return 'ready';
  if (s === 'unhealthy') return 'unhealthy';
  return 'unknown';
}

/**
 * Stream-first browser status orchestration.
 *
 * - Mounts the debug SSE transport through `useDebugStream()`.
 * - Keeps one immediate health probe for initial hydration.
 * - Falls back to 4s serial polling only after the stream stays unhealthy for 5s.
 */
export function useBrowserStatus(): { refreshNow: () => Promise<void> } {
  const setPlaywrightStatusHydrated = useRuntimeStore((s) => s.setPlaywrightStatusHydrated);
  const streamHealth = useDebugStream();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const disposedRef = useRef(false);
  const shouldPollRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearGracePeriod = useCallback(() => {
    if (graceTimerRef.current !== null) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, []);

  const pollOnce = useCallback(async () => {
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;

    try {
      const res = await fetch('/debug/api/health', { signal: controller.signal });
      if (!res.ok || disposedRef.current) return;

      const data: DebugHealthResponse = await res.json();
      if (disposedRef.current || requestId !== requestIdRef.current) return;

      const pw = data.services?.playwright;
      if (!pw) {
        setPlaywrightStatusHydrated(true);
        return;
      }

      applyPlaywrightStatus({
        isOpen: pw.isOpen,
        url: pw.url ?? null,
        title: pw.title ?? null,
        status: toServiceStatus(pw.status),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      // Network error — keep last known state, retry next cycle.
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [setPlaywrightStatusHydrated]);

  const scheduleNext = useCallback(
    (delay = POLL_INTERVAL_MS) => {
      stopPolling();
      if (disposedRef.current || !shouldPollRef.current) return;

      timerRef.current = setTimeout(async () => {
        await pollOnce();
        if (shouldPollRef.current) {
          scheduleNext(POLL_INTERVAL_MS);
        }
      }, delay);
    },
    [pollOnce, stopPolling]
  );

  const refreshNow = useCallback(async () => {
    stopPolling();
    await pollOnce();
    if (shouldPollRef.current) {
      scheduleNext(POLL_INTERVAL_MS);
    }
  }, [pollOnce, scheduleNext, stopPolling]);

  useEffect(() => {
    disposedRef.current = false;
    void pollOnce();

    return () => {
      disposedRef.current = true;
      stopPolling();
      clearGracePeriod();
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [clearGracePeriod, pollOnce, stopPolling]);

  useEffect(() => {
    const streamConnected = debugStreamClient.getConnectionState() === 'connected';
    const hasUnrecoveredStreamError =
      streamHealth.lastErrorAt > 0 && streamHealth.lastErrorAt > streamHealth.lastMessageAt;
    const shouldUseFallback = !streamConnected || hasUnrecoveredStreamError;

    shouldPollRef.current = false;

    if (!shouldUseFallback) {
      stopPolling();
      clearGracePeriod();
      return;
    }

    stopPolling();
    clearGracePeriod();

    graceTimerRef.current = setTimeout(() => {
      if (disposedRef.current) return;

      const stillDisconnected = debugStreamClient.getConnectionState() !== 'connected';
      const stillErrored =
        streamHealth.lastErrorAt > 0 && streamHealth.lastErrorAt > streamHealth.lastMessageAt;

      if (!stillDisconnected && !stillErrored) {
        shouldPollRef.current = false;
        return;
      }

      shouldPollRef.current = true;
      scheduleNext(POLL_INTERVAL_MS);
    }, STREAM_FALLBACK_GRACE_MS);

    return () => {
      clearGracePeriod();
    };
  }, [clearGracePeriod, scheduleNext, stopPolling, streamHealth]);

  return { refreshNow };
}
