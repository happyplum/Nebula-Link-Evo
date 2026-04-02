import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import ChatPage from './ChatPage.js';
import { testIds } from '@/shared/testing/testids.js';

// Mock ChatPanel to simplify layout testing and avoid infinite loop
vi.mock('@/features/chat/components/index.js', () => ({
  ChatPanel: () => <div data-testid={testIds.chatPanel}>Mock ChatPanel</div>,
}));

describe('ChatPage Layout', () => {
  it('renders with CSS Module class on root container', () => {
    const { container } = render(<ChatPage />);
    const rootElement = container.firstElementChild;
    
    expect(rootElement).toBeInTheDocument();
    // CSS Modules hash class names, so check if the class name contains 'fullPage'
    const className = rootElement?.className || '';
    expect(className).toMatch(/fullPage/);
  });

  it('renders root container with data-testid', () => {
    const { container } = render(<ChatPage />);
    const rootElement = container.firstElementChild;
    
    expect(rootElement).toBeInTheDocument();
    expect(rootElement).toHaveAttribute('data-testid', testIds.chatPageRoot);
  });
});
