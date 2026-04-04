import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatPage from './ChatPage.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('@/features/chat/store/chat.store.js', () => ({
  useChatStore: vi.fn((selector: (s: any) => unknown) =>
    selector({
      streamingState: 'idle',
      activeSessionId: null,
      showThinking: false,
      selectedModel: 'decision',
      addSession: vi.fn(),
      removeSession: vi.fn(),
      setActiveSession: vi.fn(),
      setStreamingState: vi.fn(),
      setShowThinking: vi.fn(),
      setSelectedModel: vi.fn(),
    }),
  ),
  selectShowThinking: (s: any) => s.showThinking,
  selectSelectedModel: (s: any) => s.selectedModel,
  selectStreamingState: (s: any) => s.streamingState,
  selectActiveSessionId: (s: any) => s.activeSessionId,
}));

vi.mock('@/features/chat/components/index.js', () => ({
  SessionSelector: () => <div data-testid={testIds.sessionSelector}>SessionSelector</div>,
  MessageList: () => <div data-testid={testIds.messageList}>MessageList</div>,
  StatusBar: () => <div data-testid={testIds.statusBar}>StatusBar</div>,
  Composer: () => <div data-testid={testIds.composerInput}>Composer</div>,
}));

describe('ChatPage', () => {
  it('renders ChatPage root container', () => {
    render(<ChatPage />);
    expect(screen.getByTestId(testIds.chatPageRoot)).toBeInTheDocument();
  });

  it('renders chat sub-components inside ChatPage', () => {
    render(<ChatPage />);
    expect(screen.getByTestId(testIds.sessionSelector)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.messageList)).toBeInTheDocument();
  });
});
