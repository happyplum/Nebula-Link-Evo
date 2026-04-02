import { type ReactNode } from 'react';
import styles from './Accordion.module.css';

export interface AccordionProps {
  /** Whether the accordion is expanded (controlled). */
  open: boolean;
  /** Called when the header is clicked — parent toggles `open`. */
  onToggle: () => void;
  /** Header label. */
  title: string;
  /** Optional icon rendered before the title. */
  icon?: ReactNode;
  /** Content shown when expanded. */
  children: ReactNode;
  /** Extra class applied to the root element. */
  className?: string;
  /** Optional data-testid prefix. Defaults to `"accordion"`. */
  testId?: string;
}

export function Accordion({
  open,
  onToggle,
  title,
  icon,
  children,
  className,
  testId = 'accordion',
}: AccordionProps) {
  const rootClass = `${styles.accordion} ${open ? styles.open : ''} ${className ?? ''}`.trim();

  return (
    <div className={rootClass} data-testid={testId}>
      <button
        type="button"
        className={styles.header}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${testId}-content`}
        data-testid={`${testId}-header`}
      >
        <span className={styles.title}>
          {icon}
          {title}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>Chevron</title>
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
      </button>

      <section
        className={styles.contentWrapper}
        id={`${testId}-content`}
        aria-labelledby={`${testId}-header`}
      >
        <div className={styles.content}>
          <div className={styles.contentInner}>{children}</div>
        </div>
      </section>
    </div>
  );
}
