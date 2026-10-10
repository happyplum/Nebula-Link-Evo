import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImagePreviewModal } from '../ImagePreviewModal.js';

describe('ImagePreviewModal Parity Test', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    src: 'https://example.com/test.jpg',
    alt: 'Test Image',
    title: 'Preview',
  };

  it('renders nothing when open=false', () => {
    render(<ImagePreviewModal open={false} onClose={() => {}} src="test.jpg" />);

    expect(screen.queryByTestId('image-preview-modal')).not.toBeInTheDocument();
  });

  it('renders modal with image when open=true', () => {
    render(<ImagePreviewModal {...defaultProps} />);

    expect(screen.getByTestId('image-preview-modal')).toBeInTheDocument();
    expect(screen.getByTestId('image-preview-img')).toBeInTheDocument();
  });

  it('image src and alt props are passed correctly', () => {
    render(
      <ImagePreviewModal
        open={true}
        onClose={() => {}}
        src="https://example.com/my-image.jpg"
        alt="My Custom Alt Text"
      />
    );

    const img = screen.getByTestId('image-preview-img') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe('https://example.com/my-image.jpg');
    expect(img.alt).toBe('My Custom Alt Text');
  });

  it('alt defaults to Preview when not provided', () => {
    render(<ImagePreviewModal open={true} onClose={() => {}} src="test.jpg" />);

    const img = screen.getByTestId('image-preview-img') as HTMLImageElement;
    expect(img.alt).toBe('Preview');
  });

  it('title prop does not render visible text in lightbox mode', () => {
    render(<ImagePreviewModal {...defaultProps} title="Image Preview" />);

    expect(screen.queryByText('Image Preview')).not.toBeInTheDocument();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<ImagePreviewModal open={true} onClose={onClose} src="test.jpg" />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(<ImagePreviewModal open={true} onClose={onClose} src="test.jpg" />);

    const overlay = screen.getByTestId('image-preview-overlay');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when image container is clicked', () => {
    const onClose = vi.fn();
    render(<ImagePreviewModal open={true} onClose={onClose} src="test.jpg" />);

    const container = screen.getByTestId('image-preview-modal');
    fireEvent.click(container);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('data-testid="image-preview-modal" on container', () => {
    render(<ImagePreviewModal {...defaultProps} />);

    const container = screen.getByTestId('image-preview-modal');
    expect(container).toBeInTheDocument();
    expect(container.tagName).toBe('DIV');
  });

  it('data-testid="image-preview-img" on img element', () => {
    render(<ImagePreviewModal {...defaultProps} />);

    const img = screen.getByTestId('image-preview-img');
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe('IMG');
  });
});
