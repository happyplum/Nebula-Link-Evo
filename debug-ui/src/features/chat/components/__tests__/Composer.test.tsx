import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../store/chat.store.js';
import { Composer } from '../Composer.js';
import { testIds } from '@/shared/testing/testids.js';

describe('Composer', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useChatStore.getState().setSessions([{ id: 'session-1', title: '测试会话' }]);
    useChatStore.getState().setActiveSession('session-1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ messageId: 'message-1' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('发送时创建并对账乐观 turn，Enter 发送且 Shift+Enter 保留换行', async () => {
    render(<Composer />);
    const input = screen.getByTestId(testIds.composerInput);

    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 260 });
    fireEvent.change(input, { target: { value: '检查结算页' } });
    expect(input).toHaveStyle({ height: '200px' });

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/chat/sessions/session-1/messages'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: '检查结算页' }),
      })
    );
    expect(input).toHaveValue('');
    expect(useChatStore.getState().activityBySession['session-1']?.turns[0]?.turnId).toBe(
      'user:message-1'
    );
  });

  it('禁用空白、无会话和流式中的发送，并支持删除会话入口', () => {
    const onDelete = vi.fn();
    const { rerender } = render(<Composer onDeleteSession={onDelete} />);
    const input = screen.getByTestId(testIds.composerInput);
    expect(screen.getByTestId(testIds.sendButton)).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '删除会话' }));
    expect(onDelete).toHaveBeenCalledOnce();

    act(() => useChatStore.getState().setActiveSession(null));
    expect(input).toBeDisabled();

    act(() => {
      useChatStore.getState().setActiveSession('session-1');
      useChatStore.getState().setStreamingState('streaming');
    });
    rerender(<Composer />);
    expect(screen.getByTestId(testIds.composerInput)).toBeDisabled();
  });

  it('HTTP 失败时进入失败状态，缺失 messageId 时保留乐观 turn', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));
    render(<Composer />);
    fireEvent.change(screen.getByTestId(testIds.composerInput), { target: { value: '失败消息' } });
    fireEvent.click(screen.getByTestId(testIds.sendButton));
    await waitFor(() =>
      expect(useChatStore.getState().activityBySession['session-1']?.state).toBe('failed')
    );

    act(() => useChatStore.getState().setStreamingState('idle'));
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{}', { status: 202, headers: { 'Content-Type': 'application/json' } })
    );
    fireEvent.change(screen.getByTestId(testIds.composerInput), { target: { value: '无 ID' } });
    fireEvent.click(screen.getByTestId(testIds.sendButton));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(
      useChatStore
        .getState()
        .activityBySession['session-1']?.turns.some((turn) => turn.turnId.startsWith('optimistic:'))
    ).toBe(true);
  });
});
