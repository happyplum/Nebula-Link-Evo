import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFrameCounter } from '@nebula-link-evo/shared';
import type { FrameCounter } from '@nebula-link-evo/shared';
import { createMjpegTransform, getImageFitRect } from '@/features/liveview/lib/index.js';
import type { ImageFitRect } from '@/features/liveview/lib/index.js';
import {
  selectLiveviewRefreshKey,
  selectPlaywrightIsOpen,
  selectPlaywrightStatusHydrated,
  useRuntimeStore,
} from '@/features/runtime/store/index.js';
import { testIds } from '@/shared/testing/testids.js';
import { LiveViewOverlayLayer } from './LiveViewOverlayLayer.js';
import styles from './LiveViewCanvas.module.css';

const STREAM_URL = '/debug/api/playwright/screenshot/stream';
const DEFAULT_BOUNDARY = '--frameboundary';

// --- Debug frame counter (compile-time, tree-shaken when VITE_VIDEO_DEBUG !== '1') ---
const VIDEO_DEBUG = import.meta.env.VITE_VIDEO_DEBUG === '1';

interface LiveViewCanvasProps {
  onElementSelect?: (selector: string) => void;
  onCoordinateCapture?: (coords: { x: number; y: number }) => void;
  className?: string;
}

function readBoundary(contentType: string | null): string {
  const match = contentType?.match(/boundary=([^;]+)/i);
  if (!match) return DEFAULT_BOUNDARY;
  const rawBoundary = match[1]?.trim();
  if (!rawBoundary) return DEFAULT_BOUNDARY;
  return rawBoundary.startsWith('--') ? rawBoundary : `--${rawBoundary}`;
}

