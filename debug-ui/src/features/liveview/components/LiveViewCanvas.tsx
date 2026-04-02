import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  canvasToPageCoords,
  getImageFitRect,
  mjpegStreamParser,
  pageToCanvasCoords,
} from '@/features/liveview/lib/index.js';
import {
  selectConnectionStatus,
  selectPlaywrightIsOpen,
  useRuntimeStore,
} from '@/features/runtime/store/index.js';
import { useDebugSocket } from '@/features/runtime/hooks/index.js';
import type { ImageFitRect } from '@/features/liveview/lib/index.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './LiveViewCanvas.module.css';

const STREAM_URL = '/debug/api/playwright/screenshot/stream';
const DEFAULT_BOUNDARY = '--frameboundary';
const MARKER_LIFETIME = 5000;

interface Marker {
  canvasX: number;
  canvasY: number;
  pageX?: number;
  pageY?: number;
  timestamp: number;
}

interface OverlayBBox {
  x: number;
  y: number;
  width: number;
  height: number;
  selector?: string;
}

interface PickerCursor {
  canvasX: number;
  canvasY: number;
  pageX: number;
  pageY: number;
}

interface LiveViewMarkerMessage {
  type: string;
  x: number;
  y: number;
}

interface LiveViewOverlayMessage {
  type: string;
  bbox: OverlayBBox;
}

interface LiveViewCanvasProps {
  onElementSelect?: (selector: string) => void;
  onCoordinateCapture?: (coords: { x: number; y: number }) => void;
  className?: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readBoundary(contentType: string | null): string {
  const match = contentType?.match(/boundary=([^;]+)/i);
  if (!match) return DEFAULT_BOUNDARY;
  const rawBoundary = match[1]?.trim();
  if (!rawBoundary) return DEFAULT_BOUNDARY;
  return rawBoundary.startsWith('--') ? rawBoundary : `--${rawBoundary}`;
}

function normalizeMarkerMessage(payload: unknown): LiveViewMarkerMessage | null {
  if (!isObjectRecord(payload) || typeof payload.type !== 'string') {
    return null;
  }

  if (!payload.type.includes('marker')) {
    return null;
  }

  const x = payload.x;
  const y = payload.y;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return null;
  }

  return { type: payload.type, x, y };
}

function normalizeOverlayMessage(payload: unknown): LiveViewOverlayMessage | null {
  if (!isObjectRecord(payload) || typeof payload.type !== 'string') {
    return null;
  }

  if (!payload.type.includes('hover') && !payload.type.includes('highlight')) {
    return null;
  }

  const bbox = payload.bbox;
  if (!isObjectRecord(bbox)) {
    return null;
  }

  const x = bbox.x;
  const y = bbox.y;
  const width = bbox.width;
  const height = bbox.height;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return null;
  }

  const selector = typeof bbox.selector === 'string' ? bbox.selector : undefined;
  return {
    type: payload.type,
    bbox: { x, y, width, height, selector },
  };
}

