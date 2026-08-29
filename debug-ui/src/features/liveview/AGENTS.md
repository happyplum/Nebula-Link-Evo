# Liveview Feature

## Overview

Liveview renders the remote browser via stream-first transport, maps image coordinates back to DOM space, and manages overlay selection.

## Where To Look

| Area             | Path                                  | Notes                                     |
| ---------------- | ------------------------------------- | ----------------------------------------- |
| Canvas renderer  | `components/LiveViewCanvas.tsx`       | Bitmap renderer, stream fallback, cleanup |
| Overlay          | `components/LiveViewOverlayLayer.tsx` | Selection layer over fitted image         |
| MJPEG parser     | `lib/mjpeg-parser.ts`                 | Multipart boundary parsing                |
| Geometry helpers | `lib/`                                | Fit-rect and coordinate mapping           |

## Working Rules

- Prefer the live stream first and fall back to polling screenshots only when the stream is unavailable.
- Keep the LiveKit component/client behind the WebRTC selection boundary; do not re-export it from a statically imported barrel, and keep MJPEG mounted while the chunk loads or fails.
- Keep `ImageBitmap`, Blob URL, `AbortController`, and `ResizeObserver` cleanup symmetrical.
- Recompute fit rect from container dimensions and actual image size before forwarding overlay clicks.
- Close the previous bitmap before replacing it.

## Contributor Traps

- MJPEG parsing is byte-oriented; text splitting breaks frame boundaries.
- `bitmaprenderer` transfer consumes the bitmap.
- Overlay coordinates must use the fitted rectangle, not raw container size.

## Anti-Patterns

- No `<img>`-based streaming hacks inside the canvas pipeline.
- No overlay logic that ignores `fitRect`.
- No stale screenshot fallback state left active after stream recovery.
