/// <reference types="dom" />
// LiveView - 双 Canvas 实时画面管理模块
// 渲染层 Canvas: 绘制截图帧
// 操作层 Canvas: 绘制点击标记、十字准星、坐标提示（不受画面刷新影响）

// MJPEG 流解析器
async function* mjpegStreamParser(stream: ReadableStream<Uint8Array>, boundary: string) {
  const reader = stream.getReader();
  let buffer = new Uint8Array(0);
  const boundaryBytes = new TextEncoder().encode(boundary);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const newBuffer = new Uint8Array(buffer.length + value.length);
    newBuffer.set(buffer);
    newBuffer.set(value, buffer.length);
    buffer = newBuffer;

    let boundaryIndex = -1;
    for (let i = 0; i <= buffer.length - boundaryBytes.length; i++) {
      let match = true;
      for (let j = 0; j < boundaryBytes.length; j++) {
        if (buffer[i + j] !== boundaryBytes[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        boundaryIndex = i;
        break;
      }
    }

    if (boundaryIndex !== -1) {
      const frameData = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + boundaryBytes.length);

      const frameStr = new TextDecoder().decode(frameData);
      const jpegStart = frameStr.indexOf('\r\n\r\n');
      if (jpegStart !== -1) {
        const jpegData = frameData.slice(jpegStart + 4);
        yield jpegData;
      }
    }
  }
}

interface Marker {
  x: number;
  y: number;
  timestamp: number;
  pageX?: number;
  pageY?: number;
}

interface ElementInfo {
  selector: string;
  tag: string;
  id?: string;
  class?: string;
  bbox?: { x: number; y: number; width: number; height: number };
}

interface PickerPos {
  canvasX: number;
  canvasY: number;
  pageX: number;
  pageY: number;
}

interface Viewport {
  width: number;
  height: number;
}

interface ImageFitRect {
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
  scale: number;
  imgW: number;
  imgH: number;
}

interface LiveViewAPI {
  init(): void;
  updateFrame(base64Data: string, viewport?: Viewport): void;
  startPolling(interval?: number): void;
  stopPolling(): void;
  downloadCurrentFrame(): void;
  setPickerMode(active: boolean): void;
  highlightElement(
    bbox: { x: number; y: number; width: number; height: number },
    element: ElementInfo
  ): void;
  clearHighlight(): void;
  clearMarkers(): void;
  hasActiveFrame(): boolean;
  getPageDimensions(): { width: number; height: number };
  canvasToPageCoords(cssX: number, cssY: number): { x: number; y: number } | null;
  pageToCanvasCoords(pageX: number, pageY: number): { x: number; y: number } | null;
  destroy(): void;
}

declare global {
  interface Window {
    liveView: LiveViewAPI;
    showSuccess?: (message: string) => void;
    playwrightLog?: (level: string, message: string) => void;
  }
}