export function LiveViewCanvas({
  onElementSelect,
  onCoordinateCapture,
  className,
}: LiveViewCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderCtxRef = useRef<ImageBitmapRenderingContext | null>(null);
  const fitRectRef = useRef<ImageFitRect | null>(null);
  const currentBitmapRef = useRef<ImageBitmap | null>(null);
  const lastBitmapSizeRef = useRef<{ w: number; h: number } | null>(null);
  const downloadUrlRef = useRef<string | null>(null);
  const lastFrameBlobRef = useRef<Blob | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamVersionRef = useRef(0);
  const debugCounterRef = useRef<FrameCounter | null>(null);
  const [fitRect, setFitRect] = useState<ImageFitRect | null>(null);

  const isPlaywrightConnected = useRuntimeStore(selectPlaywrightIsOpen);
  const playwrightStatusHydrated = useRuntimeStore(selectPlaywrightStatusHydrated);
  const liveviewRefreshKey = useRuntimeStore(selectLiveviewRefreshKey);
  const setLastScreenshotDataUrl = useRuntimeStore((s) => s.setLastScreenshotDataUrl);

  // Optimistic bootstrap: start transport before health confirms browser is open.
  // Only skip/cleanup when health has confirmed the browser is CLOSED.
  const shouldStartTransport = isPlaywrightConnected || !playwrightStatusHydrated;
  const isConfirmedDisconnected = playwrightStatusHydrated && !isPlaywrightConnected;

  // Track connection state for cleanup: distinguish tab-switch refresh from real disconnect
  const isConfirmedDisconnectedRef = useRef(isConfirmedDisconnected);

  // Sync ref with latest value after render
  useEffect(() => {
    isConfirmedDisconnectedRef.current = isConfirmedDisconnected;
  }, [isConfirmedDisconnected]);

  const replaceDownloadUrl = useCallback(
    (nextBlob: Blob | null, revokeCurrent: boolean) => {
      const previousUrl = downloadUrlRef.current;
      if (
        revokeCurrent &&
        previousUrl &&
        previousUrl.startsWith('blob:') &&
        typeof URL.revokeObjectURL === 'function'
      ) {
        URL.revokeObjectURL(previousUrl);
        downloadUrlRef.current = null;
      }

      lastFrameBlobRef.current = nextBlob;
      if (nextBlob) {
        const url =
          typeof URL.createObjectURL === 'function' ? URL.createObjectURL(nextBlob) : null;
        downloadUrlRef.current = url;
        setLastScreenshotDataUrl(url);
      } else {
        setLastScreenshotDataUrl(null);
      }
    },
    [setLastScreenshotDataUrl]
  );

  const drawRenderFrame = useCallback(() => {
    const bitmapCtx = renderCtxRef.current;
    const renderCanvas = renderCanvasRef.current;
    const container = containerRef.current;
    const bitmap = currentBitmapRef.current;
    if (!bitmapCtx || !renderCanvas || !container || !bitmap) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const nextFitRect = getImageFitRect(
      bitmap.width,
      bitmap.height,
      containerRect.width,
      containerRect.height
    );
    if (!nextFitRect) {
      setFitRect(null);
      return;
    }

    fitRectRef.current = nextFitRect;
    setFitRect(nextFitRect);

    renderCanvas.style.left = `${nextFitRect.offsetX}px`;
    renderCanvas.style.top = `${nextFitRect.offsetY}px`;
    renderCanvas.style.width = `${nextFitRect.drawW}px`;
    renderCanvas.style.height = `${nextFitRect.drawH}px`;

    bitmapCtx.transferFromImageBitmap(bitmap);
    lastBitmapSizeRef.current = { w: bitmap.width, h: bitmap.height };
    currentBitmapRef.current = null;
    debugCounterRef.current?.recordFrame();
  }, []);

  const resizeCanvases = useCallback(() => {
    const container = containerRef.current;
    const renderCanvas = renderCanvasRef.current;
    if (!container || !renderCanvas) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    // bitmaprenderer backing store persists after transferFromImageBitmap.
    // On resize we only need to recalculate CSS dimensions for correct aspect ratio.
    const lastSize = lastBitmapSizeRef.current;
    if (lastSize) {
      const fit = getImageFitRect(lastSize.w, lastSize.h, width, height);
      if (fit) {
        fitRectRef.current = fit;
        setFitRect(fit);
        renderCanvas.style.left = `${fit.offsetX}px`;
        renderCanvas.style.top = `${fit.offsetY}px`;
        renderCanvas.style.width = `${fit.drawW}px`;
        renderCanvas.style.height = `${fit.drawH}px`;
        return;
      }
    }

    renderCanvas.style.left = '0';
    renderCanvas.style.top = '0';
    renderCanvas.style.width = `${width}px`;
    renderCanvas.style.height = `${height}px`;

    drawRenderFrame();
  }, [drawRenderFrame]);

  useEffect(() => {
    const renderCanvas = renderCanvasRef.current;
    const container = containerRef.current;
    if (!renderCanvas || !container) {
      return;
    }

    renderCtxRef.current = renderCanvas.getContext('bitmaprenderer');
    resizeCanvases();

    const observer = new ResizeObserver(() => {
      resizeCanvases();
    });
    observer.observe(container);
    resizeObserverRef.current = observer;

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [resizeCanvases]);

  // Initialize debug frame counter when VIDEO_DEBUG is true
  useEffect(() => {
    if (VIDEO_DEBUG) {
      const counter = createFrameCounter(1000);
      debugCounterRef.current = counter;
      const interval = setInterval(() => {
        console.log('[NLE-Debug] canvas', counter.getSummary());
      }, 1000);
      return () => {
        clearInterval(interval);
        debugCounterRef.current = null;
      };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // liveviewRefreshKey triggers stream reconnection on tab switch
    void liveviewRefreshKey;
    const streamVersion = ++streamVersionRef.current;

    const clearVisualState = () => {
      fitRectRef.current = null;
      setFitRect(null);
      lastBitmapSizeRef.current = null;
      replaceDownloadUrl(null, true);
    };

    const closeBitmap = () => {
      if (currentBitmapRef.current) {
        currentBitmapRef.current.close();
        currentBitmapRef.current = null;
      }
      clearVisualState();
    };

    const abortStream = () => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
    };

    const stopStream = () => {
      abortStream();
      closeBitmap();
    };

    if (!shouldStartTransport) {
      stopStream();
      return undefined;
    }

    const startPolling = async () => {
      if (cancelled) return;

      try {
        const response = await fetch('/debug/api/playwright/screenshot');
        if (response.ok) {
          const data = await response.json();
          if (data.screenshot) {
            const base64Data = `data:image/png;base64,${data.screenshot}`;
            const imgBlob = await fetch(base64Data).then((r) => r.blob());
            replaceDownloadUrl(imgBlob, true);
            const bitmap = await createImageBitmap(imgBlob);
            if (!cancelled && streamVersion === streamVersionRef.current) {
              if (currentBitmapRef.current) currentBitmapRef.current.close();
              currentBitmapRef.current = bitmap;
              drawRenderFrame();
            } else {
              bitmap.close();
            }
          }
        }
      } catch {
        // ignore errors in polling
      }

      if (!cancelled && streamVersion === streamVersionRef.current) {
        setTimeout(startPolling, 500);
      }
    };

    const startStream = async () => {
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      try {
        const response = await fetch(STREAM_URL, { signal: abortController.signal });
        if (!response.ok || !response.body) {
          startPolling();
          return;
        }

        const boundary = readBoundary(response.headers.get('content-type'));
        const transform = createMjpegTransform(boundary);
        const frameStream = response.body.pipeThrough(transform);
        const reader = frameStream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done || cancelled || streamVersion !== streamVersionRef.current) {
              break;
            }

            // Close previous unrendered bitmap instead of skipping frames.
            // The old skip logic (continue) caused permanent frame starvation
            // if drawRenderFrame ever failed — all subsequent frames were discarded.
            if (currentBitmapRef.current) {
              currentBitmapRef.current.close();
              currentBitmapRef.current = null;
            }

            const frameBlob = new Blob([value.slice()], { type: 'image/jpeg' });
            replaceDownloadUrl(frameBlob, true);
            const bitmap = await createImageBitmap(frameBlob);
            if (cancelled || streamVersion !== streamVersionRef.current) {
              bitmap.close();
              break;
            }

            currentBitmapRef.current = bitmap;
            drawRenderFrame();
          }
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        startPolling();
      }
    };

    void startStream();

    return () => {
      cancelled = true;
      abortStream();
      // Close unrendered bitmap to prevent leak, but don't clear the canvas.
      // The last transferFromImageBitmap result stays visible on the canvas.
      if (currentBitmapRef.current) {
        currentBitmapRef.current.close();
        currentBitmapRef.current = null;
      }
      // Only clear visual state on confirmed disconnect (hydrated && closed),
      // not on tab-switch refresh or optimistic bootstrap phase — keep the last frame visible.
      if (isConfirmedDisconnectedRef.current) {
        clearVisualState();
      }
    };
  }, [drawRenderFrame, shouldStartTransport, liveviewRefreshKey, replaceDownloadUrl]);

  useEffect(() => {
    return () => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (currentBitmapRef.current) {
        currentBitmapRef.current.close();
        currentBitmapRef.current = null;
      }
      fitRectRef.current = null;
      lastBitmapSizeRef.current = null;
      setFitRect(null);
      replaceDownloadUrl(null, true);
    };
  }, [replaceDownloadUrl]);

  const containerClassName = useMemo(() => {
    return className ? `${styles.container} ${className}` : styles.container;
  }, [className]);

  return (
    <div ref={containerRef} className={containerClassName} data-testid={testIds.liveviewCanvas}>
      <canvas ref={renderCanvasRef} className={styles.renderCanvas} />
      <LiveViewOverlayLayer
        fitRect={fitRect}
        onElementSelect={onElementSelect}
        onCoordinateCapture={onCoordinateCapture}
      />
    </div>
  );
}

export type { LiveViewCanvasProps };
