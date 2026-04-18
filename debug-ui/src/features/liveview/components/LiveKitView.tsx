import { useCallback, useEffect, useRef, useState } from 'react';
import { getImageFitRect, type ImageFitRect } from '@/features/liveview/lib/index.js';
import { selectPlaywrightIsOpen, useRuntimeStore } from '@/features/runtime/store/index.js';
import {
  selectViewport,
  useControlStore,
} from '@/features/playwright-control/store/control.store.js';
import { LiveViewOverlayLayer } from './LiveViewOverlayLayer.js';
import { useLiveKit } from '../hooks/useLiveKit.js';
import styles from './LiveKitView.module.css';

interface LiveKitViewProps {
  className?: string;
  onElementSelect?: (selector: string) => void;
  onCoordinateCapture?: (coords: { x: number; y: number }) => void;
  onRenderError?: (error: Error) => void;
}

export default function LiveKitView({
  className,
  onElementSelect,
  onCoordinateCapture,
  onRenderError,
}: LiveKitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRafRef = useRef<number>(0);
  const [tokenData, setTokenData] = useState<{ token: string; url: string } | null>(null);
  const [fitRect, setFitRect] = useState<ImageFitRect | null>(null);
  const { isConnected, trackStatus, connect, disconnect, videoElement, setOnTrackSubscribed } = useLiveKit();
  const isPlaywrightOpen = useRuntimeStore(selectPlaywrightIsOpen);
  const pageViewport = useControlStore(selectViewport);

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
        setFitRect(null);
        if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
          currentVideo.requestVideoFrameCallback(renderFrame);
        }
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const canvasW = clientWidth * dpr;
      const canvasH = clientHeight * dpr;
      const scale = Math.min(canvasW / videoWidth, canvasH / videoHeight);
      const drawWidth = videoWidth * scale;
      const drawHeight = videoHeight * scale;
      const offsetX = (canvasW - drawWidth) / 2;
      const offsetY = (canvasH - drawHeight) / 2;

      const imgW = pageViewport?.width ?? videoWidth;
      const imgH = pageViewport?.height ?? videoHeight;
      setFitRect(getImageFitRect(imgW, imgH, clientWidth, clientHeight));
      ctx.clearRect(0, 0, canvasW, canvasH);
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
  }, [pageViewport]);

  useEffect(() => {
    if (!isPlaywrightOpen) {
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

        onRenderError?.(new Error('LiveKit token response missing token or url'));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onRenderError?.(
            error instanceof Error ? error : new Error('Failed to fetch LiveKit token')
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isPlaywrightOpen, onRenderError]);

  useEffect(() => {
    if (!tokenData || isConnected) {
      return;
    }

    connect(tokenData).catch((error: unknown) => {
      onRenderError?.(error instanceof Error ? error : new Error('Failed to connect to LiveKit'));
    });
  }, [connect, isConnected, onRenderError, tokenData]);

  useEffect(() => {
    if (!isPlaywrightOpen && isConnected) {
      disconnect();
      setTokenData(null);
      setFitRect(null);
    }
  }, [disconnect, isConnected, isPlaywrightOpen]);

  const timeoutReportedRef = useRef(false);

  useEffect(() => {
    if (trackStatus === 'timeout' && !timeoutReportedRef.current) {
      timeoutReportedRef.current = true;
      onRenderError?.(new Error('LiveKit connected without video track'));
    }
    if (trackStatus === 'disconnected' || trackStatus === 'waiting') {
      timeoutReportedRef.current = false;
    }
  }, [trackStatus, onRenderError]);

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
      setFitRect(null);
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

  const containerClassName = className ? `${styles.container} ${className}` : styles.container;

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      data-testid="livekit-view"
      data-connected={isConnected}
    >
      <canvas ref={canvasRef} className={styles.canvas} />
      <LiveViewOverlayLayer
        fitRect={fitRect}
        onElementSelect={onElementSelect}
        onCoordinateCapture={onCoordinateCapture}
      />
    </div>
  );
}
