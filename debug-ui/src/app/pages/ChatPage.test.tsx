import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatPage from './ChatPage.js';
import { testIds } from '@/shared/testing/testids.js';
import { useChatStore } from '@/features/chat/store/chat.store.js';
import { useChatStream } from '@/features/chat/hooks/useChatStream.js';

vi.mock('@/features/config/api/config.queries.js', () => ({
  useConfig: () => ({ data: { decision: { provider: 'glm', model: 'glm-4.6v-flash' } } }),
}));

vi.mock('@/shared/query/hooks.js', () => ({
  useSessions: vi.fn(() => ({ data: { sessions: [] }, isFetching: false })),
}));

vi.mock('@/features/chat/hooks/useChatStream.js', () => ({
  useChatStream: vi.fn(),
}));

vi.mock('@/shared/query/query-client.js', () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/features/chat/store/chat.store.js', () => ({
  useChatStore: vi.fn((selector: (s: any) => unknown) =>
    selector({
      streamingState: 'idle',
      activeSessionId: null,
      showThinking: false,
      addSession: vi.fn(),
      removeSession: vi.fn(),
      setActiveSession: vi.fn(),
      setStreamingState: vi.fn(),
      setShowThinking: vi.fn(),
      updateSession: vi.fn(),
      setSessions: vi.fn(),
      setMessages: vi.fn(),
      setIsLoadingSessions: vi.fn(),
      setIsLoadingMessages: vi.fn(),
      pendingJobs: {},
    })
  ),
  selectShowThinking: (s: any) => s.showThinking,
  selectStreamingState: (s: any) => s.streamingState,
  selectActiveSessionId: (s: any) => s.activeSessionId,
}));

vi.mock('@/features/chat/components/index.js', () => ({
  SessionSelector: () => <div data-testid={testIds.sessionSelector}>SessionSelector</div>,
  MessageList: () => <div data-testid={testIds.messageList}>MessageList</div>,
  Composer: () => <div data-testid={testIds.composerInput}>Composer</div>,
  QueueFloatingPanel: () => null,
}));

describe('ChatPage', () => {
  it('uses SSE stream as the only history and live source', () => {
    const originalEventSource = globalThis.EventSource;
    const originalGetState = (useChatStore as unknown as { getState?: unknown }).getState;
    const EventSourceCtor = function () {} as unknown as typeof EventSource;
    Object.assign(EventSourceCtor, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
    vi.stubGlobal('EventSource', EventSourceCtor);
    (useChatStore as unknown as { getState: () => Record<string, never> }).getState = () => ({});

    vi.mocked(useChatStore).mockImplementation((selector: (s: any) => unknown) =>
      selector({
        streamingState: 'idle',
        activeSessionId: 'sess-1',
        showThinking: false,
        addSession: vi.fn(),
        removeSession: vi.fn(),
        setActiveSession: vi.fn(),
        setStreamingState: vi.fn(),
        setShowThinking: vi.fn(),
        updateSession: vi.fn(),
        setSessions: vi.fn(),
        setMessages: vi.fn(),
        setIsLoadingSessions: vi.fn(),
        setIsLoadingMessages: vi.fn(),
        pendingJobs: {},
      })
    );

    render(<ChatPage />);

    expect(vi.mocked(useChatStream)).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        enabled: true,
      })
    );

    if (originalEventSource) {
      vi.stubGlobal('EventSource', originalEventSource);
    } else {
      vi.unstubAllGlobals();
    }

    if (typeof originalGetState === 'function') {
      (useChatStore as unknown as { getState: () => unknown }).getState =
        originalGetState as () => unknown;
    } else {
      delete (useChatStore as unknown as { getState?: unknown }).getState;
    }
  });

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
