import { useConfig } from '../api/config.queries.js';
import { LoadingSpinner } from '@/shared/ui/LoadingSpinner.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ConfigPanel.module.css';

export function ConfigPanel() {
  const { data: config, isLoading, error } = useConfig();

  if (isLoading) {
    return (
      <div className={styles.container} data-testid={testIds.configPanel}>
        <LoadingSpinner size="md" label="Loading config..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.container} ${styles.error}`} data-testid={testIds.configPanel}>
        <p>Failed to load configuration</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className={styles.container} data-testid={testIds.configPanel}>
        <p className={styles.empty}>No configuration available</p>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid={testIds.configPanel}>
      <h2 className={styles.title}>System Configuration</h2>
      
      <div className={styles.grid}>
        <div className={styles.item}>
          <span className={styles.label}>Mode</span>
          <span className={styles.value}>{config.mode || 'Unknown'}</span>
        </div>
        
        <div className={styles.item}>
          <span className={styles.label}>Vision Model</span>
          <span className={styles.value}>
            {config.vision ? `${config.vision.provider} / ${config.vision.model}` : 'Not configured'}
          </span>
        </div>
        
        <div className={styles.item}>
          <span className={styles.label}>Decision Model</span>
          <span className={styles.value}>
            {config.decision ? `${config.decision.provider} / ${config.decision.model}` : 'Not configured'}
          </span>
        </div>
      </div>
    </div>
  );
}
