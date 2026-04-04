import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatPanel } from '../ChatPanel.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../SessionSelector.js', () => ({
  SessionSelector: () => <div data-testid={testIds.sessionSelector} />,
}));

vi.mock('../MessageList.js', () => ({
  MessageList: () => <div data-testid={testIds.messageList} />,
}));

vi.mock('../StatusBar.js', () => ({
  StatusBar: () => <div data-testid={testIds.statusBar} />,
}));

vi.mock('../Composer.js', () => ({
  Composer: () => <input data-testid={testIds.composerInput} />,
}));

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all sub-components', () => {
    render(<ChatPanel />);
    
    expect(screen.getByTestId(testIds.chatPanel)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.sessionSelector)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.messageList)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.statusBar)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.composerInput)).toBeInTheDocument();
  });
});
