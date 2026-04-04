import React from 'react';
import { useControlStore, selectSelectedElement } from '../store/control.store.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './SelectedElementCard.module.css';

export const SelectedElementCard: React.FC = () => {
  const selectedElement = useControlStore(selectSelectedElement);

  if (!selectedElement) {
    return (
      <div className={styles.container} data-testid={testIds.selectedElementCard}>
        <div className={styles.header}>
          <h3 className={styles.title}>Selected Element</h3>
        </div>
        <div className={styles.empty}>No element selected</div>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid={testIds.selectedElementCard}>
      <div className={styles.header}>
        <h3 className={styles.title}>Selected Element</h3>
        <span className={styles.tag}>{selectedElement.tag}</span>
      </div>
      
      <div className={styles.content}>
        {selectedElement.markerNumber !== undefined && (
          <div className={styles.row}>
            <span className={styles.label}>Marker</span>
            <span className={styles.value}>#{selectedElement.markerNumber}</span>
          </div>
        )}

        <div className={styles.row}>
          <span className={styles.label}>Selector</span>
          <span className={styles.value}>{selectedElement.selector}</span>
        </div>

        {selectedElement.dataNebulaId && (
          <div className={styles.row}>
            <span className={styles.label}>data-nebula-id</span>
            <span className={styles.value}>{selectedElement.dataNebulaId}</span>
          </div>
        )}
        
        {selectedElement.text && (
          <div className={styles.row}>
            <span className={styles.label}>Text</span>
            <span className={styles.value}>{selectedElement.text}</span>
          </div>
        )}

        {selectedElement.bbox && (
          <div className={styles.row}>
            <span className={styles.label}>BBox</span>
            <span className={styles.value}>
              x={selectedElement.bbox.x}, y={selectedElement.bbox.y}, 
              w={selectedElement.bbox.width}, h={selectedElement.bbox.height}
            </span>
          </div>
        )}
        
        {selectedElement.attributes && Object.keys(selectedElement.attributes).length > 0 && (
          <div className={styles.row}>
            <span className={styles.label}>Attributes</span>
            <div className={styles.attributes}>
              {Object.entries(selectedElement.attributes).map(([key, value]) => (
                <div key={key} className={styles.attribute}>
                  <span className={styles.attrName}>{key}=</span>
                  <span className={styles.attrValue}>&quot;{value}&quot;</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
