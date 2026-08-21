import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveViewCanvas } from './LiveViewCanvas.js';
import { useControlStore } from '@/features/playwright-control/store/control.store.js';

const runtimeState = {
  playwrightIsOpen: true,
  playwrightStatusHydrated: true,
  liveviewRefreshKey: 0,
  setLastScreenshotDataUrl: vi.fn(),
};

vi.mock('@/features/runtime/store/index.js', () => ({
  useRuntimeStore: (selector: (state: typeof runtimeState) => unknown) => selector(runtimeState),
  selectPlaywrightIsOpen: (state: typeof runtimeState) => state.playwrightIsOpen,
  selectPlaywrightStatusHydrated: (state: typeof runtimeState) => state.playwrightStatusHydrated,
  selectLiveviewRefreshKey: (state: typeof runtimeState) => state.liveviewRefreshKey,
}));

vi.mock('@/features/liveview/lib/index.js', () => ({
  createMjpegTransform: () => new TransformStream(),
  getImageFitRect: (imgW: number, imgH: number, containerW: number, containerH: number) => ({
    offsetX: 0,
    offsetY: 0,
    drawW: containerW,
    drawH: containerH,
    scale: Math.min(containerW / imgW, containerH / imgH),
    imgW,
    imgH,
  }),
  canvasToPageCoords: (cssX: number, cssY: number) => ({
    x: Math.round(cssX),
    y: Math.round(cssY),
  }),
  pageToCanvasCoords: (pageX: number, pageY: number) => ({ x: pageX, y: pageY }),
}));

vi.mock('@nebula-link-evo/shared', () => ({
  createFrameCounter: () => ({
    recordFrame: vi.fn(),
    recordDrop: vi.fn(),
    getSummary: () => 'mock-counter',
  }),
}));

vi.mock('@/features/playwright-control/lib/index.js', () => ({
  findDomElementAtPoint: vi.fn(() => undefined),
}));

describe('LiveViewCanvas', () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = globalThis.URL.createObjectURL;
  const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeState.playwrightIsOpen = true;
    runtimeState.liveviewRefreshKey = 0;
    runtimeState.setLastScreenshotDataUrl = vi.fn();
    useControlStore.getState().reset();

    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 1280,
      height: 720,
      close: vi.fn(),
    }) as unknown as typeof createImageBitmap;

    class ResizeObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

    globalThis.requestAnimationFrame = vi.fn(() => 1);
    globalThis.cancelAnimationFrame = vi.fn();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>(),
      headers: { get: () => 'multipart/x-mixed-replace; boundary=frameboundary' },
    }) as unknown as typeof fetch;

    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:liveview-frame'),
    });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId: string) => {
      if (contextId === 'bitmaprenderer') {
        return {
          transferFromImageBitmap: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
      }
      return {
        clearRect: vi.fn(),
        setTransform: vi.fn(),
        drawImage: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        strokeRect: vi.fn(),
        setLineDash: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          width: 640,
          height: 360,
          top: 0,
          left: 0,
          right: 640,
          bottom: 360,
          toJSON: () => ({}),
        }) as DOMRect
    );

    vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          width: 640,
          height: 360,
          top: 0,
          left: 0,
          right: 640,
          bottom: 360,
          toJSON: () => ({}),
        }) as DOMRect
    );
  });

  it('renders container and initializes both canvases', () => {
    const { container } = render(<LiveViewCanvas />);
    expect(screen.getByTestId('liveview-canvas')).toBeInTheDocument();
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    });
  });
});
