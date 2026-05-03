import { useCallback, useEffect, useRef, useState } from 'react';
import { createFrameCounter } from '@nebula-link-evo/shared';
import type { FrameCounter } from '@nebula-link-evo/shared';
import { getImageFitRect, type ImageFitRect } from '@/features/liveview/lib/index.js';
import {
  selectPlaywrightIsOpen,
  selectPlaywrightStatusHydrated,
  useRuntimeStore,
} from '@/features/runtime/store/index.js';
import { selectViewport, useControlStore } from '@/features/playwright-control/store/index.js';
import { LiveViewOverlayLayer } from './LiveViewOverlayLayer.js';
import { useLiveKit } from '../hooks/useLiveKit.js';
import styles from './LiveKitView.module.css';

// --- Debug frame counter (compile-time, tree-shaken when VITE_VIDEO_DEBUG !== '1') ---
const VIDEO_DEBUG = import.meta.env.VITE_VIDEO_DEBUG === '1';

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
  const lastScreenshotUrlRef = useRef<string | null>(null);
  const lastCaptureTimeRef = useRef(0);
  const [tokenData, setTokenData] = useState<{ token: string; url: string } | null>(null);
  const [fitRect, setFitRect] = useState<ImageFitRect | null>(null);
  const { isConnected, trackStatus, connect, disconnect, videoElement } = useLiveKit();
  const isPlaywrightOpen = useRuntimeStore(selectPlaywrightIsOpen);
  const playwrightStatusHydrated = useRuntimeStore(selectPlaywrightStatusHydrated);
  const setLastScreenshotDataUrl = useRuntimeStore((s) => s.setLastScreenshotDataUrl);
  const viewport = useControlStore(selectViewport);

  // Offscreen canvas caches the last video frame for resize redraw
  const lastFrameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugCounterRef = useRef<FrameCounter | null>(null);

  // Viewport ref for use inside render loop callbacks (avoids stale closure)
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // rVFC lifecycle: track callback ID for explicit cancel
  const videoFrameCallbackIdRef = useRef<number | null>(null);

  // Optimistic bootstrap: start before health confirms open.
  const shouldStartTransport = isPlaywrightOpen || !playwrightStatusHydrated;
  const isConfirmedClosed = playwrightStatusHydrated && !isPlaywrightOpen;

  const isConfirmedClosedRef = useRef(isConfirmedClosed);
  isConfirmedClosedRef.current = isConfirmedClosed;

  const captureScreenshot = useCallback(
    (canvas: HTMLCanvasElement) => {
      const now = Date.now();
      if (now - lastCaptureTimeRef.current < 1000) return;
      lastCaptureTimeRef.current = now;

      canvas.toBlob((blob) => {
        if (!blob) return;
        if (
          lastScreenshotUrlRef.current &&
          lastScreenshotUrlRef.current.startsWith('blob:') &&
          typeof URL.revokeObjectURL === 'function'
        ) {
          URL.revokeObjectURL(lastScreenshotUrlRef.current);
        }
        const url = URL.createObjectURL(blob);
        lastScreenshotUrlRef.current = url;
        setLastScreenshotDataUrl(url);
      }, 'image/jpeg', 0.9);
    },
    [setLastScreenshotDataUrl],
  );

  /** Draw a CanvasImageSource (video or offscreen canvas) to the display canvas with fit-rect.
   *  Uses viewport dimensions for coordinate mapping so that WebRTC resolution
   *  adaptation does not distort click coordinates. Visual rendering still uses
   *  the actual source dimensions (drawImage handles the scaling). */
  const drawSourceToCanvas = useCallback(
    (source: CanvasImageSource, sourceW: number, sourceH: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const containerW = canvas.width / dpr;
      const containerH = canvas.height / dpr;

      // Use viewport dimensions for coordinate mapping fitRect.
      // WebRTC may downscale the video stream, but the content always represents
      // the full browser viewport. Falling back to source dimensions when viewport
      // is not yet available.
      const vp = viewportRef.current;
      const coordW = vp?.width ?? sourceW;
      const coordH = vp?.height ?? sourceH;

      const fit = getImageFitRect(coordW, coordH, containerW, containerH);
      if (!fit) {
        setFitRect(null);
        return;
      }

      setFitRect(fit);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        source,
        fit.offsetX * dpr,
        fit.offsetY * dpr,
        fit.drawW * dpr,
        fit.drawH * dpr,
      );
    },
    [],
  );

  /** Cache the current video frame to an offscreen canvas for later resize redraw. */
  const cacheVideoFrame = useCallback((video: HTMLVideoElement) => {
    const { videoWidth, videoHeight } = video;
    if (videoWidth === 0 || videoHeight === 0) return;

    const buffer = lastFrameCanvasRef.current ?? document.createElement('canvas');
    buffer.width = videoWidth;
    buffer.height = videoHeight;

    const bufferCtx = buffer.getContext('2d');
    if (!bufferCtx) return;

    bufferCtx.clearRect(0, 0, videoWidth, videoHeight);
    bufferCtx.drawImage(video, 0, 0, videoWidth, videoHeight);
    lastFrameCanvasRef.current = buffer;
  }, []);

  /** Cancel any active rVFC or RAF loop. */
  const cancelVideoFrameLoop = useCallback(() => {
    const video = videoRef.current;
    if (
      video &&
      videoFrameCallbackIdRef.current !== null &&
      'cancelVideoFrameCallback' in video
    ) {
      (video as HTMLVideoElement & { cancelVideoFrameCallback: (id: number) => void })
        .cancelVideoFrameCallback(videoFrameCallbackIdRef.current);
    }
    videoFrameCallbackIdRef.current = null;

    if (overlayRafRef.current) {
      cancelAnimationFrame(overlayRafRef.current);
      overlayRafRef.current = 0;
    }
  }, []);

  /** Start the rVFC (or RAF fallback) render loop. */
  const startVideoFrameLoop = useCallback(() => {
    cancelVideoFrameLoop();

    const renderFrame = () => {
      const currentVideo = videoRef.current;
      const currentCanvas = canvasRef.current;
      if (!currentVideo || !currentCanvas) return;

      const { videoWidth, videoHeight } = currentVideo;
      if (videoWidth === 0 || videoHeight === 0) {
        // Don't clear fitRect — preserve overlay during transient video pauses
        if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
          videoFrameCallbackIdRef.current =
            currentVideo.requestVideoFrameCallback(renderFrame);
        }
        return;
      }

      drawSourceToCanvas(currentVideo, videoWidth, videoHeight);
      cacheVideoFrame(currentVideo);
      captureScreenshot(currentCanvas);
      debugCounterRef.current?.recordFrame();

      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        videoFrameCallbackIdRef.current =
          currentVideo.requestVideoFrameCallback(renderFrame);
        return;
      }

      overlayRafRef.current = requestAnimationFrame(renderFrame);
    };

    const video = videoRef.current;
    if (!video) return;

    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      videoFrameCallbackIdRef.current = video.requestVideoFrameCallback(renderFrame);
      return;
    }

    const rafLoop = () => {
      renderFrame();
      overlayRafRef.current = requestAnimationFrame(rafLoop);
    };
    rafLoop();
  }, [cancelVideoFrameLoop, drawSourceToCanvas, cacheVideoFrame, captureScreenshot]);

  // Fetch LiveKit token when transport should start
  useEffect(() => {
    if (!shouldStartTransport) {
      setTokenData(null);
      return;
    }

    let cancelled = false;

    fetch('/api/livekit-token')
      .then((response) => response.json() as Promise<{ token?: string; url?: string }>)
      .then((data) => {
        if (cancelled) return;

        if (data.token && data.url) {
          setTokenData({ token: data.token, url: data.url });
          return;
        }

        onRenderError?.(new Error('LiveKit token response missing token or url'));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onRenderError?.(
            error instanceof Error ? error : new Error('Failed to fetch LiveKit token'),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shouldStartTransport, onRenderError]);

  // Connect to LiveKit when token available
  useEffect(() => {
    if (!tokenData || isConnected) return;

    connect(tokenData).catch((error: unknown) => {
      onRenderError?.(error instanceof Error ? error : new Error('Failed to connect to LiveKit'));
    });
  }, [connect, isConnected, onRenderError, tokenData]);

  // Disconnect on confirmed close
  useEffect(() => {
    if (isConfirmedClosed && isConnected) {
      disconnect();
      setTokenData(null);
    }
  }, [disconnect, isConnected, isConfirmedClosed]);

  // Initialize debug frame counter when VIDEO_DEBUG is true
  useEffect(() => {
    if (VIDEO_DEBUG) {
      const counter = createFrameCounter(1000);
      debugCounterRef.current = counter;
      const interval = setInterval(() => {
        console.log('[NLE-Debug] livekit', counter.getSummary());
      }, 1000);
      return () => {
        clearInterval(interval);
        debugCounterRef.current = null;
      };
    }
  }, []);

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

  // Manage video element attachment and render loop lifecycle
  useEffect(() => {
    videoRef.current = videoElement;

    if (videoElement) {
      videoElement.style.cssText =
        'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
      containerRef.current?.appendChild(videoElement);
      startVideoFrameLoop();
    }

    return () => {
      cancelVideoFrameLoop();
      if (videoElement && videoElement.parentNode) {
        videoElement.parentNode.removeChild(videoElement);
      }
      // Only clear overlay on confirmed close, not during optimistic bootstrap
      if (isConfirmedClosedRef.current) {
        setFitRect(null);
        lastFrameCanvasRef.current = null;
      }
    };
  }, [videoElement, startVideoFrameLoop, cancelVideoFrameLoop]);

  // Resize handler: redraw cached frame with proper fitRect scaling
  const handleResize = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);

    // Try live video first
    const video = videoRef.current;
    if (video?.videoWidth && video?.videoHeight) {
      drawSourceToCanvas(video, video.videoWidth, video.videoHeight);
      return;
    }

    // Fall back to cached offscreen canvas
    const cached = lastFrameCanvasRef.current;
    if (cached) {
      drawSourceToCanvas(cached, cached.width, cached.height);
    }
  }, [drawSourceToCanvas]);

  useEffect(() => {
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    handleResize();
    return () => observer.disconnect();
  }, [handleResize]);

  // Cleanup screenshot blob URL on unmount
  useEffect(() => {
    return () => {
      if (
        lastScreenshotUrlRef.current &&
        lastScreenshotUrlRef.current.startsWith('blob:') &&
        typeof URL.revokeObjectURL === 'function'
      ) {
        URL.revokeObjectURL(lastScreenshotUrlRef.current);
      }
      setLastScreenshotDataUrl(null);
    };
  }, [setLastScreenshotDataUrl]);

  // Immediately redraw current video frame when tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;

      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) return;

      drawSourceToCanvas(video, video.videoWidth, video.videoHeight);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [drawSourceToCanvas]);

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
