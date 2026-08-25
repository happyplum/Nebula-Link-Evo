import { describe, expect, it } from 'vitest';
import {
  canvasToPageCoords,
  getImageFitRect,
  pageToCanvasCoords,
  type ImageFitRect,
} from './coordinates.js';
import { mustExist } from '@/test-support/must-exist.js';

describe('getImageFitRect', () => {
  it('fits landscape image in portrait container', () => {
    // 1920×1080 image in 400×600 container
    const fit = mustExist(getImageFitRect(1920, 1080, 400, 600), 'landscape fit');
    expect(fit).not.toBeNull();

    // Scale constrained by width: 400/1920 ≈ 0.2083
    expect(fit.scale).toBeCloseTo(400 / 1920, 6);
    expect(fit.drawW).toBeCloseTo(400, 6);
    expect(fit.drawH).toBeCloseTo((1080 * 400) / 1920, 6);
    // Centered vertically
    expect(fit.offsetX).toBeCloseTo(0, 6);
    expect(fit.offsetY).toBeCloseTo((600 - fit.drawH) / 2, 6);
    expect(fit.imgW).toBe(1920);
    expect(fit.imgH).toBe(1080);
  });

  it('fits portrait image in landscape container', () => {
    // 1080×1920 image in 600×400 container
    const fit = mustExist(getImageFitRect(1080, 1920, 600, 400), 'portrait fit');
    expect(fit).not.toBeNull();

    // Scale constrained by height: 400/1920 ≈ 0.2083
    expect(fit.scale).toBeCloseTo(400 / 1920, 6);
    expect(fit.drawH).toBeCloseTo(400, 6);
    expect(fit.drawW).toBeCloseTo((1080 * 400) / 1920, 6);
    // Centered horizontally
    expect(fit.offsetY).toBeCloseTo(0, 6);
    expect(fit.offsetX).toBeCloseTo((600 - fit.drawW) / 2, 6);
  });

  it('handles exact aspect-ratio match', () => {
    // 800×600 image in 400×300 container (same 4:3 ratio)
    const fit = mustExist(getImageFitRect(800, 600, 400, 300), 'exact-ratio fit');
    expect(fit).not.toBeNull();
    expect(fit.scale).toBe(0.5);
    expect(fit.drawW).toBe(400);
    expect(fit.drawH).toBe(300);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(0);
  });

  it('returns null for zero image width', () => {
    expect(getImageFitRect(0, 600, 400, 300)).toBeNull();
  });

  it('returns null for zero image height', () => {
    expect(getImageFitRect(800, 0, 400, 300)).toBeNull();
  });

  it('returns null for zero container width', () => {
    expect(getImageFitRect(800, 600, 0, 300)).toBeNull();
  });

  it('returns null for zero container height', () => {
    expect(getImageFitRect(800, 600, 400, 0)).toBeNull();
  });

  it('returns null for negative dimensions', () => {
    expect(getImageFitRect(-10, 600, 400, 300)).toBeNull();
    expect(getImageFitRect(800, -10, 400, 300)).toBeNull();
    expect(getImageFitRect(800, 600, -10, 300)).toBeNull();
    expect(getImageFitRect(800, 600, 400, -10)).toBeNull();
  });

  it('preserves image dimensions in the result', () => {
    const fit = mustExist(getImageFitRect(640, 480, 320, 240), 'dimension fit');
    expect(fit.imgW).toBe(640);
    expect(fit.imgH).toBe(480);
  });
});

