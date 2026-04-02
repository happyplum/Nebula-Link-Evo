import styles from './LoadingSpinner.module.css';

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export function LoadingSpinner({ size = 'md', label }: LoadingSpinnerProps) {
  return (
    <div 
      className={`${styles.spinner} ${styles[size]}`} 
      role="status"
      data-testid="loading-spinner"
    >
      {label && <span className={styles.srOnly}>{label}</span>}
    </div>
  );
}
