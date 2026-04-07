import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMjpegTransform, getImageFitRect } from '@/features/liveview/lib/index.js';
import type { ImageFitRect } from '@/features/liveview/lib/index.js';
import {
  selectConnectionStatus,
  selectPlaywrightIsOpen,
  useRuntimeStore,
} from '@/features/runtime/store/index.js';
import { testIds } from '@/shared/testing/testids.js';
import { LiveViewOverlayLayer } from './LiveViewOverlayLayer.js';
import styles from './LiveViewCanvas.module.css';

const STREAM_URL = '/debug/api/playwright/screenshot/stream';
const DEFAULT_BOUNDARY = '--frameboundary';

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
  const downloadUrlRef = useRef<string | null>(null);
  const lastFrameBlobRef = useRef<Blob | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamVersionRef = useRef(0);
  const [fitRect, setFitRect] = useState<ImageFitRect | null>(null);

  const isPlaywrightConnected = useRuntimeStore(selectPlaywrightIsOpen);
  const connectionStatus = useRuntimeStore(selectConnectionStatus);
  const setLastScreenshotDataUrl = useRuntimeStore((s) => s.setLastScreenshotDataUrl);

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
    currentBitmapRef.current = null;
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

  useEffect(() => {
    let cancelled = false;
    const streamVersion = ++streamVersionRef.current;

    const closeBitmap = () => {
      if (currentBitmapRef.current) {
        currentBitmapRef.current.close();
        currentBitmapRef.current = null;
      }
      fitRectRef.current = null;
      setFitRect(null);
      replaceDownloadUrl(null, true);
    };

    const stopStream = () => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
      closeBitmap();
    };

    if (!isPlaywrightConnected) {
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

            if (currentBitmapRef.current) {
              continue;
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
      stopStream();
    };
  }, [drawRenderFrame, isPlaywrightConnected, replaceDownloadUrl]);

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
      setFitRect(null);
      replaceDownloadUrl(null, true);
    };
  }, [replaceDownloadUrl]);

  const containerClassName = useMemo(() => {
    return className ? `${styles.container} ${className}` : styles.container;
  }, [className]);

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      data-testid={testIds.liveviewCanvas}
      data-connection-status={connectionStatus}
    >
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
