import React from 'react';
import { DiscoveredURL } from '../store/explorationApi';
import styles from './PagePreview.module.css';

interface PagePreviewProps {
  url: DiscoveredURL | null;
}

export const PagePreview: React.FC<PagePreviewProps> = ({ url }) => {
  if (!url) {
    return (
      <div className={styles.container}>
        <div className={styles.previewArea}>
          <div className={styles.empty}>请选择左侧 URL 查看预览</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>{url.title || '未知标题'}</div>
        <div className={styles.url}>{url.url}</div>
      </div>
      <div className={styles.previewArea}>
        {url.screenshot_path ? (
          <img 
            src={`/api/files/${url.screenshot_path}`} 
            alt={`Screenshot of ${url.url}`}
            className={styles.image}
          />
        ) : (
          <div className={styles.empty}>暂无截图</div>
        )}
      </div>
    </div>
  );
};
