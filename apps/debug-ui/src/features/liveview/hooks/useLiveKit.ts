import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, setLogLevel } from 'livekit-client';
import type { RemoteParticipant, RemoteTrack } from 'livekit-client';

// Suppress livekit-client SDK console logs
setLogLevel('error');

type TrackStatus = 'disconnected' | 'waiting' | 'ready' | 'timeout';

interface UseLiveKitReturn {
  isConnected: boolean;
  roomName: string | null;
  trackStatus: TrackStatus;
  connect: (options: { token: string; url: string }) => Promise<void>;
  disconnect: () => void;
  videoElement: HTMLVideoElement | null;
  setOnTrackSubscribed: (
    cb: ((track: RemoteTrack, participant: RemoteParticipant) => void) | null
  ) => void;
}

export function useLiveKit(options?: { timeoutMs?: number }): UseLiveKitReturn {
  const timeoutMs = options?.timeoutMs ?? 4000;
  const roomRef = useRef<Room | null>(null);
  const trackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTriggeredRef = useRef(false);
  const onTrackRef = useRef<((track: RemoteTrack, participant: RemoteParticipant) => void) | null>(
    null
  );
  const [isConnected, setIsConnected] = useState(false);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [trackStatus, setTrackStatus] = useState<TrackStatus>('disconnected');

  const clearTrackTimeout = useCallback(() => {
    if (trackTimeoutRef.current !== null) {
      clearTimeout(trackTimeoutRef.current);
      trackTimeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    timeoutTriggeredRef.current = false;
    clearTrackTimeout();
    roomRef.current?.disconnect();
    roomRef.current = null;
    setVideoElement(null);
    setIsConnected(false);
    setRoomName(null);
    setTrackStatus('disconnected');
  }, [clearTrackTimeout]);

  const connect = useCallback(
    async ({ token, url }: { token: string; url: string }) => {
      disconnect();

      const room = new Room({
        adaptiveStream: false,
        dynacast: false,
      });

      room.on(RoomEvent.Connected, () => {
        setIsConnected(true);
        setRoomName(room.name ?? null);
        setTrackStatus('waiting');

        clearTrackTimeout();
        trackTimeoutRef.current = setTimeout(() => {
          timeoutTriggeredRef.current = true;
          clearTrackTimeout();
          room.disconnect();
          roomRef.current = null;
          setIsConnected(false);
          setRoomName(null);
          setVideoElement(null);
          setTrackStatus('timeout');
        }, timeoutMs);
      });

      room.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, _publication: unknown, participant: RemoteParticipant) => {
          if (track.kind !== 'video') {
            return;
          }

          timeoutTriggeredRef.current = false;
          clearTrackTimeout();
          const element = track.attach() as HTMLVideoElement;
          setVideoElement(element);
          setTrackStatus('ready');
          onTrackRef.current?.(track, participant);
        }
      );

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        timeoutTriggeredRef.current = false;
        clearTrackTimeout();
        track.detach();
        setVideoElement(null);
        setTrackStatus('disconnected');
      });

      room.on(RoomEvent.Disconnected, () => {
        const wasTimeout = timeoutTriggeredRef.current;
        clearTrackTimeout();
        setIsConnected(false);
        setRoomName(null);
        setVideoElement(null);
        roomRef.current = null;

        if (!wasTimeout) {
          setTrackStatus('disconnected');
        }

        timeoutTriggeredRef.current = false;
      });

      roomRef.current = room;
      await room.connect(url, token, { autoSubscribe: true, maxRetries: 3 });
    },
    [clearTrackTimeout, disconnect, timeoutMs]
  );

  const setOnTrackSubscribed = useCallback(
    (cb: ((track: RemoteTrack, participant: RemoteParticipant) => void) | null) => {
      onTrackRef.current = cb;
    },
    []
  );

  useEffect(
    () => () => {
      clearTrackTimeout();
      disconnect();
    },
    [clearTrackTimeout, disconnect]
  );

  return {
    isConnected,
    roomName,
    trackStatus,
    connect,
    disconnect,
    videoElement,
    setOnTrackSubscribed,
  };
}
