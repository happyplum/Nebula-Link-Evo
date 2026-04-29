import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteParticipant, RemoteTrack } from 'livekit-client';

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn();
const mockOn = vi.fn();

const mockRoom = {
  connect: mockConnect,
  disconnect: mockDisconnect,
  on: mockOn,
  name: 'test-room',
};

const roomEvents = {
  TrackSubscribed: 'track_subscribed',
  TrackUnsubscribed: 'track_unsubscribed',
  Disconnected: 'disconnected',
  Connected: 'connected',
};

vi.mock('livekit-client', () => ({
  Room: vi.fn(function (this: unknown) {
    Object.assign(this, mockRoom);
  }),
  RoomEvent: roomEvents,
}));

describe('useLiveKit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns disconnected state initially', async () => {
    const { useLiveKit } = await import('../hooks/useLiveKit.js');
    const { result } = renderHook(() => useLiveKit());

    expect(result.current.isConnected).toBe(false);
    expect(result.current.roomName).toBeNull();
    expect(result.current.videoElement).toBeNull();
    expect(result.current.trackStatus).toBe('disconnected');
  });

  it('transitions to waiting on room connect, then ready on track subscribe', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    mockOn.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb);
      return mockRoom;
    });

    const { useLiveKit } = await import('../hooks/useLiveKit.js');
    const { result } = renderHook(() => useLiveKit());

    await act(async () => {
      await result.current.connect({
        token: 'test-token',
        url: 'ws://localhost:7880',
      });
    });

    expect(mockConnect).toHaveBeenCalledWith(
      'ws://localhost:7880',
      'test-token',
      expect.objectContaining({
        autoSubscribe: true,
        maxRetries: 3,
      })
    );

    await act(async () => {
      handlers.get(roomEvents.Connected)?.();
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
      expect(result.current.roomName).toBe('test-room');
      expect(result.current.trackStatus).toBe('waiting');
    });
    const onTrackSubscribed = vi.fn();
    const video = document.createElement('video');
    const track = {
      kind: 'video',
      attach: vi.fn(() => video),
      detach: vi.fn(),
    } as unknown as RemoteTrack;
    const participant = { identity: 'remote-user' } as RemoteParticipant;

    result.current.setOnTrackSubscribed(onTrackSubscribed);

    await act(async () => {
      handlers.get(roomEvents.TrackSubscribed)?.(track, undefined, participant);
    });

    await waitFor(() => {
      expect(track.attach).toHaveBeenCalledTimes(1);
      expect(result.current.videoElement).toBe(video);
      expect(result.current.trackStatus).toBe('ready');
      expect(onTrackSubscribed).toHaveBeenCalledWith(track, participant);
    });
  });

  it('transitions to timeout when no video track arrives within timeout', async () => {
    vi.useFakeTimers();

    const handlers = new Map<string, (...args: unknown[]) => void>();
    mockOn.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb);
      return mockRoom;
    });

    const { useLiveKit } = await import('../hooks/useLiveKit.js');
    const { result } = renderHook(() => useLiveKit({ timeoutMs: 100 }));

    await act(async () => {
      await result.current.connect({ token: 'test-token', url: 'ws://localhost:7880' });
    });

    await act(async () => {
      handlers.get(roomEvents.Connected)?.();
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(result.current.trackStatus).toBe('timeout');
    expect(result.current.isConnected).toBe(false);
    expect(result.current.roomName).toBeNull();
  });

  it('clears timeout timer on disconnect', async () => {
    vi.useFakeTimers();

    const handlers = new Map<string, (...args: unknown[]) => void>();
    mockOn.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb);
      return mockRoom;
    });

    const { useLiveKit } = await import('../hooks/useLiveKit.js');
    const { result } = renderHook(() => useLiveKit({ timeoutMs: 100 }));

    await act(async () => {
      await result.current.connect({ token: 'test-token', url: 'ws://localhost:7880' });
    });

    act(() => {
      handlers.get(roomEvents.Connected)?.();
    });

    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      result.current.disconnect();
      vi.advanceTimersByTime(100);
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(result.current.trackStatus).toBe('disconnected');
  });

  it('resets to disconnected on room disconnect event', async () => {
    vi.useFakeTimers();

    const handlers = new Map<string, (...args: unknown[]) => void>();
    mockOn.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb);
      return mockRoom;
    });

    const { useLiveKit } = await import('../hooks/useLiveKit.js');
    const { result } = renderHook(() => useLiveKit({ timeoutMs: 100 }));

    await act(async () => {
      await result.current.connect({ token: 'test-token', url: 'ws://localhost:7880' });
    });

    act(() => {
      handlers.get(roomEvents.Connected)?.();
    });

    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      handlers.get(roomEvents.Disconnected)?.();
      vi.advanceTimersByTime(100);
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.trackStatus).toBe('disconnected');
    expect(result.current.isConnected).toBe(false);
    expect(result.current.roomName).toBeNull();
    expect(result.current.videoElement).toBeNull();
  });

  it('accepts custom timeoutMs option', async () => {
    vi.useFakeTimers();

    const handlers = new Map<string, (...args: unknown[]) => void>();
    mockOn.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb);
      return mockRoom;
    });

    const { useLiveKit } = await import('../hooks/useLiveKit.js');
    const { result } = renderHook(() => useLiveKit({ timeoutMs: 250 }));

    await act(async () => {
      await result.current.connect({ token: 'test-token', url: 'ws://localhost:7880' });
    });

    act(() => {
      handlers.get(roomEvents.Connected)?.();
      vi.advanceTimersByTime(249);
    });

    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(result.current.trackStatus).toBe('waiting');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(result.current.trackStatus).toBe('timeout');
  });

  it('disconnects on unmount', async () => {
    const { useLiveKit } = await import('../hooks/useLiveKit.js');
    const { result, unmount } = renderHook(() => useLiveKit());

    await act(async () => {
      await result.current.connect({
        token: 'test-token',
        url: 'ws://localhost:7880',
      });
    });

    unmount();

    expect(mockDisconnect).toHaveBeenCalled();
  });
});
