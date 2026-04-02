import { type ReactNode } from 'react';
import { Modal } from './Modal.js';
import styles from './ImagePreviewModal.module.css';

export interface ImagePreviewModalProps {
  open: boolean;
  onClose: () => void;
  src: string;
  alt?: string;
  title?: string;
}

export function ImagePreviewModal({ open, onClose, src, alt, title }: ImagePreviewModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className={styles.container} data-testid="image-preview-modal">
        <img
          className={styles.image}
          src={src}
          alt={alt ?? 'Preview'}
          data-testid="image-preview-img"
        />
      </div>
    </Modal>
  );
}
