import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatPage from './ChatPage.js';
import { testIds } from '@/shared/testing/testids.js';

// Mock ChatPanel to avoid infinite loop error in test environment
vi.mock('@/features/chat/components/index.js', () => ({
  ChatPanel: () => <div data-testid={testIds.chatPanel}>Mock ChatPanel</div>,
}));

describe('ChatPage', () => {
  it('renders ChatPage root container', () => {
    render(<ChatPage />);
    expect(screen.getByTestId(testIds.chatPageRoot)).toBeInTheDocument();
  });

  it('renders ChatPanel inside ChatPage', () => {
    render(<ChatPage />);
    expect(screen.getByTestId(testIds.chatPanel)).toBeInTheDocument();
  });
});
