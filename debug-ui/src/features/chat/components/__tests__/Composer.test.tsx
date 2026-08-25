import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Composer } from '../Composer.js';
import { useChatStore } from '../../store/chat.store.js';
import { testIds } from '@/shared/testing/testids.js';

type ChatState = ReturnType<typeof useChatStore.getState>;
type StoreMock = {
  mockImplementation: (
    implementation: (selector: (state: Record<string, unknown>) => unknown) => unknown
  ) => void;
};
const storeMock = useChatStore as unknown as StoreMock;

vi.mock('../../store/chat.store.js', () => ({
  useChatStore: vi.fn(),
  selectScreenshotData: (s: ChatState) => s.screenshotData,
  selectStreamingState: (s: ChatState) => s.streamingState,
  selectActiveSessionId: (s: ChatState) => s.activeSessionId,
}));

describe('Composer', () => {
  const mockAddOptimisticMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })));

    const state = {
      streamingState: 'idle',
      activeSessionId: 'session-1',
      screenshotData: null,
      addOptimisticMessage: mockAddOptimisticMessage,
      setStreamingState: vi.fn(),
      setScreenshotData: vi.fn(),
      clearScreenshotData: vi.fn(),
    };

    storeMock.mockImplementation((selector) => selector(state));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders input and send button', () => {
    render(<Composer />);
    expect(screen.getByTestId(testIds.composerInput)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.sendButton)).toBeInTheDocument();
  });

  it('disables input when streaming', () => {
    storeMock.mockImplementation((selector) =>
      selector({
        streamingState: 'streaming',
        activeSessionId: 'session-1',
        screenshotData: null,
        addOptimisticMessage: mockAddOptimisticMessage,
        setStreamingState: vi.fn(),
        setScreenshotData: vi.fn(),
        clearScreenshotData: vi.fn(),
      })
    );
    render(<Composer />);
    expect(screen.getByTestId(testIds.composerInput)).toBeDisabled();
    expect(screen.getByTestId(testIds.sendButton)).toBeDisabled();
  });

  it('disables input when no active session', () => {
    storeMock.mockImplementation((selector) =>
      selector({
        streamingState: 'idle',
        activeSessionId: null,
        screenshotData: null,
        addOptimisticMessage: mockAddOptimisticMessage,
        setStreamingState: vi.fn(),
        setScreenshotData: vi.fn(),
        clearScreenshotData: vi.fn(),
      })
    );
    render(<Composer />);
    expect(screen.getByTestId(testIds.composerInput)).toBeDisabled();
    expect(screen.getByTestId(testIds.sendButton)).toBeDisabled();
  });

  it('calls addOptimisticMessage on send', async () => {
    render(<Composer />);

    const input = screen.getByTestId(testIds.composerInput);
    const button = screen.getByTestId(testIds.sendButton);

    fireEvent.change(input, { target: { value: 'Hello world' } });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    expect(mockAddOptimisticMessage).toHaveBeenCalledWith('session-1', 'Hello world');
    expect(input).toHaveValue('');
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  });
});
