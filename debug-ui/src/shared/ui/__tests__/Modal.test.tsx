import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Modal } from '../Modal.js';
import { testIds } from '../../testing/testids.js';

describe('Modal', () => {
  it('renders nothing when open is false', () => {
    render(
      <Modal open={false} onClose={() => {}}>
        <div>Modal Content</div>
      </Modal>
    );
    expect(screen.queryByTestId(testIds.modalOverlay)).not.toBeInTheDocument();
  });

  it('renders content when open is true', () => {
    render(
      <Modal open={true} onClose={() => {}} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );
    expect(screen.getByTestId(testIds.modalOverlay)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.modalContent)).toBeInTheDocument();
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('Modal Content')).toBeInTheDocument();
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <div>Modal Content</div>
      </Modal>
    );
    
    fireEvent.click(screen.getByTestId(testIds.modalOverlay));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when content is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <div>Modal Content</div>
      </Modal>
    );
    
    fireEvent.click(screen.getByTestId(testIds.modalContent));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <div>Modal Content</div>
      </Modal>
    );
    
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
