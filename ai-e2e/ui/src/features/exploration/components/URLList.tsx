import React from 'react';
import { DiscoveredURL } from '../store/explorationApi';
import { Button } from '@/shared/components';
import styles from './URLList.module.css';

interface URLListProps {
  urls: DiscoveredURL[];
  selectedUrlId?: string;
  onSelectUrl: (url: DiscoveredURL) => void;
  onAddManualUrl: () => void;
}

export const URLList: React.FC<URLListProps> = ({
  urls,
  selectedUrlId,
  onSelectUrl,
  onAddManualUrl,
}) => {
  const getStatusClass = (status: string) => {
    switch (status) {
      case 'explored': return styles.statusExplored;
      case 'failed': return styles.statusFailed;
      default: return styles.statusPending;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'explored': return '已探索';
      case 'failed': return '失败';
      default: return '待探索';
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>发现的 URL ({urls.length})</div>
        <Button variant="ghost" size="sm" onClick={onAddManualUrl}>
          + 手动添加
        </Button>
      </div>
      
      <div className={styles.list}>
        {urls.length === 0 ? (
          <div className={styles.empty}>暂无发现的 URL</div>
        ) : (
          urls.map((url) => (
            <div
              key={url.id}
              className={`${styles.item} ${selectedUrlId === url.id ? styles.itemSelected : ''}`}
              onClick={() => onSelectUrl(url)}
            >
              <div className={styles.itemTitle} title={url.title || url.url}>
                {url.title || '未知标题'}
              </div>
              <div className={styles.itemUrl} title={url.url}>
                {url.url}
              </div>
              <div className={`${styles.itemStatus} ${getStatusClass(url.status)}`}>
                {getStatusText(url.status)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
