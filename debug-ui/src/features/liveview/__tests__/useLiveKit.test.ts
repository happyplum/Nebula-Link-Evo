import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  Room: vi.fn(() => mockRoom),
  RoomEvent: roomEvents,
}));

describe('useLiveKit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns disconnected state initially', async () => {
    const { useLiveKit } = await import('../hooks/useLiveKit.js');
    const { result } = renderHook(() => useLiveKit());

    expect(result.current.isConnected).toBe(false);
    expect(result.current.roomName).toBeNull();
    expect(result.current.videoElement).toBeNull();
  });

  it('connects with auto subscribe and updates state on connected event', async () => {
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
    });
  });

  it('stores the attached video element and runs track subscription callback', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    mockOn.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb);
      return mockRoom;
    });

    const { useLiveKit } = await import('../hooks/useLiveKit.js');
    const { result } = renderHook(() => useLiveKit());
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
      await result.current.connect({ token: 'test-token', url: 'ws://localhost:7880' });
    });

    await act(async () => {
      handlers.get(roomEvents.TrackSubscribed)?.(track, undefined, participant);
    });

    await waitFor(() => {
      expect(track.attach).toHaveBeenCalledTimes(1);
      expect(result.current.videoElement).toBe(video);
      expect(onTrackSubscribed).toHaveBeenCalledWith(track, participant);
    });
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
