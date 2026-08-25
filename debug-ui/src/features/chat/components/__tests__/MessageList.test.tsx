import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from '../MessageList.js';
import { useChatStore } from '../../store/chat.store.js';
import { testIds } from '@/shared/testing/testids.js';
import { mustExist } from '@/test-support/must-exist.js';

type ChatState = ReturnType<typeof useChatStore.getState>;
type StoreMock = {
  mockImplementation: (
    implementation: (selector: (state: Record<string, unknown>) => unknown) => unknown
  ) => void;
};
const storeMock = useChatStore as unknown as StoreMock;

vi.mock('../../store/chat.store.js', () => ({
  useChatStore: vi.fn(),
  selectActiveMessages: (s: ChatState) =>
    s.activeSessionId ? s.messagesBySession[s.activeSessionId] || [] : [],
  selectActiveSessionId: (s: ChatState) => s.activeSessionId,
  selectStreamingState: (s: ChatState) => s.streamingState,
  selectStreamingContent: (s: ChatState) => s.streamingContent,
  selectStreamingThinking: (s: ChatState) => s.streamingThinking,
  selectStreamingToolCalls: (s: ChatState) => s.streamingToolCalls ?? [],
  selectShowThinking: (s: ChatState) => s.showThinking,
}));

// Mock HTMLDialogElement methods not available in jsdom
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

