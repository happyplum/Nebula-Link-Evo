import { useHealth } from '../api/config.queries.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { LoadingSpinner } from '@/shared/ui/LoadingSpinner.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './HealthStatusCard.module.css';

export function HealthStatusCard() {
  const { data: health, isLoading, error } = useHealth();

  if (isLoading) {
    return (
      <div className={styles.container} data-testid={testIds.healthStatusCard}>
        <LoadingSpinner size="md" label="Loading health status..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.container} ${styles.error}`} data-testid={testIds.healthStatusCard}>
        <p>Failed to load health status</p>
      </div>
    );
  }

  if (!health) {
    return (
      <div className={styles.container} data-testid={testIds.healthStatusCard}>
        <p className={styles.empty}>No health data available</p>
      </div>
    );
  }

  const isHealthy = health.status === 'ok';

  return (
    <div className={styles.container} data-testid={testIds.healthStatusCard}>
      <div className={styles.header}>
        <h2 className={styles.title}>服务状态</h2>
        <StatusIndicator 
          status={isHealthy ? 'online' : 'error'} 
          label={isHealthy ? '正常' : '异常'} 
        />
      </div>
      
      <div className={styles.grid}>
        <div className={styles.item}>
          <span className={styles.label}>playwright</span>
          <div className={styles.valueRow}>
            <StatusIndicator 
              status={health.services.playwright === 'ok' ? 'online' : 'error'} 
              size="sm"
            />
            <span className={styles.value}>
              {health.services.playwright === 'ok' ? '已连接' : '未连接'}
            </span>
          </div>
        </div>
        
        <div className={styles.item}>
          <span className={styles.label}>MCP 状态</span>
          <div className={styles.valueRow}>
            <StatusIndicator 
              status={health.mcp.enabled ? 'online' : 'offline'} 
              size="sm"
            />
            <span className={styles.value}>
              {health.mcp.enabled ? `${health.mcp.servers.length} servers` : 'Disabled'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
