export interface ImageFitRect {
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
  scale: number;
  imgW: number;
  imgH: number;
}

/**
 * Calculates the "contain" fit rect for an image inside a container.
 * The image is scaled uniformly to fit entirely within the container,
 * then centered.
 *
 * Returns `null` when inputs have zero/negative dimensions.
 */
export function getImageFitRect(
  imgW: number,
  imgH: number,
  containerW: number,
  containerH: number,
): ImageFitRect | null {
  if (imgW <= 0 || imgH <= 0 || containerW <= 0 || containerH <= 0) {
    return null;
  }

  const scale = Math.min(containerW / imgW, containerH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const offsetX = (containerW - drawW) / 2;
  const offsetY = (containerH - drawH) / 2;

  return { offsetX, offsetY, drawW, drawH, scale, imgW, imgH };
}

/**
 * Converts canvas CSS coordinates to page (image-native) coordinates.
 * Returns `null` if the point is outside the drawn image area.
 */
export function canvasToPageCoords(
  cssX: number,
  cssY: number,
  fit: ImageFitRect,
): { x: number; y: number } | null {
  const relX = cssX - fit.offsetX;
  const relY = cssY - fit.offsetY;

  if (relX < 0 || relX > fit.drawW || relY < 0 || relY > fit.drawH) {
    return null;
  }

  return {
    x: Math.round(relX / fit.scale),
    y: Math.round(relY / fit.scale),
  };
}

/**
 * Converts page (image-native) coordinates to canvas CSS coordinates.
 */
export function pageToCanvasCoords(
  pageX: number,
  pageY: number,
  fit: ImageFitRect,
): { x: number; y: number } {
  return {
    x: pageX * fit.scale + fit.offsetX,
    y: pageY * fit.scale + fit.offsetY,
  };
}
