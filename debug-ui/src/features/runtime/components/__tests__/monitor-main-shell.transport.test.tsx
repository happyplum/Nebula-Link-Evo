import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MonitorMainShell } from '../MonitorMainShell.js';

// Use vi.hoisted to make storeState available in the mock factory
const { storeState } = vi.hoisted(() => ({
  storeState: {
    connectionStatus: 'disconnected' as const,
    reconnectAttempt: 0,
    playwrightStatus: 'unknown' as const,
    playwrightIsOpen: true,
    playwrightUrl: null as string | null,
    snapshotVersion: 0,
    liveviewRefreshKey: 0,
    lastScreenshotDataUrl: null as string | null,
    executionMessages: [] as Array<{ type: string; text: string; timestamp: number }>,
    liveviewTransport: 'webrtc' as 'webrtc' | 'mjpeg',
    setConnectionStatus: vi.fn(),
    setReconnectAttempt: vi.fn(),
    incrementReconnectAttempt: vi.fn(),
    resetReconnectAttempt: vi.fn(),
    setPlaywrightStatus: vi.fn(),
    setPlaywrightIsOpen: vi.fn(),
    setPlaywrightUrl: vi.fn(),
    incrementSnapshotVersion: vi.fn(),
    incrementLiveviewRefreshKey: vi.fn(),
    setLastScreenshotDataUrl: vi.fn(),
    addExecutionMessage: vi.fn(),
    setLiveviewTransport: vi.fn((mode: 'webrtc' | 'mjpeg') => {
      storeState.liveviewTransport = mode;
    }),
    reset: vi.fn(),
  },
}));

vi.mock('@/features/liveview/components/LiveViewCanvas.js', () => ({
  LiveViewCanvas: () => <div data-testid="mock-monitor-liveview">LiveViewCanvas</div>,
}));

vi.mock('@/features/runtime/hooks/index.js', () => ({
  useDebugSocket: () => ({
    sendMessage: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
  }),
}));

vi.mock('@/features/liveview/components/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/liveview/components/index.js')>();
  return {
    ...actual,
    LiveKitView: ({ onRenderError }: { onRenderError?: (error: Error) => void }) => (
      <div
        data-testid="mock-livekit-view"
        onClick={() => onRenderError?.(new Error('LiveKit connected without video track'))}
      />
    ),
      TransportToggle: ({
      onTransportChange,
      _webrtcAvailable: _available,
    }: {
      onTransportChange: (mode: 'webrtc' | 'mjpeg') => void;
      _webrtcAvailable: boolean;
    }) => (
      <div>
        <button
          data-testid="transport-toggle-webrtc"
          onClick={() => onTransportChange('webrtc')}
        >
          WebRTC
        </button>
        <button data-testid="transport-toggle-mjpeg" onClick={() => onTransportChange('mjpeg')}>
          MJPEG
        </button>
      </div>
    ),
  };
});

vi.mock('@/features/runtime/store/runtime.store.js', () => {
  const mockStore = {
    ...storeState,
    setConnectionStatus: vi.fn(),
    setReconnectAttempt: vi.fn(),
    incrementReconnectAttempt: vi.fn(),
    resetReconnectAttempt: vi.fn(),
    setPlaywrightStatus: vi.fn(),
    setPlaywrightIsOpen: vi.fn((isOpen) => {
      storeState.playwrightIsOpen = isOpen;
    }),
    setPlaywrightUrl: vi.fn(),
    incrementSnapshotVersion: vi.fn(),
    incrementLiveviewRefreshKey: vi.fn(),
    setLastScreenshotDataUrl: vi.fn(),
    addExecutionMessage: vi.fn(),
    setLiveviewTransport: vi.fn((mode) => {
      storeState.liveviewTransport = mode;
    }),
    reset: vi.fn(),
  };

  const useRuntimeStore = (selector: (s: typeof storeState) => unknown) => selector(storeState);
  (useRuntimeStore as any).getState = () => mockStore;

  return {
    useRuntimeStore,
    selectConnectionStatus: (s: typeof storeState) => s.connectionStatus,
    selectReconnectAttempt: (s: typeof storeState) => s.reconnectAttempt,
    selectPlaywrightStatus: (s: typeof storeState) => s.playwrightStatus,
    selectPlaywrightIsOpen: (s: typeof storeState) => s.playwrightIsOpen,
    selectPlaywrightUrl: (s: typeof storeState) => s.playwrightUrl,
    selectExecutionMessages: (s: typeof storeState) => s.executionMessages,
    selectLiveviewTransport: (s: typeof storeState) => s.liveviewTransport,
    selectLiveviewRefreshKey: (s: typeof storeState) => s.liveviewRefreshKey,
  };
});

