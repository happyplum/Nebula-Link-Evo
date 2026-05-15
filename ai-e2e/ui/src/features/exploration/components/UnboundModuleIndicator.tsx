import React from 'react';
import { Card, Button } from '@/shared/components';
import styles from './UnboundModuleIndicator.module.css';

interface UnboundModuleIndicatorProps {
  details: string[];
  onDismiss: () => void;
}

export const UnboundModuleIndicator: React.FC<UnboundModuleIndicatorProps> = ({ details, onDismiss }) => {
  if (!details || details.length === 0) return null;

  return (
    <Card className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>无法进入下一阶段</h3>
        <p className={styles.subtitle}>以下功能模块尚未绑定 URL，请先完成绑定：</p>
      </div>
      <ul className={styles.list}>
        {details.map((detail, index) => {
          // Extract FM name if it matches 'FM "Name" has no URL binding'
          const match = detail.match(/FM "([^"]+)"/);
          const name = match ? match[1] : detail;
          return (
            <li key={index} className={styles.listItem}>
              <span className={styles.bullet}>•</span>
              <span className={styles.moduleName}>{name}</span>
            </li>
          );
        })}
      </ul>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onDismiss}>
          我知道了
        </Button>
      </div>
    </Card>
  );
};
