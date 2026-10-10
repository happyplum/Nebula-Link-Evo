import type { DomSnapshotElementInfo } from '../api/control.adapters.js';
import type { DomElement } from '../store/control.store.js';

function parseMarkerNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function normalizeDomElements(
  elementsMap: Record<string, DomSnapshotElementInfo>
): DomElement[] {
  return Object.entries(elementsMap).map(([id, info]) => ({
    markerNumber: parseMarkerNumber(info.id) ?? parseMarkerNumber(id),
    tag: info.tag,
    id,
    text: info.text,
    bbox: info.bbox,
    isVisible: true,
    isInteractable: true,
    dataNebulaId: info.id,
    locatorBundle: info.locator_bundle,
  }));
}

export function findDomElementAtPoint(
  elements: DomElement[],
  x: number,
  y: number
): DomElement | null {
  const matches = elements.filter((element) => {
    if (!element.bbox || element.isVisible === false) {
      return false;
    }

    const { bbox } = element;
    return x >= bbox.x && x <= bbox.x + bbox.width && y >= bbox.y && y <= bbox.y + bbox.height;
  });

  if (matches.length === 0) {
    return null;
  }

  return matches.reduce((smallest, current) => {
    const smallestArea = (smallest.bbox?.width ?? Infinity) * (smallest.bbox?.height ?? Infinity);
    const currentArea = (current.bbox?.width ?? Infinity) * (current.bbox?.height ?? Infinity);
    return currentArea < smallestArea ? current : smallest;
  });
}
