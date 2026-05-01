import { useEffect, useRef } from 'react';

import {
  useRuntimeStore,
  type ServiceStatus,
} from '@/features/runtime/store/runtime.store.js';
import {
  useControlStore,
} from '@/features/playwright-control/store/control.store.js';

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
 * Polls `/debug/api/health` at a fixed interval and syncs the playwright
 * browser state (isOpen, url, status) into the runtime Zustand store.
 *
 * Mount once in MonitorMainShell — the component that hosts LiveView.
 */
export function useBrowserStatus(): void {
  const setPlaywrightIsOpen = useRuntimeStore((s) => s.setPlaywrightIsOpen);
  const setPlaywrightUrl = useRuntimeStore((s) => s.setPlaywrightUrl);
  const setPlaywrightStatus = useRuntimeStore((s) => s.setPlaywrightStatus);
  const setBrowserOpen = useControlStore((s) => s.setBrowserOpen);
  const setBrowserUrl = useControlStore((s) => s.setBrowserUrl);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/debug/api/health');
        if (!res.ok || cancelled) return;
        const data: DebugHealthResponse = await res.json();
        const pw = data.services?.playwright;
        if (!pw) return;

        setPlaywrightIsOpen(pw.isOpen);
        setPlaywrightUrl(pw.url ?? null);
        setPlaywrightStatus(toServiceStatus(pw.status));
        setBrowserOpen(pw.isOpen);
        setBrowserUrl(pw.url ?? '');
      } catch {
        // Network error — keep last known state, retry next interval
      }
    }

    // Fire immediately, then at interval
    poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [setPlaywrightIsOpen, setPlaywrightUrl, setPlaywrightStatus, setBrowserOpen, setBrowserUrl]);
}
