import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { canvasToPageCoords, pageToCanvasCoords } from '@/features/liveview/lib/index.js';
import type { ImageFitRect } from '@/features/liveview/lib/index.js';
import { getElementAt } from '@/features/playwright-control/api/control.adapters.js';
import { findDomElementAtPoint } from '@/features/playwright-control/lib/index.js';
import {
  selectDomElements,
  selectMarkerToggle,
  selectSelectedElement,
  type SelectedElement,
  useControlStore,
} from '@/features/playwright-control/store/control.store.js';
import type { DebugMarkerEvent, DebugOverlayEvent } from '@nebula-link-evo/shared/types/debug-events';
import { debugStreamClient } from '@/features/runtime/lib/debug-stream-client.js';
import styles from './LiveViewOverlayLayer.module.css';

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

interface LiveViewOverlayLayerProps {
  fitRect: ImageFitRect | null;
  onElementSelect?: (selector: string) => void;
  onCoordinateCapture?: (coords: { x: number; y: number }) => void;
}

export function LiveViewOverlayLayer({
  fitRect,
  onCoordinateCapture,
}: LiveViewOverlayLayerProps) {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const overlayRafRef = useRef<number | null>(null);
  const hoverDebounceRef = useRef<number | null>(null);
  const pickerCursorRef = useRef<PickerCursor | null>(null);
  const fitRectRef = useRef<ImageFitRect | null>(fitRect);
  const markersRef = useRef<Marker[]>([]);
  const overlayBBoxRef = useRef<OverlayBBox | null>(null);
  const hoveredElementRef = useRef<SelectedElement | null>(null);
  const selectedElementRef = useRef<SelectedElement | null>(null);
  const domElementsRef = useRef(useControlStore.getState().domElements);
  const markerToggleRef = useRef(useControlStore.getState().markerToggle);

  const [markers, setMarkers] = useState<Marker[]>([]);
  const [overlayBBox, setOverlayBBox] = useState<OverlayBBox | null>(null);
  const [hoveredElement, setHoveredElement] = useState<SelectedElement | null>(null);

  const elementPickerEnabled = useControlStore((s) => s.elementPickerEnabled);
  const setElementPickerEnabled = useControlStore((s) => s.setElementPickerEnabled);
  const setCapturedCoordinates = useControlStore((s) => s.setCapturedCoordinates);
  const setSelectedElement = useControlStore((s) => s.setSelectedElement);
  const setHighlightedElementId = useControlStore((s) => s.setHighlightedElementId);
  const selectedElement = useControlStore(selectSelectedElement);
  const domElements = useControlStore(selectDomElements);
  const markerToggle = useControlStore(selectMarkerToggle);

  useEffect(() => {
    fitRectRef.current = fitRect;
  }, [fitRect]);

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

  const resizeOverlayCanvas = useCallback(() => {
    const overlayCanvas = overlayCanvasRef.current;
    const overlayCtx = overlayCtxRef.current;
    const container = overlayCanvas?.parentElement;
    if (!overlayCanvas || !overlayCtx || !container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    const dpr = window.devicePixelRatio || 1;

    overlayCanvas.width = width * dpr;
    overlayCanvas.height = height * dpr;
    overlayCanvas.style.width = `${width}px`;
    overlayCanvas.style.height = `${height}px`;
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

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
    const container = overlayCanvasRef.current?.parentElement;
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

    const currentFitRect = fitRectRef.current;
    const currentOverlay = overlayBBoxRef.current;
    const currentHovered = hoveredElementRef.current;
    if (currentFitRect && currentOverlay) {
      const topLeft = pageToCanvasCoords(currentOverlay.x, currentOverlay.y, currentFitRect);
      const bottomRight = pageToCanvasCoords(
        currentOverlay.x + currentOverlay.width,
        currentOverlay.y + currentOverlay.height,
        currentFitRect
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

    if (currentFitRect && elementPickerEnabled && currentHovered?.bbox) {
      const hoverTopLeft = pageToCanvasCoords(
        currentHovered.bbox.x,
        currentHovered.bbox.y,
        currentFitRect
      );
      const hoverBottomRight = pageToCanvasCoords(
        currentHovered.bbox.x + currentHovered.bbox.width,
        currentHovered.bbox.y + currentHovered.bbox.height,
        currentFitRect
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

    const currentSelected = selectedElementRef.current;
    if (currentFitRect && currentSelected?.bbox) {
      const selTopLeft = pageToCanvasCoords(
        currentSelected.bbox.x,
        currentSelected.bbox.y,
        currentFitRect
      );
      const selBottomRight = pageToCanvasCoords(
        currentSelected.bbox.x + currentSelected.bbox.width,
        currentSelected.bbox.y + currentSelected.bbox.height,
        currentFitRect
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
      overlayCtx.fillStyle = 'rgba(34, 197, 94, 0.08)';
      overlayCtx.fillRect(
        selTopLeft.x,
        selTopLeft.y,
        selBottomRight.x - selTopLeft.x,
        selBottomRight.y - selTopLeft.y
      );
      overlayCtx.restore();
    }

    if (markerToggleRef.current && currentFitRect) {
      overlayCtx.save();
      overlayCtx.font = 'bold 12px monospace';
      overlayCtx.textAlign = 'center';
      overlayCtx.textBaseline = 'middle';
      for (const el of domElementsRef.current) {
        if (!el.bbox || !el.isVisible) continue;

        const topLeft = pageToCanvasCoords(el.bbox.x, el.bbox.y, currentFitRect);
        const bottomRight = pageToCanvasCoords(
          el.bbox.x + el.bbox.width,
          el.bbox.y + el.bbox.height,
          currentFitRect
        );

        const w = 18;
        const h = 14;
        overlayCtx.fillStyle = 'rgba(239, 68, 68, 0.9)';
        overlayCtx.fillRect(topLeft.x, topLeft.y, w, h);

        overlayCtx.fillStyle = '#ffffff';
        overlayCtx.fillText(String(el.markerNumber), topLeft.x + w / 2, topLeft.y + h / 2 + 1);

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

  const pushMarker = useCallback((marker: Marker) => {
    setMarkers((prev) => [...prev, marker]);
  }, []);

  // SSE marker/overlay subscription from debug stream
  useEffect(() => {
    const unsubMarker = debugStreamClient.subscribe('debug.marker', (event) => {
      try {
        const data: DebugMarkerEvent = JSON.parse(event.data);
        const currentFitRect = fitRectRef.current;
        if (!currentFitRect) return;
        const canvasCoords = pageToCanvasCoords(data.marker.pageX, data.marker.pageY, currentFitRect);
        if (!canvasCoords) return;
        pushMarker({
          canvasX: canvasCoords.x,
          canvasY: canvasCoords.y,
          pageX: data.marker.pageX,
          pageY: data.marker.pageY,
          timestamp: Date.now(),
        });
      } catch {
        // Ignore malformed marker events
      }
    });

    const unsubOverlay = debugStreamClient.subscribe('debug.overlay', (event) => {
      try {
        const data: DebugOverlayEvent = JSON.parse(event.data);
        if (data.overlay === null) {
          setOverlayBBox(null);
        } else {
          setOverlayBBox({
            x: data.overlay.bbox.x,
            y: data.overlay.bbox.y,
            width: data.overlay.bbox.width,
            height: data.overlay.bbox.height,
            selector: data.overlay.selector,
          });
        }
      } catch {
        // Ignore malformed overlay events
      }
    });

    return () => {
      unsubMarker();
      unsubOverlay();
    };
  }, [pushMarker]);

  const handleOverlayClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      const currentFitRect = fitRectRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      if (!currentFitRect || !overlayCanvas) {
        return;
      }

      const rect = overlayCanvas.getBoundingClientRect();
      const cssX = event.clientX - rect.left;
      const cssY = event.clientY - rect.top;
      const pageCoords = canvasToPageCoords(cssX, cssY, currentFitRect);
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

      const currentFitRect = fitRectRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      if (!currentFitRect || !overlayCanvas) {
        pickerCursorRef.current = null;
        return;
      }

      const rect = overlayCanvas.getBoundingClientRect();
      const cssX = event.clientX - rect.left;
      const cssY = event.clientY - rect.top;
      const pageCoords = canvasToPageCoords(cssX, cssY, currentFitRect);
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
    const overlayCanvas = overlayCanvasRef.current;
    const container = overlayCanvas?.parentElement;
    if (!overlayCanvas || !container) {
      return;
    }

    overlayCtxRef.current = overlayCanvas.getContext('2d');
    if (!overlayCtxRef.current) {
      return;
    }

    resizeOverlayCanvas();
    drawOverlayFrame();

    const observer = new ResizeObserver(() => {
      resizeOverlayCanvas();
      drawOverlayFrame();
    });
    observer.observe(container);
    resizeObserverRef.current = observer;

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [drawOverlayFrame, resizeOverlayCanvas]);

  useEffect(() => {
    drawOverlayFrame();
  }, [drawOverlayFrame]);

  useEffect(() => {
    drawOverlayFrame();
  }, [drawOverlayFrame, selectedElement, markerToggle, domElements]);

  useEffect(() => {
    let active = true;

    const startLoop = () => {
      const loop = () => {
        if (!active) return;
        drawOverlayFrame();
        overlayRafRef.current = window.requestAnimationFrame(loop);
      };
      overlayRafRef.current = window.requestAnimationFrame(loop);
    };

    const hasOverlayContent =
      markers.length > 0 || overlayBBox !== null || hoveredElement !== null || elementPickerEnabled;

    if (hasOverlayContent) {
      startLoop();
    }

    return () => {
      active = false;
      if (overlayRafRef.current !== null) {
        window.cancelAnimationFrame(overlayRafRef.current);
        overlayRafRef.current = null;
      }
    };
  }, [drawOverlayFrame, markers.length, overlayBBox, hoveredElement, elementPickerEnabled]);

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
    };
  }, []);

  const overlayCanvasClassName = useMemo(() => {
    return `${styles.overlayCanvas} ${elementPickerEnabled ? styles.overlayCanvasInteractive : ''}`;
  }, [elementPickerEnabled]);

  return (
    <>
      <canvas
        ref={overlayCanvasRef}
        className={overlayCanvasClassName}
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
    </>
  );
}

export type { LiveViewOverlayLayerProps };
