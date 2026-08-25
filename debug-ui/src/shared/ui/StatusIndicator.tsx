import styles from './StatusIndicator.module.css';

export interface StatusIndicatorProps {
  status: 'online' | 'offline' | 'loading' | 'error';
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function StatusIndicator({ status, label, size = 'md' }: StatusIndicatorProps) {
  return (
    <div className={styles.container} data-testid="status-indicator">
      <div className={`${styles.dot} ${styles[status]} ${styles[size]}`} aria-hidden="true" />
      {label && <span className={styles.label}>{label}</span>}
    </div>
  );
}
