import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockTrackStatus: 'disconnected' | 'waiting' | 'ready' | 'timeout' = 'disconnected';

const connectMock = vi.fn().mockResolvedValue(undefined);
const disconnectMock = vi.fn();
const setOnTrackSubscribedMock = vi.fn();

const runtimeState = {
  playwrightIsOpen: false,
};

vi.mock('../hooks/useLiveKit.js', () => ({
  useLiveKit: () => ({
    isConnected: false,
    roomName: null,
    trackStatus: mockTrackStatus,
    connect: connectMock,
    disconnect: disconnectMock,
    videoElement: null,
    setOnTrackSubscribed: setOnTrackSubscribedMock,
  }),
}));

vi.mock('@/features/runtime/store/index.js', () => ({
  useRuntimeStore: (selector: (state: typeof runtimeState) => unknown) => selector(runtimeState),
  selectPlaywrightIsOpen: (state: typeof runtimeState) => state.playwrightIsOpen,
}));

vi.mock('../components/LiveViewCanvas.js', () => ({
  LiveViewCanvas: ({ className }: { className?: string }) => (
    <div data-testid="liveview-fallback" data-classname={className ?? ''} />
  ),
}));

describe('LiveKitView', () => {
  const originalFetch = globalThis.fetch;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    runtimeState.playwrightIsOpen = false;
    mockTrackStatus = 'disconnected';

    globalThis.fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ token: 'livekit-token', url: 'wss://livekit.test' }),
    }) as unknown as typeof fetch;

    class ResizeObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
    }

    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.ResizeObserver = originalResizeObserver;
  });

  // TODO(removed-fallback): LiveKitView no longer falls back to LiveViewCanvas when
  // livekit-client import fails. The component always renders its own canvas container
  // with data-testid="livekit-view". The livekit-client support check was removed.
  it.skip('renders LiveViewCanvas fallback when LiveKit support check fails', async () => {
    vi.doMock('livekit-client', () => {
      throw new Error('unsupported');
    });

    const { default: LiveKitView } = await import('../components/LiveKitView.js');

    render(<LiveKitView className="fallback-shell" />);

    expect(screen.getByTestId('liveview-fallback')).toHaveAttribute(
      'data-classname',
      'fallback-shell'
    );
    expect(screen.queryByTestId('livekit-view')).toBeNull();
  });

  it('renders the livekit canvas container and connects after token fetch', async () => {
    runtimeState.playwrightIsOpen = true;
    vi.doMock('livekit-client', () => ({}));

    const { default: LiveKitView } = await import('../components/LiveKitView.js');

    render(<LiveKitView />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/livekit-token');
      expect(connectMock).toHaveBeenCalledWith({
        token: 'livekit-token',
        url: 'wss://livekit.test',
      });
    });

    expect(screen.getByTestId('livekit-view')).toHaveAttribute('data-connected', 'false');
  });

  it('calls onRenderError when trackStatus becomes timeout', async () => {
    runtimeState.playwrightIsOpen = true;
    vi.doMock('livekit-client', () => ({}));

    const { default: LiveKitView } = await import('../components/LiveKitView.js');

    const renderError = vi.fn();
    const { rerender } = render(<LiveKitView onRenderError={renderError} />);

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalled();
    });

    mockTrackStatus = 'timeout';
    rerender(<LiveKitView onRenderError={renderError} />);

    await waitFor(() => {
      expect(renderError).toHaveBeenCalledWith(expect.any(Error));
    });

    expect(renderError.mock.calls[0][0].message).toBe('LiveKit connected without video track');
  });

  it('does not call onRenderError when trackStatus becomes ready', async () => {
    runtimeState.playwrightIsOpen = true;
    vi.doMock('livekit-client', () => ({}));

    const { default: LiveKitView } = await import('../components/LiveKitView.js');

    const renderError = vi.fn();
    const { rerender } = render(<LiveKitView onRenderError={renderError} />);

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalled();
    });

    mockTrackStatus = 'ready';
    rerender(<LiveKitView onRenderError={renderError} />);

    expect(renderError).not.toHaveBeenCalled();
  });
});
