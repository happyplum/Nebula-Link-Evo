import React, { useState } from 'react';
import {
  useControlStore,
  selectSelectedElement,
  selectMarkerToggle,
  selectDomElements,
  type DomElement,
} from '../store/control.store.js';
import { fetchDomSnapshot, type DomSnapshotElementInfo } from '../api/control.adapters.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './DomElementsTable.module.css';

/** Normalize elements_map from array or record format into DomElement[] */
function normalizeElements(
  elementsMap: [number, DomSnapshotElementInfo][] | Record<string, DomSnapshotElementInfo>,
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

  return Object.entries(elementsMap).map(([id, info], index) => ({
    markerNumber: index + 1,
    tag: info.tag,
    id,
    text: info.text,
    bbox: info.bbox,
    isVisible: info.isVisible ?? true,
    isInteractable: info.isInteractable ?? true,
    dataNebulaId: id,
    locatorBundle: info.locatorBundle,
  }));
}

export const DomElementsTable: React.FC = () => {
  const selectedElement = useControlStore(selectSelectedElement);
  const setSelectedElement = useControlStore((s) => s.setSelectedElement);
  const setHighlightedElementId = useControlStore((s) => s.setHighlightedElementId);
  const markerToggle = useControlStore(selectMarkerToggle);
  const setMarkerToggle = useControlStore((s) => s.setMarkerToggle);
  const setSnapshotId = useControlStore((s) => s.setSnapshotId);
  const setDomElements = useControlStore((s) => s.setDomElements);
  const domElements = useControlStore(selectDomElements);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFetchDom = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchDomSnapshot();
      if (response.success && response.dom) {
        const { elements_map, snapshot_id } = response.dom;

        if (snapshot_id) {
          setSnapshotId(snapshot_id);
        }

        if (elements_map) {
          const normalized = normalizeElements(elements_map);
          setDomElements(normalized);
        }
      } else {
        setError(response.error ?? '获取 DOM 失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkerToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMarkerToggle(e.target.checked);
  };

  const handleRowClick = (el: DomElement) => {
    setSelectedElement({
      selector: el.dataNebulaId ? `[data-nebula-id="${el.dataNebulaId}"]` : el.tag,
      tag: el.tag,
      text: el.text,
      attributes: {
        ...(el.id ? { id: el.id } : {}),
        ...(el.dataNebulaId ? { 'data-nebula-id': el.dataNebulaId } : {}),
      },
      markerNumber: el.markerNumber,
      bbox: el.bbox,
      dataNebulaId: el.dataNebulaId,
    });
    setHighlightedElementId(el.dataNebulaId ?? String(el.markerNumber));
  };

  const isSelected = (el: DomElement) => {
    if (!selectedElement?.markerNumber) return false;
    return selectedElement.markerNumber === el.markerNumber;
  };

  return (
    <div className={styles.container} data-testid={testIds.domElementsTable}>
      <div className={styles.toolbar}>
        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={markerToggle}
            onChange={handleMarkerToggle}
            className={styles.toggleCheckbox}
            data-testid={testIds.domElementsMarkerToggle}
          />
          <span>实时画面显示序号</span>
        </label>
        <button
          type="button"
          className={styles.fetchButton}
          onClick={handleFetchDom}
          disabled={isLoading}
          data-testid={testIds.domElementsGetDomBtn}
        >
          {isLoading ? '获取中...' : '获取 DOM'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.tableContainer} data-testid={testIds.domElementsContainer}>
        {domElements.length === 0 ? (
          <div className={styles.empty} data-testid={testIds.domElementsEmptyState}>
            点击&quot;获取 DOM&quot;加载元素映射
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>#</th>
                <th className={styles.th}>Tag</th>
                <th className={styles.th}>ID</th>
                <th className={styles.th}>Text</th>
                <th className={styles.th}>BBox</th>
                <th className={styles.th}>Vis</th>
              </tr>
            </thead>
            <tbody>
              {domElements.map((el) => (
                <tr
                  key={`el-${el.markerNumber}`}
                  className={`${styles.tr} ${isSelected(el) ? styles.selected : ''}`}
                  onClick={() => handleRowClick(el)}
                  data-testid={testIds.domTableRow}
                >
                  <td className={`${styles.td} ${styles.marker}`}>{el.markerNumber}</td>
                  <td className={`${styles.td} ${styles.tagCell}`}>
                    <code>{el.tag}</code>
                  </td>
                  <td className={`${styles.td} ${styles.idCell}`}>{el.id ?? '-'}</td>
                  <td className={styles.td}>{el.text ? el.text.substring(0, 20) : '-'}</td>
                  <td className={`${styles.td} ${styles.bboxCell}`}>
                    {el.bbox ? `(${el.bbox.x}, ${el.bbox.y})` : '-'}
                  </td>
                  <td className={styles.td}>
                    <span className={`${styles.boolean} ${el.isVisible ? styles.boolTrue : styles.boolFalse}`}>
                      {el.isVisible ? '✓' : '✗'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