describe('MessageList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no messages', () => {
    storeMock.mockImplementation((selector) =>
      selector({
        activeSessionId: 'session-1',
        showThinking: false,
        streamingState: 'idle',
        streamingContent: '',
        streamingThinking: '',
        streamingToolCalls: [],
        messagesBySession: { 'session-1': [] },
        visibleMessageCounts: {},
        expandVisibleMessages: vi.fn(),
      })
    );

    render(<MessageList />);

    expect(screen.getByTestId(testIds.messageList)).toBeInTheDocument();
    expect(screen.getByText('No messages yet. Start a conversation!')).toBeInTheDocument();
  });

  it('renders messages when present', () => {
    const messages = [
      { id: '1', role: 'user', content: 'Hello' },
      { id: '2', role: 'assistant', content: 'Hi there' },
    ];

    storeMock.mockImplementation((selector) =>
      selector({
        activeSessionId: 'session-1',
        showThinking: false,
        streamingState: 'idle',
        streamingContent: '',
        streamingThinking: '',
        streamingToolCalls: [],
        messagesBySession: { 'session-1': messages },
        visibleMessageCounts: { 'session-1': 50 },
        expandVisibleMessages: vi.fn(),
      })
    );

    render(<MessageList />);

    expect(screen.getByTestId(testIds.messageList)).toBeInTheDocument();
    expect(screen.getAllByTestId(testIds.messageBubble)).toHaveLength(2);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  it('renders streaming assistant thinking even when there are no persisted messages yet', () => {
    storeMock.mockImplementation((selector) =>
      selector({
        activeSessionId: 'session-1',
        showThinking: true,
        streamingState: 'streaming',
        streamingContent: '',
        streamingThinking: 'Analyzing next step...',
        streamingToolCalls: [],
        messagesBySession: { 'session-1': [] },
        visibleMessageCounts: {},
        expandVisibleMessages: vi.fn(),
      })
    );

    render(<MessageList />);

    expect(screen.queryByText('No messages yet. Start a conversation!')).not.toBeInTheDocument();
    expect(screen.getByTestId(testIds.thinkingBlock)).toBeInTheDocument();
    expect(screen.getByText('💭 思考中...')).toBeInTheDocument();
  });

  it('does not render MessageBubble for tool-only assistant messages (no content, no thinking, no screenshot)', () => {
    const toolOnlyMessage = {
      id: 'msg-toolonly',
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'screenshot', arguments: '{}', status: 'completed' }],
    };

    storeMock.mockImplementation((selector) =>
      selector({
        activeSessionId: 'session-1',
        showThinking: false,
        streamingState: 'idle',
        streamingContent: '',
        streamingThinking: '',
        streamingToolCalls: [],
        messagesBySession: { 'session-1': [toolOnlyMessage] },
        visibleMessageCounts: { 'session-1': 50 },
        expandVisibleMessages: vi.fn(),
      })
    );

    const { container } = render(<MessageList />);

    // No MessageBubble for the tool-only message
    expect(screen.queryByTestId(testIds.messageBubble)).not.toBeInTheDocument();
    // ToolCallCard should still render (it has the tool name as text in a <code> element)
    expect(container.querySelector('[class*="card"]')).toBeTruthy();
  });

  it('renders MessageBubble for assistant message with content even when it has tool calls', () => {
    const messageWithContentAndTools = {
      id: 'msg-mixed',
      role: 'assistant',
      content: 'I will take a screenshot now.',
      toolCalls: [{ id: 'tc-1', name: 'screenshot', arguments: '{}', status: 'completed' }],
    };

    storeMock.mockImplementation((selector) =>
      selector({
        activeSessionId: 'session-1',
        showThinking: false,
        streamingState: 'idle',
        streamingContent: '',
        streamingThinking: '',
        streamingToolCalls: [],
        messagesBySession: { 'session-1': [messageWithContentAndTools] },
        visibleMessageCounts: { 'session-1': 50 },
        expandVisibleMessages: vi.fn(),
      })
    );

    render(<MessageList />);

    // MessageBubble renders because there IS content
    expect(screen.getByTestId(testIds.messageBubble)).toBeInTheDocument();
    expect(screen.getByText('I will take a screenshot now.')).toBeInTheDocument();
  });

  it('uses message.id-namespaced keys for tool call cards to prevent key collisions', () => {
    // Two different messages with tool calls sharing the same tc.id
    const messages = [
      {
        id: 'msg-A',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'shared-tc', name: 'click', arguments: '{}', status: 'completed' }],
      },
      {
        id: 'msg-B',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'shared-tc', name: 'click', arguments: '{}', status: 'completed' }],
      },
    ];

    storeMock.mockImplementation((selector) =>
      selector({
        activeSessionId: 'session-1',
        showThinking: false,
        streamingState: 'idle',
        streamingContent: '',
        streamingThinking: '',
        streamingToolCalls: [],
        messagesBySession: { 'session-1': messages },
        visibleMessageCounts: { 'session-1': 50 },
        expandVisibleMessages: vi.fn(),
      })
    );

    // Should render without React key warnings — both tool calls render
    const { container } = render(<MessageList />);
    const cards = container.querySelectorAll('[class*="card"]');
    expect(cards).toHaveLength(2);
  });

  it('renders tool call result section when result is empty string', () => {
    const messageWithEmptyResult = {
      id: 'msg-empty-result',
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'tc-1',
          name: 'custom_tool',
          arguments: '{}',
          status: 'completed',
          result: '',
        },
      ],
    };

    storeMock.mockImplementation((selector) =>
      selector({
        activeSessionId: 'session-1',
        showThinking: false,
        streamingState: 'idle',
        streamingContent: '',
        streamingThinking: '',
        streamingToolCalls: [],
        messagesBySession: { 'session-1': [messageWithEmptyResult] },
        visibleMessageCounts: { 'session-1': 50 },
        expandVisibleMessages: vi.fn(),
      })
    );

    const { container } = render(<MessageList />);

    // Verify tool call card is rendered
    const card = container.querySelector('[class*="card"]');
    expect(card).toBeInTheDocument();

    // Open the dialog to access result section
    (card as HTMLElement).click();

    // Verify dialog is now open
    const dialog = mustExist(container.querySelector('dialog'), 'tool call dialog');
    expect(dialog).toHaveProperty('open', true);

    // The result section should be rendered with the label "结果"
    // Empty string result should still show the result section (not hide it)
    const resultLabels = dialog.querySelectorAll('[class*="label"]');
    expect(resultLabels).toHaveLength(2); // One for "参数", one for "结果"

    // Verify "结果" label is present
    const hasResultLabel = Array.from(resultLabels).some((label) => label.textContent === '结果');
    expect(hasResultLabel).toBe(true);

    // Verify the empty string result is rendered (empty pre tag)
    const codeElements = dialog.querySelectorAll('[class*="code"]');
    expect(codeElements).toHaveLength(2); // One for arguments, one for result
  });
});
