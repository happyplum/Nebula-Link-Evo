import { useConfig } from '../api/config.queries.js';
import { LoadingSpinner } from '@/shared/ui/LoadingSpinner.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ConfigPanel.module.css';

export function ConfigPanel() {
  const { data: config, isLoading, error } = useConfig();

  if (isLoading) {
    return (
      <div className={styles.container} data-testid={testIds.configPanel}>
        <LoadingSpinner size="md" label="加载配置中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.container} ${styles.error}`} data-testid={testIds.configPanel}>
        <p>配置加载失败</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className={styles.container} data-testid={testIds.configPanel}>
        <p className={styles.empty}>暂无配置数据</p>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid={testIds.configPanel}>
      <h2 className={styles.title}>系统配置</h2>

      <div className={styles.grid}>
        <div className={styles.item}>
          <span className={styles.label}>模式</span>
          <span className={styles.value}>{config.mode || '未知'}</span>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>决策模型</h3>
        <div className={styles.groupBody}>
          <div className={styles.item}>
            <span className={styles.label}>提供商</span>
            <span className={styles.value}>{config.decision?.provider || '未配置'}</span>
          </div>
          <div className={styles.item}>
            <span className={styles.label}>模型</span>
            <span className={styles.value}>{config.decision?.model || '未配置'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