const liveView = (() => {
  let renderCanvas: HTMLCanvasElement | null = null;
  let overlayCanvas: HTMLCanvasElement | null = null;
  let renderCtx: CanvasRenderingContext2D | null = null;
  let overlayCtx: CanvasRenderingContext2D | null = null;
  let container: HTMLElement | null = null;
  let placeholder: HTMLElement | null = null;
  let streamImage: HTMLImageElement | null = null;

  let currentImage: HTMLImageElement | null = null;
  let currentBitmap: ImageBitmap | null = null;
  let pageWidth = 0;
  let pageHeight = 0;
  let hasFrame = false;

  let pollTimer: number | null = null;
  let retryTimer: number | null = null;
  let polling = false;
  const pollInterval = 500;
  let fetching = false;

  let markers: Marker[] = [];
  const MARKER_LIFETIME = 5000;
  let animFrameId: number | null = null;

  let pickerActive = false;
  let pickerPos: PickerPos | null = null;
  let selectedElement: ElementInfo | null = null;
  let hoveredElement: ElementInfo | null = null;
  let hoverDebounceTimer: number | null = null;
  const HOVER_DEBOUNCE_MS = 150;

  let domSelectedElement: ElementInfo | null = null;
  let showMarkerNumbers = false;
  let cachedElementsMap: [number, ElementInfo][] = [];

  function init(): void {
    container = document.getElementById('liveviewContainer');
    renderCanvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    overlayCanvas = document.getElementById('overlayCanvas') as HTMLCanvasElement;
    placeholder = document.getElementById('liveviewPlaceholder');
    streamImage = document.getElementById('streamImage') as HTMLImageElement;

    if (!renderCanvas || !overlayCanvas || !container) {
      console.error('[LiveView] Canvas 元素未找到');
      return;
    }

    renderCtx = renderCanvas.getContext('2d');
    overlayCtx = overlayCanvas.getContext('2d');

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvases();
      renderFrame();
      drawOverlay();
    });
    resizeObserver.observe(container);

    overlayCanvas.addEventListener('click', handleClick);
    overlayCanvas.addEventListener('mousemove', handleMouseMove);
    overlayCanvas.addEventListener('mouseleave', handleMouseLeave);

    startOverlayLoop();

    console.log('[LiveView] 初始化完成');
  }

  function resizeCanvases(): void {
    if (!container || !renderCanvas || !overlayCanvas || !renderCtx || !overlayCtx) return;
    const rect = container.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);

    const dpr = window.devicePixelRatio || 1;

    renderCanvas.width = w * dpr;
    renderCanvas.height = h * dpr;
    renderCanvas.style.width = w + 'px';
    renderCanvas.style.height = h + 'px';
    renderCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    overlayCanvas.width = w * dpr;
    overlayCanvas.height = h * dpr;
    overlayCanvas.style.width = w + 'px';
    overlayCanvas.style.height = h + 'px';
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getImageFitRect(): ImageFitRect | null {
    const source = currentBitmap || currentImage;
    if (!source || !container) return null;
    const containerW = container.getBoundingClientRect().width;
    const containerH = container.getBoundingClientRect().height;

    const imgW = 'naturalWidth' in source ? source.naturalWidth : source.width;
    const imgH = 'naturalHeight' in source ? source.naturalHeight : source.height;

    const scale = Math.min(containerW / imgW, containerH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const offsetX = (containerW - drawW) / 2;
    const offsetY = (containerH - drawH) / 2;

    return { offsetX, offsetY, drawW, drawH, scale, imgW, imgH };
  }

  function canvasToPageCoords(cssX: number, cssY: number): { x: number; y: number } | null {
    const fit = getImageFitRect();
    if (!fit) return null;

    const relX = cssX - fit.offsetX;
    const relY = cssY - fit.offsetY;

    if (relX < 0 || relX > fit.drawW || relY < 0 || relY > fit.drawH) {
      return null;
    }

    const pageX = Math.round(relX / fit.scale);
    const pageY = Math.round(relY / fit.scale);

    return { x: pageX, y: pageY };
  }

  function pageToCanvasCoords(pageX: number, pageY: number): { x: number; y: number } | null {
    const fit = getImageFitRect();
    if (!fit) return null;

    const cssX = pageX * fit.scale + fit.offsetX;
    const cssY = pageY * fit.scale + fit.offsetY;

    return { x: cssX, y: cssY };
  }

  function renderFrame(): void {
    const source = currentBitmap || currentImage;
    if (!renderCtx || !source || !renderCanvas || !container) return;

    const fit = getImageFitRect();
    if (!fit) return;

    const containerW = container.getBoundingClientRect().width;
    const containerH = container.getBoundingClientRect().height;

    renderCtx.clearRect(0, 0, containerW, containerH);
    renderCtx.drawImage(source as any, fit.offsetX, fit.offsetY, fit.drawW, fit.drawH);
  }

  function updateFrame(base64Data: string, viewport?: Viewport): void {
    if (!base64Data) return;

    if (streamImage) streamImage.style.display = 'none';
    if (renderCanvas) renderCanvas.style.display = 'block';

    const src = base64Data.startsWith('data:') ? base64Data : `data:image/png;base64,${base64Data}`;

    const img = new Image();
    img.onload = () => {
      if (currentBitmap) {
        currentBitmap.close();
        currentBitmap = null;
      }
      currentImage = img;
      if (viewport) {
        pageWidth = viewport.width || img.naturalWidth;
        pageHeight = viewport.height || img.naturalHeight;
      } else {
        pageWidth = img.naturalWidth;
        pageHeight = img.naturalHeight;
      }
      hasFrame = true;

      if (placeholder) {
        placeholder.style.display = 'none';
      }

      renderFrame();
    };
    img.src = src;
  }

  let frameId = 0;

  function startStream(): void {
    if (!streamImage) return;
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const streamUrl = `${protocol}//${hostname}:3001/browser/stream`;
    streamImage.style.display = 'none';
    if (renderCanvas) renderCanvas.style.display = 'block';
    let abortController: AbortController | null = new AbortController();
    let streaming = true;

    const startFetch = async () => {
      try {
        const response = await fetch(streamUrl, {
          signal: abortController?.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error('Stream failed');
        }
        const contentType = response.headers.get('Content-Type') || '';
        const boundaryMatch = contentType.match(/boundary=([^;]+)/);
        const boundary = boundaryMatch ? `--${boundaryMatch[1]}` : '--frame';

        for await (const frameData of mjpegStreamParser(response.body, boundary)) {
          if (!streaming) break;
          const currentFrameId = ++frameId;

          try {
            const blob = new Blob([frameData], { type: 'image/jpeg' });
            const bitmap = await createImageBitmap(blob);

            if (!streaming || currentFrameId < frameId) {
              bitmap.close();
              continue;
            }

            if (currentBitmap) {
              currentBitmap.close();
            }
            if (currentImage) {
              currentImage = null;
            }

            currentBitmap = bitmap;
            hasFrame = true;
            if (placeholder) placeholder.style.display = 'none';
            pageWidth = bitmap.width;
            pageHeight = bitmap.height;
            resizeCanvases();
            renderFrame();
            drawOverlay();
          } catch (err) {
            console.error('[LiveView] 帧解码失败:', err);
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        handleStreamError();
      }
    };
    startFetch();
    (window as any)._streamAbortController = abortController;
    (window as any)._streaming = streaming;
  }

  function stopStream(): void {
    const abortController = (window as any)._streamAbortController as AbortController | null;
    const streaming = (window as any)._streaming as boolean;
    if (abortController) {
      abortController.abort();
      (window as any)._streamAbortController = null;
    }
    (window as any)._streaming = false;
    if (!streamImage) return;
    streamImage.src = '';
    streamImage.style.display = 'none';
    if (renderCanvas) renderCanvas.style.display = 'block';
    hasFrame = false;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (currentBitmap) {
      currentBitmap.close();
      currentBitmap = null;
    }
  }

  function handleStreamError(): void {
    if (placeholder) {
      placeholder.style.display = 'flex';
      placeholder.innerHTML =
        '<div class="empty-state-icon">⚠️</div><div class="empty-state-text">Stream Unavailable. Retrying...</div>';
    }

    if (polling) {
      retryTimer = setTimeout(() => {
        if (polling) startStream();
      }, 2000) as unknown as number;
    }
  }

  function startPolling(interval?: number): void {
    if (polling) return;
    polling = true;
    startStream();
    console.log(`[LiveView] 流媒体已启动`);
  }

  function stopPolling(): void {
    polling = false;
    stopStream();
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    console.log('[LiveView] 流媒体已停止');
  }

  async function poll(): Promise<void> {
    if (!polling) return;

    if (!fetching) {
      fetching = true;
      try {
        const response = await fetch('/debug/api/playwright/screenshot');
        const data = await response.json();
        if (data.success && data.screenshot) {
          updateFrame(data.screenshot, data.viewport);

          const urlEl = document.getElementById('screenshot-url');
          if (urlEl && data.url) {
            urlEl.textContent = data.url;
          }
        }
      } catch (err) {
        console.debug('[LiveView] 轮询截图失败:', (err as Error).message);
      }
      fetching = false;
    }

    pollTimer = setTimeout(poll, pollInterval) as unknown as number;
  }

  function startOverlayLoop(): void {
    function loop(): void {
      drawOverlay();
      animFrameId = requestAnimationFrame(loop);
    }
    animFrameId = requestAnimationFrame(loop);
  }

  function drawOverlay(): void {
    if (!overlayCtx || !container) return;

    const containerW = container.getBoundingClientRect().width;
    const containerH = container.getBoundingClientRect().height;

    overlayCtx.clearRect(0, 0, containerW, containerH);

    const now = Date.now();

    markers = markers.filter((m) => now - m.timestamp < MARKER_LIFETIME);
    markers.forEach((marker) => {
      const age = now - marker.timestamp;
      const alpha = Math.max(0, 1 - age / MARKER_LIFETIME);
      drawCrosshair(overlayCtx, marker.x, marker.y, 15, `rgba(255, 60, 60, ${alpha})`, 2);

      if (marker.pageX !== undefined) {
        overlayCtx.save();
        overlayCtx.globalAlpha = alpha;
        overlayCtx.font = '11px "JetBrains Mono", monospace';
        overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        const text = `(${marker.pageX}, ${marker.pageY})`;
        const metrics = overlayCtx.measureText(text);
        const tx = marker.x + 12;
        const ty = marker.y - 12;
        overlayCtx.fillRect(tx - 3, ty - 12, metrics.width + 6, 16);
        overlayCtx.fillStyle = '#ff3c3c';
        overlayCtx.fillText(text, tx, ty);
        overlayCtx.restore();
      }
    });

    if (pickerActive) {
      if (hoveredElement && hoveredElement.bbox) {
        drawElementBBox(hoveredElement, 'rgba(0, 150, 255, 0.6)', true);
      }

      if (selectedElement && selectedElement.bbox) {
        drawElementBBox(selectedElement, 'rgba(0, 200, 100, 0.8)', false);
      }

      if (pickerPos) {
        drawCrosshair(
          overlayCtx,
          pickerPos.canvasX,
          pickerPos.canvasY,
          20,
          'rgba(0, 150, 255, 0.8)',
          1.5
        );

        if (pickerPos.pageX !== undefined) {
          overlayCtx.save();
          overlayCtx.font = '11px "JetBrains Mono", monospace';
          const text = `X: ${pickerPos.pageX}, Y: ${pickerPos.pageY}`;
          const metrics = overlayCtx.measureText(text);

          const tx = pickerPos.canvasX + 18;
          const ty = pickerPos.canvasY - 18;

          overlayCtx.fillStyle = 'rgba(20, 20, 30, 0.85)';
          overlayCtx.strokeStyle = 'rgba(0, 150, 255, 0.5)';
          overlayCtx.lineWidth = 1;
          const bx = tx - 5;
          const by = ty - 13;
          const bw = metrics.width + 10;
          const bh = 20;
          overlayCtx.beginPath();
          if (overlayCtx.roundRect) {
            overlayCtx.roundRect(bx, by, bw, bh, 4);
          } else {
            overlayCtx.rect(bx, by, bw, bh);
          }
          overlayCtx.fill();
          overlayCtx.stroke();

          overlayCtx.fillStyle = '#ffffff';
          overlayCtx.fillText(text, tx, ty);
          overlayCtx.restore();
        }
      }
    }

    if (domSelectedElement && domSelectedElement.bbox) {
      drawElementBBox(domSelectedElement, 'rgba(255, 165, 0, 0.8)', false);
    }

    if (showMarkerNumbers && cachedElementsMap.length > 0) {
      drawMarkerNumbers();
    }
  }

  function drawMarkerNumbers(): void {
    if (!overlayCtx) return;

    cachedElementsMap.forEach(([markerNumber, elementInfo]) => {
      if (!elementInfo.bbox) return;

      const bbox = elementInfo.bbox;
      const topLeft = pageToCanvasCoords(bbox.x, bbox.y);
      if (!topLeft) return;

      const labelX = topLeft.x;
      const labelY = topLeft.y;

      const label = String(markerNumber);
      overlayCtx.save();
      overlayCtx.font = 'bold 10px "JetBrains Mono", monospace';
      const metrics = overlayCtx.measureText(label);
      const padding = 2;
      const boxW = metrics.width + padding * 2;
      const boxH = 14;

      overlayCtx.fillStyle = 'rgba(0, 120, 215, 0.85)';
      overlayCtx.beginPath();
      if (overlayCtx.roundRect) {
        overlayCtx.roundRect(labelX, labelY, boxW, boxH, 3);
      } else {
        overlayCtx.rect(labelX, labelY, boxW, boxH);
      }
      overlayCtx.fill();

      overlayCtx.fillStyle = '#ffffff';
      overlayCtx.textBaseline = 'top';
      overlayCtx.fillText(label, labelX + padding, labelY + 2);
      overlayCtx.restore();
    });
  }

  function drawElementBBox(element: ElementInfo, color: string, isDashed: boolean): void {
    if (!element || !element.bbox || !overlayCtx) return;

    const bbox = element.bbox;
    const topLeft = pageToCanvasCoords(bbox.x, bbox.y);
    const bottomRight = pageToCanvasCoords(bbox.x + bbox.width, bbox.y + bbox.height);

    if (!topLeft || !bottomRight) return;

    const x = topLeft.x;
    const y = topLeft.y;
    const w = bottomRight.x - topLeft.x;
    const h = bottomRight.y - topLeft.y;

    overlayCtx.save();
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = 2;

    if (isDashed) {
      overlayCtx.setLineDash([6, 4]);
    }

    overlayCtx.strokeRect(x, y, w, h);

    overlayCtx.fillStyle = color.replace(/[\d.]+\)$/, '0.15)');
    overlayCtx.fillRect(x, y, w, h);

    overlayCtx.restore();

    const label = element.id
      ? `#${element.id}`
      : element.class
        ? `.${element.class.split(' ')[0]}`
        : element.tag;

    overlayCtx.save();
    overlayCtx.font = 'bold 11px "JetBrains Mono", monospace';
    const labelMetrics = overlayCtx.measureText(label);
    const labelW = labelMetrics.width + 8;
    const labelH = 18;
    const labelX = x;
    const labelY = y - labelH - 2;

    overlayCtx.fillStyle = color.replace(/[\d.]+\)$/, '0.9)');
    overlayCtx.beginPath();
    if (overlayCtx.roundRect) {
      overlayCtx.roundRect(labelX, labelY > 0 ? labelY : y + 2, labelW, labelH, 3);
    } else {
      overlayCtx.rect(labelX, labelY > 0 ? labelY : y + 2, labelW, labelH);
    }
    overlayCtx.fill();

    overlayCtx.fillStyle = '#ffffff';
    overlayCtx.fillText(label, labelX + 4, (labelY > 0 ? labelY : y + 2) + 13);
    overlayCtx.restore();
  }

  function drawCrosshair(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
    lineWidth: number
  ): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  async function handleClick(e: MouseEvent): Promise<void> {
    if (!hasFrame || !overlayCanvas) return;

    const rect = overlayCanvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    const pageCoords = canvasToPageCoords(cssX, cssY);
    if (!pageCoords) return;

    markers.push({
      x: cssX,
      y: cssY,
      pageX: pageCoords.x,
      pageY: pageCoords.y,
      timestamp: Date.now(),
    });

    const xInput = document.getElementById('playwright-click-x') as HTMLInputElement;
    const yInput = document.getElementById('playwright-click-y') as HTMLInputElement;
    if (xInput) xInput.value = pageCoords.x.toString();
    if (yInput) yInput.value = pageCoords.y.toString();

    if (pickerActive) {
      try {
        const response = await fetch(
          `/debug/api/playwright/element-at?x=${pageCoords.x}&y=${pageCoords.y}`
        );
        const data = (await response.json()) as { success: boolean; element?: ElementInfo };

        if (data.success && data.element) {
          selectedElement = data.element;

          const selectorInput = document.getElementById(
            'playwright-action-selector'
          ) as HTMLInputElement;
          if (selectorInput) {
            selectorInput.value = data.element.selector;
            selectorInput.focus();
          }

          if (typeof window.showSuccess === 'function') {
            const info = data.element.id ? `#${data.element.id}` : data.element.selector;
            window.showSuccess(`已选择元素: ${info}`);
          }

          if (typeof window.playwrightLog === 'function') {
            window.playwrightLog(
              'success',
              `元素: ${data.element.tag}${data.element.id ? '#' + data.element.id : ''}${data.element.class ? '.' + data.element.class.split(' ')[0] : ''}`
            );
          }
        } else {
          selectedElement = null;
          if (typeof window.showSuccess === 'function') {
            window.showSuccess(`已选择坐标: (${pageCoords.x}, ${pageCoords.y})`);
          }
        }
      } catch (err) {
        console.error('[LiveView] 获取元素信息失败:', err);
        selectedElement = null;
        if (typeof window.showSuccess === 'function') {
          window.showSuccess(`已选择坐标: (${pageCoords.x}, ${pageCoords.y})`);
        }
      }
    } else {
      selectedElement = null;
      if (typeof window.showSuccess === 'function') {
        window.showSuccess(`已选择坐标: (${pageCoords.x}, ${pageCoords.y})`);
      }
    }
  }

  function handleMouseMove(e: MouseEvent): void {
    if (!pickerActive || !hasFrame) return;

    const rect = overlayCanvas?.getBoundingClientRect();
    if (!rect) return;

    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    const pageCoords = canvasToPageCoords(cssX, cssY);
    if (pageCoords) {
      pickerPos = {
        canvasX: cssX,
        canvasY: cssY,
        pageX: pageCoords.x,
        pageY: pageCoords.y,
      };

      if (hoverDebounceTimer) {
        clearTimeout(hoverDebounceTimer);
      }
      hoverDebounceTimer = setTimeout(async () => {
        if (!pickerActive || !pickerPos) return;
        try {
          const response = await fetch(
            `/debug/api/playwright/element-at?x=${pageCoords.x}&y=${pageCoords.y}`
          );
          const data = (await response.json()) as { success: boolean; element?: ElementInfo };
          if (data.success && data.element) {
            hoveredElement = data.element;
          } else {
            hoveredElement = null;
          }
        } catch (err) {
          hoveredElement = null;
        }
      }, HOVER_DEBOUNCE_MS) as unknown as number;
    } else {
      pickerPos = null;
      hoveredElement = null;
    }
  }

  function handleMouseLeave(): void {
    pickerPos = null;
    hoveredElement = null;
    if (hoverDebounceTimer) {
      clearTimeout(hoverDebounceTimer);
      hoverDebounceTimer = null;
    }
  }

  function setPickerMode(active: boolean): void {
    pickerActive = active;
    if (overlayCanvas) {
      overlayCanvas.style.cursor = active ? 'crosshair' : 'default';
    }
    if (!active) {
      pickerPos = null;
      selectedElement = null;
      hoveredElement = null;
      if (hoverDebounceTimer) {
        clearTimeout(hoverDebounceTimer);
        hoverDebounceTimer = null;
      }
    }
  }

  function highlightElement(
    bbox: { x: number; y: number; width: number; height: number },
    element: ElementInfo
  ): void {
    domSelectedElement = {
      selector: element.selector,
      bbox: bbox,
      tag: element.tag,
      id: element.id,
      class: element.class,
    };
  }

  function clearHighlight(): void {
    domSelectedElement = null;
  }

  function downloadCurrentFrame(): void {
    const source = currentBitmap || currentImage;
    if (!source || !renderCanvas) {
      if (typeof window.playwrightLog === 'function') {
        window.playwrightLog('error', '没有可下载的画面');
      }
      return;
    }

    const tmpCanvas = document.createElement('canvas');
    const w = 'naturalWidth' in source ? source.naturalWidth : source.width;
    const h = 'naturalHeight' in source ? source.naturalHeight : source.height;
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const tmpCtx = tmpCanvas.getContext('2d');
    if (!tmpCtx) return;
    tmpCtx.drawImage(source as any, 0, 0);

    const dataUrl = tmpCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (typeof window.playwrightLog === 'function') {
      window.playwrightLog('success', '截图已下载');
    }
  }

  function clearMarkers(): void {
    markers = [];
    selectedElement = null;
    hoveredElement = null;
  }

  function hasActiveFrame(): boolean {
    return hasFrame;
  }

  function getPageDimensions(): { width: number; height: number } {
    return { width: pageWidth, height: pageHeight };
  }

  function setShowMarkerNumbers(show: boolean): void {
    showMarkerNumbers = show;
  }

  function updateElementsMap(elementsMap: [number, ElementInfo][]): void {
    cachedElementsMap = elementsMap;
  }

  function destroy(): void {
    stopPolling();
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
    }
    if (overlayCanvas) {
      overlayCanvas.removeEventListener('click', handleClick);
      overlayCanvas.removeEventListener('mousemove', handleMouseMove);
      overlayCanvas.removeEventListener('mouseleave', handleMouseLeave);
    }
    if (currentBitmap) {
      currentBitmap.close();
    }
  }

  return {
    init,
    updateFrame,
    startPolling,
    stopPolling,
    downloadCurrentFrame,
    setPickerMode,
    highlightElement,
    clearHighlight,
    clearMarkers,
    hasActiveFrame,
    getPageDimensions,
    canvasToPageCoords,
    pageToCanvasCoords,
    setShowMarkerNumbers,
    updateElementsMap,
    destroy,
  };
})();

window.liveView = liveView;

export {};