export function LiveViewCanvas({
  onElementSelect,
  onCoordinateCapture,
  className,
}: LiveViewCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fitRectRef = useRef<ImageFitRect | null>(null);
  const currentBitmapRef = useRef<ImageBitmap | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamVersionRef = useRef(0);
  const overlayRafRef = useRef<number | null>(null);
  const pickerCursorRef = useRef<PickerCursor | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const overlayBBoxRef = useRef<OverlayBBox | null>(null);

  const [pickerActive, setPickerActive] = useState(false);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [overlayBBox, setOverlayBBox] = useState<OverlayBBox | null>(null);

  const isPlaywrightConnected = useRuntimeStore(selectPlaywrightIsOpen);
  const connectionStatus = useRuntimeStore(selectConnectionStatus);
  const { onMessage } = useDebugSocket();

  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  useEffect(() => {
    overlayBBoxRef.current = overlayBBox;
  }, [overlayBBox]);

  const drawRenderFrame = useCallback(() => {
    const renderCtx = renderCtxRef.current;
    const container = containerRef.current;
    const bitmap = currentBitmapRef.current;
    if (!renderCtx || !container || !bitmap) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const fit = getImageFitRect(bitmap.width, bitmap.height, containerRect.width, containerRect.height);
    if (!fit) {
      return;
    }

    fitRectRef.current = fit;
    renderCtx.clearRect(0, 0, containerRect.width, containerRect.height);
    renderCtx.drawImage(bitmap, fit.offsetX, fit.offsetY, fit.drawW, fit.drawH);
  }, []);

  const resizeCanvases = useCallback(() => {
    const container = containerRef.current;
    const renderCanvas = renderCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const renderCtx = renderCtxRef.current;
    const overlayCtx = overlayCtxRef.current;
    if (!container || !renderCanvas || !overlayCanvas || !renderCtx || !overlayCtx) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    const dpr = window.devicePixelRatio || 1;

    renderCanvas.width = width * dpr;
    renderCanvas.height = height * dpr;
    renderCanvas.style.width = `${width}px`;
    renderCanvas.style.height = `${height}px`;
    renderCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    overlayCanvas.width = width * dpr;
    overlayCanvas.height = height * dpr;
    overlayCanvas.style.width = `${width}px`;
    overlayCanvas.style.height = `${height}px`;
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawRenderFrame();
  }, [drawRenderFrame]);

  const drawCrosshair = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      size: number,
      color: string,
      lineWidth: number,
    ) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.lineTo(x + size, y);
      ctx.moveTo(x, y - size);
      ctx.lineTo(x, y + size);
      ctx.stroke();
      ctx.restore();
    },
    [],
  );

  const drawOverlayFrame = useCallback(() => {
    const overlayCtx = overlayCtxRef.current;
    const container = containerRef.current;
    if (!overlayCtx || !container) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    overlayCtx.clearRect(0, 0, containerRect.width, containerRect.height);

    const now = Date.now();
    const liveMarkers = markersRef.current.filter((marker) => now - marker.timestamp < MARKER_LIFETIME);
    if (liveMarkers.length !== markersRef.current.length) {
      markersRef.current = liveMarkers;
      setMarkers(liveMarkers);
    }

    for (const marker of liveMarkers) {
      const age = now - marker.timestamp;
      const alpha = Math.max(0, 1 - age / MARKER_LIFETIME);
      drawCrosshair(overlayCtx, marker.canvasX, marker.canvasY, 14, `rgba(255, 60, 60, ${alpha})`, 2);
    }

    const fit = fitRectRef.current;
    const currentOverlay = overlayBBoxRef.current;
    if (fit && currentOverlay) {
      const topLeft = pageToCanvasCoords(currentOverlay.x, currentOverlay.y, fit);
      const bottomRight = pageToCanvasCoords(
        currentOverlay.x + currentOverlay.width,
        currentOverlay.y + currentOverlay.height,
        fit,
      );
      overlayCtx.save();
      overlayCtx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([6, 4]);
      overlayCtx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
      overlayCtx.restore();
    }

    if (pickerActive && pickerCursorRef.current) {
      drawCrosshair(
        overlayCtx,
        pickerCursorRef.current.canvasX,
        pickerCursorRef.current.canvasY,
        20,
        'rgba(56, 189, 248, 0.85)',
        1.5,
      );
    }
  }, [drawCrosshair, pickerActive]);

  useEffect(() => {
    const renderCanvas = renderCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const container = containerRef.current;
    if (!renderCanvas || !overlayCanvas || !container) {
      return;
    }

    renderCtxRef.current = renderCanvas.getContext('2d');
    overlayCtxRef.current = overlayCanvas.getContext('2d');

    resizeCanvases();

    const observer = new ResizeObserver(() => {
      resizeCanvases();
      drawOverlayFrame();
    });
    observer.observe(container);
    resizeObserverRef.current = observer;

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [drawOverlayFrame, resizeCanvases]);

  useEffect(() => {
    const loop = () => {
      drawOverlayFrame();
      overlayRafRef.current = window.requestAnimationFrame(loop);
    };

    overlayRafRef.current = window.requestAnimationFrame(loop);

    return () => {
      if (overlayRafRef.current !== null) {
        window.cancelAnimationFrame(overlayRafRef.current);
        overlayRafRef.current = null;
      }
    };
  }, [drawOverlayFrame]);

  useEffect(() => {
    let cancelled = false;
    const streamVersion = ++streamVersionRef.current;

    const closeBitmap = () => {
      if (currentBitmapRef.current) {
        currentBitmapRef.current.close();
        currentBitmapRef.current = null;
      }
      fitRectRef.current = null;
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

    const startStream = async () => {
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      try {
        const response = await fetch(STREAM_URL, { signal: abortController.signal });
        if (!response.ok || !response.body) {
          return;
        }

        const boundary = readBoundary(response.headers.get('content-type'));
        for await (const jpegFrame of mjpegStreamParser(response.body, boundary)) {
          if (cancelled || streamVersion !== streamVersionRef.current) {
            break;
          }

          const frameBytes = Uint8Array.from(jpegFrame);
          const bitmap = await createImageBitmap(new Blob([frameBytes], { type: 'image/jpeg' }));
          if (cancelled || streamVersion !== streamVersionRef.current) {
            bitmap.close();
            break;
          }

          if (currentBitmapRef.current) {
            currentBitmapRef.current.close();
          }
          currentBitmapRef.current = bitmap;
          drawRenderFrame();
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
      }
    };

    void startStream();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [drawRenderFrame, isPlaywrightConnected]);

  useEffect(() => {
    const unsubscribe = onMessage((payload) => {
      const markerPayload = normalizeMarkerMessage(payload);
      if (markerPayload && fitRectRef.current) {
        const point = pageToCanvasCoords(markerPayload.x, markerPayload.y, fitRectRef.current);
        const now = Date.now();
        setMarkers((prev) => [
          ...prev,
          {
            canvasX: point.x,
            canvasY: point.y,
            pageX: markerPayload.x,
            pageY: markerPayload.y,
            timestamp: now,
          },
        ]);
      }

      const overlayPayload = normalizeOverlayMessage(payload);
      if (!overlayPayload) {
        return;
      }

      setOverlayBBox(overlayPayload.bbox);
      if (overlayPayload.bbox.selector && onElementSelect) {
        onElementSelect(overlayPayload.bbox.selector);
      }
    });

    return unsubscribe;
  }, [onElementSelect, onMessage]);

  const pushMarker = useCallback((marker: Marker) => {
    setMarkers((prev) => [...prev, marker]);
  }, []);

  const handleOverlayClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!pickerActive) {
        return;
      }

      const fit = fitRectRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      if (!fit || !overlayCanvas) {
        return;
      }

      const rect = overlayCanvas.getBoundingClientRect();
      const cssX = event.clientX - rect.left;
      const cssY = event.clientY - rect.top;
      const pageCoords = canvasToPageCoords(cssX, cssY, fit);
      if (!pageCoords) {
        return;
      }

      pushMarker({
        canvasX: cssX,
        canvasY: cssY,
        pageX: pageCoords.x,
        pageY: pageCoords.y,
        timestamp: Date.now(),
      });

      onCoordinateCapture?.(pageCoords);
    },
    [onCoordinateCapture, pickerActive, pushMarker],
  );

  const handleOverlayMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!pickerActive) {
        pickerCursorRef.current = null;
        return;
      }

      const fit = fitRectRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      if (!fit || !overlayCanvas) {
        pickerCursorRef.current = null;
        return;
      }

      const rect = overlayCanvas.getBoundingClientRect();
      const cssX = event.clientX - rect.left;
      const cssY = event.clientY - rect.top;
      const pageCoords = canvasToPageCoords(cssX, cssY, fit);
      if (!pageCoords) {
        pickerCursorRef.current = null;
        return;
      }

      pickerCursorRef.current = {
        canvasX: cssX,
        canvasY: cssY,
        pageX: pageCoords.x,
        pageY: pageCoords.y,
      };
    },
    [pickerActive],
  );

  const handleOverlayMouseLeave = useCallback(() => {
    pickerCursorRef.current = null;
  }, []);

  useEffect(() => {
    if (!pickerActive) {
      pickerCursorRef.current = null;
    }
  }, [pickerActive]);

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
      if (overlayRafRef.current !== null) {
        window.cancelAnimationFrame(overlayRafRef.current);
        overlayRafRef.current = null;
      }
      if (currentBitmapRef.current) {
        currentBitmapRef.current.close();
        currentBitmapRef.current = null;
      }
    };
  }, []);

  const containerClassName = useMemo(() => {
    return className ? `${styles.container} ${className}` : styles.container;
  }, [className]);

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      data-testid={testIds.liveviewCanvas}
      data-picker-active={pickerActive}
      data-marker-count={markers.length}
      data-has-overlay={overlayBBox ? 'true' : 'false'}
      data-connection-status={connectionStatus}
    >
      <canvas ref={renderCanvasRef} className={styles.renderCanvas} />
      <canvas
        ref={overlayCanvasRef}
        className={`${styles.overlayCanvas} ${pickerActive ? styles.overlayCanvasInteractive : ''}`}
        onClick={handleOverlayClick}
        onMouseMove={handleOverlayMouseMove}
        onMouseLeave={handleOverlayMouseLeave}
      />
      <button
        type='button'
        className={styles.pickerToggle}
        aria-pressed={pickerActive}
        data-testid='liveview-picker-toggle'
        onClick={() => setPickerActive((prev) => !prev)}
      >
        {pickerActive ? 'Picker: on' : 'Picker: off'}
      </button>
    </div>
  );
}

export type { LiveViewCanvasProps };
