import React, { useState, useEffect } from 'react';
import { useControlStore, selectSelectedElement } from '../store/control.store.js';
import { getElements } from '../api/control.adapters.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './DomElementsTable.module.css';

interface DomElement {
  tag: string;
  id?: string;
  class?: string;
  text?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  isVisible?: boolean;
  isInteractable?: boolean;
}

export const DomElementsTable: React.FC = () => {
  const selectedElement = useControlStore(selectSelectedElement);
  const setSelectedElement = useControlStore((s) => s.setSelectedElement);

  const [elements, setElements] = useState<DomElement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchElements = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await getElements('*'); // Fetch all elements or a specific selector
        if (response.success && response.elements) {
          setElements(response.elements);
        } else {
          setError(response.error || 'Failed to fetch elements');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchElements();
  }, []);

  const handleRefresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getElements('*');
      if (response.success && response.elements) {
        setElements(response.elements);
      } else {
        setError(response.error || 'Failed to fetch elements');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRowClick = (element: DomElement) => {
    // Construct a basic selector
    let selector = element.tag;
    if (element.id) {
      selector += `#${element.id}`;
    } else if (element.class) {
      selector += `.${element.class.split(' ').join('.')}`;
    }

    setSelectedElement({
      selector,
      tag: element.tag,
      text: element.text,
      attributes: {
        ...(element.id ? { id: element.id } : {}),
        ...(element.class ? { class: element.class } : {}),
      },
    });
  };

  const isSelected = (element: DomElement) => {
    if (!selectedElement) return false;
    // Simple heuristic for matching
    return selectedElement.tag === element.tag && 
           selectedElement.attributes?.id === element.id &&
           selectedElement.attributes?.class === element.class;
  };

  return (
    <div className={styles.container} data-testid={testIds.domElementsTable}>
      <div className={styles.header}>
        <h3 className={styles.title}>DOM Elements</h3>
        <button 
          type="button"
          className={styles.refreshButton} 
          onClick={handleRefresh}
          disabled={isLoading}
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.tableContainer}>
        {isLoading && elements.length === 0 ? (
          <div className={styles.loading}>Loading elements...</div>
        ) : elements.length === 0 && !error ? (
          <div className={styles.empty}>No elements found</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Tag</th>
                <th className={styles.th}>ID</th>
                <th className={styles.th}>Class</th>
                <th className={styles.th}>Text</th>
                <th className={styles.th}>Visible</th>
                <th className={styles.th}>Interactable</th>
              </tr>
            </thead>
            <tbody>
              {elements.map((element, index) => {
                const uniqueKey = `${element.tag}-${element.id || ''}-${element.class || ''}-${index}`;
                return (
                  <tr 
                    key={uniqueKey} 
                    className={`${styles.tr} ${isSelected(element) ? styles.selected : ''}`}
                    onClick={() => handleRowClick(element)}
                    data-testid={testIds.domTableRow}
                  >
                    <td className={`${styles.td} ${styles.tag}`}>{element.tag}</td>
                    <td className={`${styles.td} ${styles.id}`}>{element.id || '-'}</td>
                    <td className={`${styles.td} ${styles.class}`}>{element.class || '-'}</td>
                    <td className={`${styles.td} ${styles.text}`}>{element.text || '-'}</td>
                    <td className={styles.td}>
                      <span className={`${styles.boolean} ${element.isVisible ? styles.true : styles.false}`}>
                        {element.isVisible ? '✓' : '✗'}
                      </span>
                    </td>
                    <td className={styles.td}>
                      <span className={`${styles.boolean} ${element.isInteractable ? styles.true : styles.false}`}>
                        {element.isInteractable ? '✓' : '✗'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
