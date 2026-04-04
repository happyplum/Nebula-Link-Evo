import { useVerifyKeys } from '../api/config.queries.js';
import { LoadingSpinner } from '@/shared/ui/LoadingSpinner.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ApiKeysStatus.module.css';

export function ApiKeysStatus() {
  const { data, isLoading, error } = useVerifyKeys();

  if (isLoading) {
    return (
      <div className={styles.container} data-testid={testIds.configApiKeysStatus}>
        <LoadingSpinner size="md" label="加载密钥状态..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.container} ${styles.error}`} data-testid={testIds.configApiKeysStatus}>
        <p>加载失败: {error.message}</p>
      </div>
    );
  }

  if (!data?.keys?.length) {
    return (
      <div className={styles.container} data-testid={testIds.configApiKeysStatus}>
        <h2 className={styles.title}>API 密钥</h2>
        <p className={styles.empty}>暂无 API 密钥</p>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid={testIds.configApiKeysStatus}>
      <h2 className={styles.title}>API 密钥</h2>
      <ul className={styles.list}>
        {data.keys.map((key) => (
          <li key={key.provider} className={styles.keyItem}>
            <div className={styles.keyHeader}>
              <span className={styles.providerName}>{key.displayName || key.provider}</span>
              <span className={`${styles.statusBadge} ${key.status === 'valid' ? styles.valid : styles.invalid}`}>
                {key.status === 'valid' ? '✓ 有效' : '✗ 无效'}
              </span>
              <span className={styles.keyPreview}>{key.keyPreview}</span>
            </div>
            {key.error && <div className={styles.keyError}>{key.error}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