describe('MonitorMainShell Transport Degradation', () => {
  beforeEach(() => {
    storeState.connectionStatus = 'disconnected';
    storeState.reconnectAttempt = 0;
    storeState.playwrightStatus = 'unknown';
    storeState.playwrightIsOpen = true;
    storeState.playwrightUrl = null;
    storeState.snapshotVersion = 0;
    storeState.liveviewRefreshKey = 0;
    storeState.lastScreenshotDataUrl = null;
    storeState.executionMessages = [];
    storeState.liveviewTransport = 'webrtc';
  });

  it('renders LiveKitView when preferred transport is webrtc and no error', () => {
    storeState.liveviewTransport = 'webrtc';
    render(<MonitorMainShell />);

    expect(screen.getByTestId('mock-livekit-view')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-monitor-liveview')).not.toBeInTheDocument();
  });

  it('degrades to MJPEG when LiveKitView reports render error', () => {
    storeState.liveviewTransport = 'webrtc';
    render(<MonitorMainShell />);

    const liveKitView = screen.getByTestId('mock-livekit-view');
    expect(liveKitView).toBeInTheDocument();
    expect(screen.queryByTestId('mock-monitor-liveview')).not.toBeInTheDocument();

    // Simulate render error by clicking the mock LiveKitView
    act(() => {
      fireEvent.click(liveKitView);
    });

    // After error, MJPEG should render
    expect(screen.getByTestId('mock-monitor-liveview')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-livekit-view')).not.toBeInTheDocument();
    // Degraded indicator should be visible
    expect(screen.getByText('已降级')).toBeInTheDocument();
  });

  it('re-enables WebRTC after transport toggle back to webrtc', async () => {
    storeState.liveviewTransport = 'webrtc';
    render(<MonitorMainShell />);

    const liveKitView = screen.getByTestId('mock-livekit-view');

    // Trigger error to degrade to MJPEG
    act(() => {
      fireEvent.click(liveKitView);
    });

    // Verify degradation
    expect(screen.getByTestId('mock-monitor-liveview')).toBeInTheDocument();
    expect(screen.getByText('已降级')).toBeInTheDocument();

    // Toggle transport back to WebRTC
    act(() => {
      fireEvent.click(screen.getByTestId('transport-toggle-webrtc'));
    });

    // WebRTC should be re-enabled
    await waitFor(() => {
      expect(screen.getByTestId('mock-livekit-view')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mock-monitor-liveview')).not.toBeInTheDocument();
    // Degraded indicator should be gone
    expect(screen.queryByText('已降级')).not.toBeInTheDocument();
  });

  it('resets webrtcFailed when browser closes', () => {
    storeState.playwrightIsOpen = true;
    storeState.liveviewTransport = 'webrtc';
    const { rerender } = render(<MonitorMainShell />);

    const liveKitView = screen.getByTestId('mock-livekit-view');

    // Trigger error to degrade to MJPEG
    act(() => {
      fireEvent.click(liveKitView);
    });

    // Verify degradation
    expect(screen.getByTestId('mock-monitor-liveview')).toBeInTheDocument();
    expect(screen.getByText('已降级')).toBeInTheDocument();

    // Close browser
    storeState.playwrightIsOpen = false;
    act(() => {
      rerender(<MonitorMainShell />);
    });

    // Degraded indicator should be gone (webrtcFailed was reset)
    expect(screen.queryByText('已降级')).not.toBeInTheDocument();

    // Re-open browser
    storeState.playwrightIsOpen = true;
    act(() => {
      rerender(<MonitorMainShell />);
    });

    // LiveKitView renders (not MJPEG) because webrtcFailed was reset
    expect(screen.getByTestId('mock-livekit-view')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-monitor-liveview')).not.toBeInTheDocument();
  });
});
