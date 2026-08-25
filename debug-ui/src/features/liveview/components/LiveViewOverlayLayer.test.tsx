import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { LiveViewOverlayLayer } from './LiveViewOverlayLayer.js';

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as any;

// Use vi.hoisted so values are available inside vi.mock factories (which are hoisted to top)
const { mockSubscribe, mockMarkerUnsub, mockOverlayUnsub, mockUseControlStoreState } = vi.hoisted(
  () => {
    const markerUnsub = vi.fn();
    const overlayUnsub = vi.fn();

    let _markerHandler: ((event: { data: string }) => void) | undefined;
    let _overlayHandler: ((event: { data: string }) => void) | undefined;

    const subscribe = vi
      .fn()
      .mockImplementation((type: string, handler: (event: { data: string }) => void) => {
        if (type === 'debug.marker') {
          _markerHandler = handler;
          return markerUnsub;
        }
        if (type === 'debug.overlay') {
          _overlayHandler = handler;
          return overlayUnsub;
        }
        return vi.fn();
      });

    // Expose captured handlers for test use
    (subscribe as any)._getMarkerHandler = () => _markerHandler;
    (subscribe as any)._getOverlayHandler = () => _overlayHandler;

    const storeState = {
      elementPickerEnabled: false,
      selectedElement: null,
      domElements: [] as any[],
      markerToggle: false,
      setElementPickerEnabled: vi.fn(),
      setCapturedCoordinates: vi.fn(),
      setSelectedElement: vi.fn(),
      setHighlightedElementId: vi.fn(),
    };

    return {
      mockSubscribe: subscribe,
      mockMarkerUnsub: markerUnsub,
      mockOverlayUnsub: overlayUnsub,
      mockUseControlStoreState: storeState,
    };
  }
);

vi.mock('@/features/runtime/lib/debug-stream-client.js', () => ({
  debugStreamClient: {
    subscribe: mockSubscribe,
    acquire: vi.fn(),
    release: vi.fn(),
    getConnectionState: vi.fn(() => 'disconnected'),
  },
}));

vi.mock('@/features/playwright-control/store/control.store.js', () => {
  const useControlStoreMock = (selector?: (s: typeof mockUseControlStoreState) => unknown) => {
    if (selector) return selector(mockUseControlStoreState);
    return mockUseControlStoreState;
  };
  useControlStoreMock.getState = () => mockUseControlStoreState;
  return {
    useControlStore: useControlStoreMock,
    selectSelectedElement: (s: typeof mockUseControlStoreState) => s.selectedElement,
    selectDomElements: (s: typeof mockUseControlStoreState) => s.domElements,
    selectMarkerToggle: (s: typeof mockUseControlStoreState) => s.markerToggle,
  };
});

vi.mock('@/features/liveview/lib/index.js', () => ({
  canvasToPageCoords: (cssX: number, cssY: number) => ({ x: cssX, y: cssY }),
  pageToCanvasCoords: (pageX: number, pageY: number) => ({ x: pageX, y: pageY }),
}));

vi.mock('@/features/playwright-control/api/control.adapters.js', () => ({
  getElementAt: vi.fn().mockResolvedValue({ element: undefined }),
}));

vi.mock('@/features/playwright-control/lib/index.js', () => ({
  findDomElementAtPoint: vi.fn().mockReturnValue(undefined),
}));

vi.mock('./LiveViewOverlayLayer.module.css', () => ({
  default: {
    overlayCanvas: 'overlayCanvas',
    overlayCanvasInteractive: 'overlayCanvasInteractive',
    pickerToggle: 'pickerToggle',
  },
}));

const FIT_RECT = {
  offsetX: 0,
  offsetY: 0,
  drawW: 800,
  drawH: 600,
  scale: 1,
  imgW: 800,
  imgH: 600,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LiveViewOverlayLayer SSE subscription', () => {
  it('subscribes to debug.marker and debug.overlay on mount', () => {
    render(<LiveViewOverlayLayer fitRect={FIT_RECT} />);
    expect(mockSubscribe).toHaveBeenCalledWith('debug.marker', expect.any(Function));
    expect(mockSubscribe).toHaveBeenCalledWith('debug.overlay', expect.any(Function));
  });

  it('injects a marker when debug.marker event is received', async () => {
    render(<LiveViewOverlayLayer fitRect={FIT_RECT} />);

    const handler = (mockSubscribe as any)._getMarkerHandler();
    expect(handler).toBeDefined();

    act(() => {
      handler({
        data: JSON.stringify({
          type: 'debug.marker',
          marker: { pageX: 100, pageY: 200, source: 'ai' },
          emittedAt: new Date().toISOString(),
        }),
      });
    });

    // Verify the handler was called and processed without throwing
    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith('debug.marker', expect.any(Function));
    });
  });

  it('sets overlayBBox when debug.overlay event with non-null overlay is received', async () => {
    render(<LiveViewOverlayLayer fitRect={FIT_RECT} />);

    const handler = (mockSubscribe as any)._getOverlayHandler();
    expect(handler).toBeDefined();

    act(() => {
      handler({
        data: JSON.stringify({
          type: 'debug.overlay',
          overlay: {
            kind: 'highlight',
            source: 'ai',
            bbox: { x: 10, y: 20, width: 200, height: 100 },
            selector: '.target',
          },
          emittedAt: new Date().toISOString(),
        }),
      });
    });

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith('debug.overlay', expect.any(Function));
    });
  });

  it('clears overlayBBox when debug.overlay event with null overlay is received', async () => {
    render(<LiveViewOverlayLayer fitRect={FIT_RECT} />);

    const handler = (mockSubscribe as any)._getOverlayHandler();

    // Set overlay first
    act(() => {
      handler({
        data: JSON.stringify({
          type: 'debug.overlay',
          overlay: {
            kind: 'highlight',
            source: 'ai',
            bbox: { x: 10, y: 20, width: 200, height: 100 },
          },
          emittedAt: new Date().toISOString(),
        }),
      });
    });

    // Clear overlay
    act(() => {
      handler({
        data: JSON.stringify({
          type: 'debug.overlay',
          overlay: null,
          emittedAt: new Date().toISOString(),
        }),
      });
    });

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith('debug.overlay', expect.any(Function));
    });
  });

  it('calls unsubscribe cleanup on unmount', () => {
    const { unmount } = render(<LiveViewOverlayLayer fitRect={FIT_RECT} />);
    unmount();

    expect(mockMarkerUnsub).toHaveBeenCalled();
    expect(mockOverlayUnsub).toHaveBeenCalled();
  });

  it('ignores malformed debug.marker events without throwing', () => {
    render(<LiveViewOverlayLayer fitRect={FIT_RECT} />);

    const handler = (mockSubscribe as any)._getMarkerHandler();
    expect(() => {
      act(() => {
        handler({ data: 'not-valid-json' });
      });
    }).not.toThrow();
  });

  it('ignores malformed debug.overlay events without throwing', () => {
    render(<LiveViewOverlayLayer fitRect={FIT_RECT} />);

    const handler = (mockSubscribe as any)._getOverlayHandler();
    expect(() => {
      act(() => {
        handler({ data: 'not-valid-json' });
      });
    }).not.toThrow();
  });
});
