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
import {
  useControlStore,
  selectSelectedElement,
  selectDomElements,
  selectMarkerToggle,
  type SelectedElement,
} from '@/features/playwright-control/store/control.store.js';
import { getElementAt } from '@/features/playwright-control/api/control.adapters.js';
import { findDomElementAtPoint } from '@/features/playwright-control/lib/index.js';
import styles from './LiveViewCanvas.module.css';

const STREAM_URL = '/debug/api/playwright/screenshot/stream';
const DEFAULT_BOUNDARY = '--frameboundary';
const MARKER_LIFETIME = 5000;
const HOVER_DEBOUNCE_MS = 120;

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
  const downloadUrlRef = useRef<string | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamVersionRef = useRef(0);
  const overlayRafRef = useRef<number | null>(null);
  const hoverDebounceRef = useRef<number | null>(null);
  const pickerCursorRef = useRef<PickerCursor | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const overlayBBoxRef = useRef<OverlayBBox | null>(null);
  const hoveredElementRef = useRef<SelectedElement | null>(null);

  const [markers, setMarkers] = useState<Marker[]>([]);
  const [overlayBBox, setOverlayBBox] = useState<OverlayBBox | null>(null);
  const [hoveredElement, setHoveredElement] = useState<SelectedElement | null>(null);

  const isPlaywrightConnected = useRuntimeStore(selectPlaywrightIsOpen);
  const connectionStatus = useRuntimeStore(selectConnectionStatus);
  const setLastScreenshotDataUrl = useRuntimeStore((s) => s.setLastScreenshotDataUrl);
  const { onMessage } = useDebugSocket();
  const elementPickerEnabled = useControlStore((s) => s.elementPickerEnabled);
  const setElementPickerEnabled = useControlStore((s) => s.setElementPickerEnabled);
  const setCapturedCoordinates = useControlStore((s) => s.setCapturedCoordinates);
  const setSelectedElement = useControlStore((s) => s.setSelectedElement);
  const setHighlightedElementId = useControlStore((s) => s.setHighlightedElementId);
  const selectedElement = useControlStore(selectSelectedElement);
  const domElements = useControlStore(selectDomElements);
  const markerToggle = useControlStore(selectMarkerToggle);
  const selectedElementRef = useRef<SelectedElement | null>(null);
  const domElementsRef = useRef(domElements);
  const markerToggleRef = useRef(markerToggle);

  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  useEffect(() => {
    overlayBBoxRef.current = overlayBBox;
  }, [overlayBBox]);

  useEffect(() => {
    hoveredElementRef.current = hoveredElement;
  }, [hoveredElement]);

  useEffect(() => {
    selectedElementRef.current = selectedElement;
  }, [selectedElement]);

  useEffect(() => {
    domElementsRef.current = domElements;
  }, [domElements]);

  useEffect(() => {
    markerToggleRef.current = markerToggle;
  }, [markerToggle]);

  const replaceDownloadUrl = useCallback(
    (nextUrl: string | null, revokeCurrent: boolean) => {
      const previousUrl = downloadUrlRef.current;
      if (
        revokeCurrent &&
        previousUrl &&
        previousUrl.startsWith('blob:') &&
        typeof URL.revokeObjectURL === 'function'
      ) {
        URL.revokeObjectURL(previousUrl);
      }

      downloadUrlRef.current = nextUrl;
      setLastScreenshotDataUrl(nextUrl);
    },
    [setLastScreenshotDataUrl]
  );

  const drawRenderFrame = useCallback(() => {
    const renderCtx = renderCtxRef.current;
    const container = containerRef.current;
    const bitmap = currentBitmapRef.current;
    if (!renderCtx || !container || !bitmap) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const fit = getImageFitRect(
      bitmap.width,
      bitmap.height,
      containerRect.width,
      containerRect.height
    );
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
      lineWidth: number
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
    []
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
    const liveMarkers = markersRef.current.filter(
      (marker) => now - marker.timestamp < MARKER_LIFETIME
    );
    if (liveMarkers.length !== markersRef.current.length) {
      markersRef.current = liveMarkers;
      setMarkers(liveMarkers);
    }

    for (const marker of liveMarkers) {
      const age = now - marker.timestamp;
      const alpha = Math.max(0, 1 - age / MARKER_LIFETIME);
      drawCrosshair(
        overlayCtx,
        marker.canvasX,
        marker.canvasY,
        14,
        `rgba(255, 60, 60, ${alpha})`,
        2
      );
    }

    const fit = fitRectRef.current;
    const currentOverlay = overlayBBoxRef.current;
    const currentHovered = hoveredElementRef.current;
    if (fit && currentOverlay) {
      const topLeft = pageToCanvasCoords(currentOverlay.x, currentOverlay.y, fit);
      const bottomRight = pageToCanvasCoords(
        currentOverlay.x + currentOverlay.width,
        currentOverlay.y + currentOverlay.height,
        fit
      );
      overlayCtx.save();
      overlayCtx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([6, 4]);
      overlayCtx.strokeRect(
        topLeft.x,
        topLeft.y,
        bottomRight.x - topLeft.x,
        bottomRight.y - topLeft.y
      );
      overlayCtx.restore();
    }

    if (fit && elementPickerEnabled && currentHovered?.bbox) {
      const hoverTopLeft = pageToCanvasCoords(currentHovered.bbox.x, currentHovered.bbox.y, fit);
      const hoverBottomRight = pageToCanvasCoords(
        currentHovered.bbox.x + currentHovered.bbox.width,
        currentHovered.bbox.y + currentHovered.bbox.height,
        fit
      );
      overlayCtx.save();
      overlayCtx.strokeStyle = 'rgba(0, 150, 255, 0.75)';
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([]);
      overlayCtx.strokeRect(
        hoverTopLeft.x,
        hoverTopLeft.y,
        hoverBottomRight.x - hoverTopLeft.x,
        hoverBottomRight.y - hoverTopLeft.y
      );
      overlayCtx.fillStyle = 'rgba(0, 150, 255, 0.12)';
      overlayCtx.fillRect(
        hoverTopLeft.x,
        hoverTopLeft.y,
        hoverBottomRight.x - hoverTopLeft.x,
        hoverBottomRight.y - hoverTopLeft.y
      );
      overlayCtx.restore();
    }

    // DOM row highlight: draw selected element bbox from control store
    const currentSelected = selectedElementRef.current;
    if (fit && currentSelected?.bbox) {
      const selTopLeft = pageToCanvasCoords(currentSelected.bbox.x, currentSelected.bbox.y, fit);
      const selBottomRight = pageToCanvasCoords(
        currentSelected.bbox.x + currentSelected.bbox.width,
        currentSelected.bbox.y + currentSelected.bbox.height,
        fit
      );
      overlayCtx.save();
      overlayCtx.strokeStyle = 'rgba(34, 197, 94, 0.9)';
      overlayCtx.lineWidth = 2.5;
      overlayCtx.setLineDash([]);
      overlayCtx.strokeRect(
        selTopLeft.x,
        selTopLeft.y,
        selBottomRight.x - selTopLeft.x,
        selBottomRight.y - selTopLeft.y
      );
      // Light fill for visibility
      overlayCtx.fillStyle = 'rgba(34, 197, 94, 0.08)';
      overlayCtx.fillRect(
        selTopLeft.x,
        selTopLeft.y,
        selBottomRight.x - selTopLeft.x,
        selBottomRight.y - selTopLeft.y
      );
      overlayCtx.restore();
    }

    if (markerToggleRef.current && fit) {
      overlayCtx.save();
      overlayCtx.font = 'bold 12px monospace';
      overlayCtx.textAlign = 'center';
      overlayCtx.textBaseline = 'middle';
      for (const el of domElementsRef.current) {
        if (!el.bbox || !el.isVisible) continue;
        const topLeft = pageToCanvasCoords(el.bbox.x, el.bbox.y, fit);
        const bottomRight = pageToCanvasCoords(
          el.bbox.x + el.bbox.width,
          el.bbox.y + el.bbox.height,
          fit
        );

        // Draw small background for text readability
        const w = 18;
        const h = 14;
        overlayCtx.fillStyle = 'rgba(239, 68, 68, 0.9)'; // Red
        overlayCtx.fillRect(topLeft.x, topLeft.y, w, h);

        overlayCtx.fillStyle = '#ffffff';
        overlayCtx.fillText(String(el.markerNumber), topLeft.x + w / 2, topLeft.y + h / 2 + 1);

        // Light border
        overlayCtx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
        overlayCtx.lineWidth = 1;
        overlayCtx.strokeRect(
          topLeft.x,
          topLeft.y,
          bottomRight.x - topLeft.x,
          bottomRight.y - topLeft.y
        );
      }
      overlayCtx.restore();
    }

    if (elementPickerEnabled && pickerCursorRef.current) {
      overlayCtx.save();
      overlayCtx.font = '11px "JetBrains Mono", monospace';
      const text = `X: ${pickerCursorRef.current.pageX}, Y: ${pickerCursorRef.current.pageY}`;
      const metrics = overlayCtx.measureText(text);
      const tx = pickerCursorRef.current.canvasX + 18;
      const ty = pickerCursorRef.current.canvasY - 18;
      overlayCtx.fillStyle = 'rgba(20, 20, 30, 0.85)';
      overlayCtx.strokeStyle = 'rgba(0, 150, 255, 0.5)';
      overlayCtx.lineWidth = 1;
      overlayCtx.fillRect(tx - 5, ty - 13, metrics.width + 10, 20);
      overlayCtx.strokeRect(tx - 5, ty - 13, metrics.width + 10, 20);
      overlayCtx.fillStyle = '#8fdcff';
      overlayCtx.fillText(text, tx, ty);
      overlayCtx.restore();

      drawCrosshair(
        overlayCtx,
        pickerCursorRef.current.canvasX,
        pickerCursorRef.current.canvasY,
        20,
        'rgba(56, 189, 248, 0.85)',
        1.5
      );
    }
  }, [drawCrosshair, elementPickerEnabled]);

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
            replaceDownloadUrl(`data:image/png;base64,${data.screenshot}`, true);
            const imgBlob = await fetch(`data:image/png;base64,${data.screenshot}`).then((r) =>
              r.blob()
            );
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
      } catch (e) {
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
        for await (const jpegFrame of mjpegStreamParser(response.body, boundary)) {
          if (cancelled || streamVersion !== streamVersionRef.current) {
            break;
          }

          const frameBytes = Uint8Array.from(jpegFrame);
          const frameBlob = new Blob([frameBytes], { type: 'image/jpeg' });
          const downloadUrl =
            typeof URL.createObjectURL === 'function' ? URL.createObjectURL(frameBlob) : null;
          replaceDownloadUrl(downloadUrl, true);
          const bitmap = await createImageBitmap(frameBlob);
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

  const buildSelectedElement = useCallback(
    (
      pageX: number,
      pageY: number,
      element: Awaited<ReturnType<typeof getElementAt>>['element'] | undefined
    ): SelectedElement | null => {
      const domMatch = findDomElementAtPoint(domElementsRef.current, pageX, pageY);
      if (!element && !domMatch) {
        return null;
      }

      const attributes: Record<string, string> = {
        ...(element?.id ? { id: element.id } : {}),
        ...(element?.class ? { class: element.class } : {}),
        ...(element?.type ? { type: element.type } : {}),
        ...(element?.name ? { name: element.name } : {}),
        ...(element?.placeholder ? { placeholder: element.placeholder } : {}),
        ...(domMatch?.dataNebulaId ? { 'data-nebula-id': domMatch.dataNebulaId } : {}),
      };

      return {
        selector:
          element?.selector ??
          (domMatch?.dataNebulaId
            ? `[data-nebula-id="${domMatch.dataNebulaId}"]`
            : (domMatch?.tag ?? '')),
        tag: element?.tag ?? domMatch?.tag ?? 'unknown',
        text: element?.text ?? domMatch?.text,
        attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
        markerNumber: domMatch?.markerNumber,
        bbox: element?.bbox ?? domMatch?.bbox,
        dataNebulaId: domMatch?.dataNebulaId,
      };
    },
    []
  );

  const handleOverlayClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
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

      setCapturedCoordinates(pageCoords);
      onCoordinateCapture?.(pageCoords);

      if (!elementPickerEnabled) {
        setSelectedElement(null);
        setHighlightedElementId(null);
        return;
      }

      void (async () => {
        try {
          const response = await getElementAt(pageCoords.x, pageCoords.y);
          const nextSelected = buildSelectedElement(pageCoords.x, pageCoords.y, response.element);
          setSelectedElement(nextSelected);
          setHighlightedElementId(
            nextSelected?.dataNebulaId ??
              (nextSelected?.markerNumber !== undefined ? String(nextSelected.markerNumber) : null)
          );
        } catch {
          const nextSelected = buildSelectedElement(pageCoords.x, pageCoords.y, undefined);
          setSelectedElement(nextSelected);
          setHighlightedElementId(
            nextSelected?.dataNebulaId ??
              (nextSelected?.markerNumber !== undefined ? String(nextSelected.markerNumber) : null)
          );
        }
      })();
    },
    [
      buildSelectedElement,
      elementPickerEnabled,
      onCoordinateCapture,
      pushMarker,
      setCapturedCoordinates,
      setHighlightedElementId,
      setSelectedElement,
    ]
  );

  const handleOverlayMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!elementPickerEnabled) {
        pickerCursorRef.current = null;
        setHoveredElement(null);
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
        setHoveredElement(null);
        return;
      }

      pickerCursorRef.current = {
        canvasX: cssX,
        canvasY: cssY,
        pageX: pageCoords.x,
        pageY: pageCoords.y,
      };

      if (hoverDebounceRef.current !== null) {
        window.clearTimeout(hoverDebounceRef.current);
      }

      hoverDebounceRef.current = window.setTimeout(() => {
        void (async () => {
          try {
            const response = await getElementAt(pageCoords.x, pageCoords.y);
            const nextHovered = buildSelectedElement(pageCoords.x, pageCoords.y, response.element);
            setHoveredElement(nextHovered);
          } catch {
            const nextHovered = buildSelectedElement(pageCoords.x, pageCoords.y, undefined);
            setHoveredElement(nextHovered);
          }
        })();
      }, HOVER_DEBOUNCE_MS);
    },
    [buildSelectedElement, elementPickerEnabled]
  );

  const handleOverlayMouseLeave = useCallback(() => {
    pickerCursorRef.current = null;
    setHoveredElement(null);
    if (hoverDebounceRef.current !== null) {
      window.clearTimeout(hoverDebounceRef.current);
      hoverDebounceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!elementPickerEnabled) {
      pickerCursorRef.current = null;
      setHoveredElement(null);
      if (hoverDebounceRef.current !== null) {
        window.clearTimeout(hoverDebounceRef.current);
        hoverDebounceRef.current = null;
      }
    }
  }, [elementPickerEnabled]);

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
      if (hoverDebounceRef.current !== null) {
        window.clearTimeout(hoverDebounceRef.current);
        hoverDebounceRef.current = null;
      }
      if (currentBitmapRef.current) {
        currentBitmapRef.current.close();
        currentBitmapRef.current = null;
      }
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
      data-picker-active={elementPickerEnabled}
      data-marker-count={markers.length}
      data-has-overlay={overlayBBox || hoveredElement ? 'true' : 'false'}
      data-has-dom-highlight={selectedElement?.bbox ? 'true' : 'false'}
      data-connection-status={connectionStatus}
    >
      <canvas ref={renderCanvasRef} className={styles.renderCanvas} />
      <canvas
        ref={overlayCanvasRef}
        className={`${styles.overlayCanvas} ${elementPickerEnabled ? styles.overlayCanvasInteractive : ''}`}
        onClick={handleOverlayClick}
        onMouseMove={handleOverlayMouseMove}
        onMouseLeave={handleOverlayMouseLeave}
      />
      <button
        type="button"
        className={styles.pickerToggle}
        aria-pressed={elementPickerEnabled}
        data-testid="liveview-picker-toggle"
        onClick={() => setElementPickerEnabled(!elementPickerEnabled)}
      >
        {elementPickerEnabled ? 'Picker: on' : 'Picker: off'}
      </button>
    </div>
  );
}

export type { LiveViewCanvasProps };
