import React from 'react';
import { ProjectFailureDistributionItem } from '@/types/report';
import { Card } from '@/shared/components';
import styles from './ReportPanel.module.css';

interface FailureDistributionProps {
  distribution: ProjectFailureDistributionItem[];
}

const typeLabels: Record<string, string> = {
  selector: '选择器失效',
  timing: '等待超时',
  assertion: '断言失败',
  environment: '环境异常',
  data: '数据异常',
  unknown: '未知错误',
};

export const FailureDistribution: React.FC<FailureDistributionProps> = ({ distribution }) => {
  if (!distribution || distribution.length === 0) {
    return (
      <Card title="失败类型分布">
        <div className={styles.emptyState}>暂无失败数据</div>
      </Card>
    );
  }

  const total = distribution.reduce((sum, item) => sum + item.count, 0);

  return (
    <Card title="失败类型分布">
      <div className={styles.distributionList}>
        {distribution.map((item) => {
          const percentage = total > 0 ? Math.round((item.count / total) * 100) : 0;
          return (
            <div key={item.type} className={styles.distributionItem}>
              <div className={styles.distributionHeader}>
                <span className={styles.distributionLabel}>{typeLabels[item.type] || item.type}</span>
                <span className={styles.distributionCount}>{item.count} 次 ({percentage}%)</span>
              </div>
              <div className={styles.progressBarContainer}>
                <div 
                  className={styles.progressBar} 
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};