describe('canvasToPageCoords', () => {
  // Exact fit: 800×600 image in 800×600 container, scale=1, offset=0
  const exactFit: ImageFitRect = {
    offsetX: 0,
    offsetY: 0,
    drawW: 800,
    drawH: 600,
    scale: 1,
    imgW: 800,
    imgH: 600,
  };

  // Scaled fit: 1600×1200 image in 800×600 container, scale=0.5
  const scaledFit: ImageFitRect = {
    offsetX: 0,
    offsetY: 0,
    drawW: 800,
    drawH: 600,
    scale: 0.5,
    imgW: 1600,
    imgH: 1200,
  };

  // Offset fit: 400×200 image in 800×600 container, scale=1.5, offsetX=100, offsetY=150
  const offsetFit: ImageFitRect = {
    offsetX: 100,
    offsetY: 150,
    drawW: 600,
    drawH: 300,
    scale: 1.5,
    imgW: 400,
    imgH: 200,
  };

  it('converts center of exact-fit image', () => {
    const result = canvasToPageCoords(400, 300, exactFit);
    expect(result).toEqual({ x: 400, y: 300 });
  });

  it('converts top-left corner', () => {
    const result = canvasToPageCoords(0, 0, exactFit);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('converts bottom-right corner', () => {
    const result = canvasToPageCoords(800, 600, exactFit);
    expect(result).toEqual({ x: 800, y: 600 });
  });

  it('scales coordinates from canvas to page', () => {
    // Canvas (400, 300) at scale 0.5 → page (800, 600)
    const result = canvasToPageCoords(400, 300, scaledFit);
    expect(result).toEqual({ x: 800, y: 600 });
  });

  it('accounts for offset', () => {
    // Canvas (250, 225) → relative (150, 75) → page (100, 50) at scale 1.5
    const result = canvasToPageCoords(250, 225, offsetFit);
    expect(result).toEqual({ x: 100, y: 50 });
  });

  it('returns null for coordinates left of image', () => {
    expect(canvasToPageCoords(50, 300, offsetFit)).toBeNull();
  });

  it('returns null for coordinates above image', () => {
    expect(canvasToPageCoords(400, 50, offsetFit)).toBeNull();
  });

  it('returns null for coordinates right of image', () => {
    expect(canvasToPageCoords(750, 300, offsetFit)).toBeNull();
  });

  it('returns null for coordinates below image', () => {
    expect(canvasToPageCoords(400, 500, offsetFit)).toBeNull();
  });

  it('returns null for negative coordinates', () => {
    expect(canvasToPageCoords(-1, 300, exactFit)).toBeNull();
    expect(canvasToPageCoords(400, -1, exactFit)).toBeNull();
  });

  it('rounds page coordinates', () => {
    // 100.4 / 0.5 = 200.8 → rounds to 201
    const fit: ImageFitRect = {
      offsetX: 0,
      offsetY: 0,
      drawW: 800,
      drawH: 600,
      scale: 0.5,
      imgW: 1600,
      imgH: 1200,
    };
    const result = mustExist(canvasToPageCoords(100.4, 0, fit), 'rounded page coordinates');
    expect(result.x).toBe(201);
  });
});

describe('pageToCanvasCoords', () => {
  const exactFit: ImageFitRect = {
    offsetX: 0,
    offsetY: 0,
    drawW: 800,
    drawH: 600,
    scale: 1,
    imgW: 800,
    imgH: 600,
  };

  const scaledFit: ImageFitRect = {
    offsetX: 0,
    offsetY: 0,
    drawW: 800,
    drawH: 600,
    scale: 0.5,
    imgW: 1600,
    imgH: 1200,
  };

  const offsetFit: ImageFitRect = {
    offsetX: 100,
    offsetY: 150,
    drawW: 600,
    drawH: 300,
    scale: 1.5,
    imgW: 400,
    imgH: 200,
  };

  it('converts page origin to canvas origin', () => {
    const result = pageToCanvasCoords(0, 0, exactFit);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('scales page coordinates to canvas', () => {
    // Page (800, 600) at scale 0.5 → canvas (400, 300)
    const result = pageToCanvasCoords(800, 600, scaledFit);
    expect(result).toEqual({ x: 400, y: 300 });
  });

  it('accounts for offset', () => {
    // Page (100, 50) at scale 1.5 → canvas (250, 225)
    const result = pageToCanvasCoords(100, 50, offsetFit);
    expect(result).toEqual({ x: 250, y: 225 });
  });

  it('round-trips with canvasToPageCoords', () => {
    const pageX = 320;
    const pageY = 240;
    const canvas = pageToCanvasCoords(pageX, pageY, scaledFit);
    const back = canvasToPageCoords(canvas.x, canvas.y, scaledFit);
    expect(back).toEqual({ x: pageX, y: pageY });
  });

  it('round-trips with offset fit', () => {
    const pageX = 200;
    const pageY = 100;
    const canvas = pageToCanvasCoords(pageX, pageY, offsetFit);
    const back = canvasToPageCoords(canvas.x, canvas.y, offsetFit);
    expect(back).toEqual({ x: pageX, y: pageY });
  });

  it('handles non-integer page coordinates (round-trip is approximate)', () => {
    // With a non-integer scale, the round-trip may round
    const fit: ImageFitRect = {
      offsetX: 10,
      offsetY: 20,
      drawW: 600,
      drawH: 400,
      scale: 0.6,
      imgW: 1000,
      imgH: 667,
    };
    const pageX = 500;
    const pageY = 333;
    const canvas = pageToCanvasCoords(pageX, pageY, fit);
    const back = mustExist(canvasToPageCoords(canvas.x, canvas.y, fit), 'round-trip coordinates');
    // Round-trip may differ by at most 1 due to Math.round
    expect(Math.abs(back.x - pageX)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.y - pageY)).toBeLessThanOrEqual(1);
  });
});
