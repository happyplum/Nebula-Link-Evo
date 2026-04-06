import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveKit } from '../hooks/useLiveKit.js';
import { selectPlaywrightIsOpen, useRuntimeStore } from '@/features/runtime/store/index.js';
import { LiveViewCanvas } from './LiveViewCanvas.js';
import styles from './LiveKitView.module.css';

// LiveKit support is assumed available; fallback triggers on fetch/connect failure
const IS_LIVEKIT_SUPPORTED = true;

interface LiveKitViewProps {
  className?: string;
  onElementSelect?: (selector: string) => void;
  onCoordinateCapture?: (coords: { x: number; y: number }) => void;
}

export default function LiveKitView({
  className,
  onElementSelect,
  onCoordinateCapture,
}: LiveKitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRafRef = useRef<number>(0);
  const [showFallback, setShowFallback] = useState(!IS_LIVEKIT_SUPPORTED);
  const [tokenData, setTokenData] = useState<{ token: string; url: string } | null>(null);
  const { isConnected, connect, disconnect, videoElement, setOnTrackSubscribed } = useLiveKit();
  const isPlaywrightOpen = useRuntimeStore(selectPlaywrightIsOpen);

  const startOverlayLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const renderFrame = () => {
      const currentVideo = videoRef.current;
      const currentCanvas = canvasRef.current;
      if (!currentVideo || !currentCanvas) {
        return;
      }

      const { videoWidth, videoHeight } = currentVideo;
      const { clientWidth, clientHeight } = currentCanvas;
      if (videoWidth === 0 || videoHeight === 0) {
        if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
          currentVideo.requestVideoFrameCallback(renderFrame);
        }
        return;
      }

      const scale = Math.min(clientWidth / videoWidth, clientHeight / videoHeight);
      const drawWidth = videoWidth * scale;
      const drawHeight = videoHeight * scale;
      const offsetX = (clientWidth - drawWidth) / 2;
      const offsetY = (clientHeight - drawHeight) / 2;

      ctx.clearRect(0, 0, clientWidth, clientHeight);
      ctx.drawImage(currentVideo, offsetX, offsetY, drawWidth, drawHeight);

      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        currentVideo.requestVideoFrameCallback(renderFrame);
      }
    };

    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      video.requestVideoFrameCallback(renderFrame);
      return;
    }

    const rafLoop = () => {
      renderFrame();
      overlayRafRef.current = requestAnimationFrame(rafLoop);
    };

    rafLoop();
  }, []);

  useEffect(() => {
    if (!isPlaywrightOpen || showFallback) {
      return;
    }

    let cancelled = false;

    fetch('/api/livekit-token')
      .then((response) => response.json() as Promise<{ token?: string; url?: string }>)
      .then((data) => {
        if (cancelled) {
          return;
        }

        if (data.token && data.url) {
          setTokenData({ token: data.token, url: data.url });
          return;
        }

        setShowFallback(true);
      })
      .catch(() => {
        if (!cancelled) {
          setShowFallback(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isPlaywrightOpen, showFallback]);

  useEffect(() => {
    if (!tokenData || isConnected || showFallback) {
      return;
    }

    connect(tokenData).catch(() => setShowFallback(true));
  }, [connect, isConnected, showFallback, tokenData]);

  useEffect(() => {
    if (!isPlaywrightOpen && isConnected) {
      disconnect();
      setTokenData(null);
    }
  }, [disconnect, isConnected, isPlaywrightOpen]);

  useEffect(() => {
    setOnTrackSubscribed(() => {
      startOverlayLoop();
    });

    return () => {
      setOnTrackSubscribed(null);
    };
  }, [setOnTrackSubscribed, startOverlayLoop]);

  useEffect(() => {
    videoRef.current = videoElement;

    if (videoElement) {
      videoElement.style.cssText =
        'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
      containerRef.current?.appendChild(videoElement);
      startOverlayLoop();
    }

    return () => {
      if (videoElement && videoElement.parentNode) {
        videoElement.parentNode.removeChild(videoElement);
      }
    };
  }, [startOverlayLoop, videoElement]);

  useEffect(() => {
    return () => {
      if (overlayRafRef.current) {
        cancelAnimationFrame(overlayRafRef.current);
      }
    };
  }, []);

  const handleResize = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 2;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    handleResize();
    return () => observer.disconnect();
  }, [handleResize]);

  if (showFallback) {
    return (
      <LiveViewCanvas
        className={className}
        onElementSelect={onElementSelect}
        onCoordinateCapture={onCoordinateCapture}
      />
    );
  }

  const containerClassName = className ? `${styles.container} ${className}` : styles.container;

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      data-testid="livekit-view"
      data-connected={isConnected}
    >
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
