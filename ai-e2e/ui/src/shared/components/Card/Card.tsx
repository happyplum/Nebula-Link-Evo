import React from 'react';
import styles from './Card.module.css';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  noPadding?: boolean;
}

export const Card: React.FC<CardProps> = ({
  title,
  actions,
  children,
  noPadding = false,
  className = '',
  ...props
}) => {
  const cardClass = [styles.card, className].filter(Boolean).join(' ');
  const bodyClass = [styles.body, noPadding ? styles.noPadding : ''].filter(Boolean).join(' ');

  return (
    <div className={cardClass} {...props}>
      {(title || actions) && (
        <div className={styles.header}>
          {title && <div className={styles.title}>{title}</div>}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>
        {children}
      </div>
    </div>
  );
};
