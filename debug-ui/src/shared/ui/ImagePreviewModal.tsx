import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './ImagePreviewModal.module.css';

export interface ImagePreviewModalProps {
  open: boolean;
  onClose: () => void;
  src: string;
  alt?: string;
}

export function ImagePreviewModal({ open, onClose, src, alt }: ImagePreviewModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  return createPortal(
    <div
      className={styles.overlay}
      ref={overlayRef}
      onClick={handleOverlayClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClose();
      }}
      role="dialog"
      aria-modal="true"
      data-testid="image-preview-overlay"
    >
      <button
        type="button"
        className={styles.closeBtn}
        onClick={onClose}
        aria-label="Close preview"
        data-testid="image-preview-close"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <title>Close</title>
          <line x1="15" y1="5" x2="5" y2="15" />
          <line x1="5" y1="5" x2="15" y2="15" />
        </svg>
      </button>
      <div className={styles.container} data-testid="image-preview-modal">
        <img
          className={styles.image}
          src={src}
          alt={alt ?? 'Preview'}
          data-testid="image-preview-img"
        />
      </div>
    </div>,
    document.body
  );
}
