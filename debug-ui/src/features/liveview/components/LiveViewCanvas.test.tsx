import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LiveViewCanvas } from './LiveViewCanvas.js';
import { useControlStore } from '@/features/playwright-control/store/control.store.js';
import * as controlAdapters from '@/features/playwright-control/api/control.adapters.js';

const onMessageMock = vi.fn();
const runtimeState = {
  connectionStatus: 'connected',
  playwrightIsOpen: true,
  setLastScreenshotDataUrl: vi.fn(),
};

vi.mock('@/features/runtime/hooks/index.js', () => ({
  useDebugSocket: () => ({
    onMessage: onMessageMock,
    sendMessage: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock('@/features/runtime/store/index.js', () => ({
  useRuntimeStore: (selector: (state: typeof runtimeState) => unknown) => selector(runtimeState),
  selectConnectionStatus: (state: typeof runtimeState) => state.connectionStatus,
  selectPlaywrightIsOpen: (state: typeof runtimeState) => state.playwrightIsOpen,
}));

vi.mock('@/features/liveview/lib/index.js', () => ({
  mjpegStreamParser: async function* () {
    yield new Uint8Array([1, 2, 3]);
  },
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
    runtimeState.connectionStatus = 'connected';
    runtimeState.playwrightIsOpen = true;
    runtimeState.setLastScreenshotDataUrl = vi.fn();
    useControlStore.getState().reset();

    onMessageMock.mockImplementation((handler: (payload: unknown) => void) => {
      (
        globalThis as { __liveviewMessageHandler?: (payload: unknown) => void }
      ).__liveviewMessageHandler = handler;
      return () => {
        (
          globalThis as { __liveviewMessageHandler?: (payload: unknown) => void }
        ).__liveviewMessageHandler = undefined;
      };
    });

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

  it('toggles picker mode via button', () => {
    render(<LiveViewCanvas />);

    const container = screen.getByTestId('liveview-canvas');
    const toggle = screen.getByTestId('liveview-picker-toggle');
    expect(container).toHaveAttribute('data-picker-active', 'false');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(container).toHaveAttribute('data-picker-active', 'true');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('captures coordinates and updates marker state when picker is active', async () => {
    const onCoordinateCapture = vi.fn();
    const { container } = render(<LiveViewCanvas onCoordinateCapture={onCoordinateCapture} />);

    await waitFor(() => {
      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('liveview-picker-toggle'));

    const overlayCanvas = container.querySelectorAll('canvas')[1] as HTMLCanvasElement;
    fireEvent.click(overlayCanvas, { clientX: 120, clientY: 80 });

    await waitFor(() => {
      expect(onCoordinateCapture).toHaveBeenCalledWith({ x: 120, y: 80 });
      expect(screen.getByTestId('liveview-canvas')).toHaveAttribute('data-marker-count', '1');
    });
  });

  it('captures coordinates when picker is inactive so control sidebar can use coordinate click', async () => {
    const onCoordinateCapture = vi.fn();
    const { container } = render(<LiveViewCanvas onCoordinateCapture={onCoordinateCapture} />);

    await waitFor(() => {
      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
    });

    const overlayCanvas = container.querySelectorAll('canvas')[1] as HTMLCanvasElement;
    fireEvent.click(overlayCanvas, { clientX: 64, clientY: 48 });

    await waitFor(() => {
      expect(onCoordinateCapture).toHaveBeenCalledWith({ x: 64, y: 48 });
      expect(useControlStore.getState().capturedCoordinates).toEqual({ x: 64, y: 48 });
    });
  });

  it('updates overlay state from debug socket messages', async () => {
    const onElementSelect = vi.fn();
    render(<LiveViewCanvas onElementSelect={onElementSelect} />);

    const handler = (globalThis as { __liveviewMessageHandler?: (payload: unknown) => void })
      .__liveviewMessageHandler;
    expect(handler).toBeTypeOf('function');

    await act(async () => {
      handler?.({
        type: 'liveview.hover',
        bbox: { x: 10, y: 12, width: 100, height: 50, selector: '#target' },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('liveview-canvas')).toHaveAttribute('data-has-overlay', 'true');
      expect(onElementSelect).toHaveBeenCalledWith('#target');
    });
  });

  it('shows hover preview in picker mode on mouse move', async () => {
    vi.spyOn(controlAdapters, 'getElementAt').mockResolvedValue({
      success: true,
      element: {
        selector: '#hover-target',
        tag: 'button',
        text: 'Hover me',
        bbox: { x: 40, y: 30, width: 120, height: 40 },
        isVisible: true,
        isInteractable: true,
      },
    });

    const { container } = render(<LiveViewCanvas />);

    await waitFor(() => {
      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('liveview-picker-toggle'));
    const overlayCanvas = container.querySelectorAll('canvas')[1] as HTMLCanvasElement;
    fireEvent.mouseMove(overlayCanvas, { clientX: 80, clientY: 60 });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    await waitFor(() => {
      expect(controlAdapters.getElementAt).toHaveBeenCalledWith(80, 60);
      expect(screen.getByTestId('liveview-canvas')).toHaveAttribute('data-has-overlay', 'true');
    });
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
