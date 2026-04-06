import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import type { RemoteParticipant, RemoteTrack } from 'livekit-client';

interface UseLiveKitReturn {
  isConnected: boolean;
  roomName: string | null;
  connect: (options: { token: string; url: string }) => Promise<void>;
  disconnect: () => void;
  videoElement: HTMLVideoElement | null;
  setOnTrackSubscribed: (
    cb: ((track: RemoteTrack, participant: RemoteParticipant) => void) | null
  ) => void;
}

export function useLiveKit(): UseLiveKitReturn {
  const roomRef = useRef<Room | null>(null);
  const onTrackRef = useRef<((track: RemoteTrack, participant: RemoteParticipant) => void) | null>(
    null
  );
  const [isConnected, setIsConnected] = useState(false);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  const disconnect = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    setVideoElement(null);
    setIsConnected(false);
    setRoomName(null);
  }, []);

  const connect = useCallback(
    async ({ token, url }: { token: string; url: string }) => {
      disconnect();

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      room.on(RoomEvent.Connected, () => {
        setIsConnected(true);
        setRoomName(room.name ?? null);
      });

      room.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, _publication: unknown, participant: RemoteParticipant) => {
          if (track.kind !== 'video') {
            return;
          }

          const element = track.attach() as HTMLVideoElement;
          setVideoElement(element);
          onTrackRef.current?.(track, participant);
        }
      );

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach();
        setVideoElement(null);
      });

      room.on(RoomEvent.Disconnected, () => {
        setIsConnected(false);
        setRoomName(null);
        setVideoElement(null);
      });

      roomRef.current = room;
      await room.connect(url, token, { autoSubscribe: true, maxRetries: 3 });
    },
    [disconnect]
  );

  const setOnTrackSubscribed = useCallback(
    (cb: ((track: RemoteTrack, participant: RemoteParticipant) => void) | null) => {
      onTrackRef.current = cb;
    },
    []
  );

  useEffect(() => () => disconnect(), [disconnect]);

  return {
    isConnected,
    roomName,
    connect,
    disconnect,
    videoElement,
    setOnTrackSubscribed,
  };
}
