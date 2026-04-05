import type { DomSnapshotElementInfo } from '../api/control.adapters.js';
import type { DomElement } from '../store/control.store.js';

type DomSnapshotElementInfoV2 = DomSnapshotElementInfo & {
  id?: string;
  locator_bundle?: Record<string, string>;
};

function parseMarkerNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function normalizeDomElements(
  elementsMap: [number, DomSnapshotElementInfo][] | Record<string, DomSnapshotElementInfo>
): DomElement[] {
  if (Array.isArray(elementsMap)) {
    return elementsMap.map(([markerNumber, info]) => ({
      markerNumber,
      tag: info.tag,
      id: info['data-nebula-id'],
      text: info.text,
      bbox: info.bbox,
      isVisible: info.isVisible,
      isInteractable: info.isInteractable,
      dataNebulaId: info['data-nebula-id'],
      locatorBundle: info.locatorBundle,
    }));
  }

  return Object.entries(elementsMap).map(([id, info]) => ({
    markerNumber: parseMarkerNumber(info['data-nebula-id']) ?? parseMarkerNumber(id),
    tag: info.tag,
    id,
    text: info.text,
    bbox: info.bbox,
    isVisible: info.isVisible ?? true,
    isInteractable: info.isInteractable ?? true,
    dataNebulaId: info['data-nebula-id'] ?? (info as DomSnapshotElementInfoV2).id ?? id,
    locatorBundle: info.locatorBundle ?? (info as DomSnapshotElementInfoV2).locator_bundle,
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
