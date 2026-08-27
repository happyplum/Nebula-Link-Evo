import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_STREAM_SNAPSHOT_SCHEMA } from '@nebula-link-evo/shared/types/agent-stream';
import ChatPage from './ChatPage.js';
import { useChatStore } from '@/features/chat/store/chat.store.js';
import { useChatStream } from '@/features/chat/hooks/useChatStream.js';
import { apiClient } from '@/shared/api/client.js';
import { queryClient } from '@/shared/query/query-client.js';
import { useSessions } from '@/shared/query/hooks.js';
import { useConfig } from '@/features/config/api/config.queries.js';

vi.mock('@/features/chat/hooks/useChatStream.js', () => ({ useChatStream: vi.fn() }));
vi.mock('@/shared/query/hooks.js', () => ({ useSessions: vi.fn() }));
vi.mock('@/features/config/api/config.queries.js', () => ({ useConfig: vi.fn() }));
vi.mock('@/shared/api/client.js', () => ({ apiClient: { post: vi.fn() } }));
vi.mock('@/shared/query/query-client.js', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock('@/features/chat/components/index.js', () => ({
  SessionSelector: () => <div>会话选择器</div>,
  MessageList: () => <div>活动列表</div>,
  Composer: ({ onDeleteSession }: { onDeleteSession?: () => void }) => (
    <button type="button" onClick={onDeleteSession}>
      删除当前会话
    </button>
  ),
}));

const occurredAt = '2026-08-27T08:00:00.000Z';

function setStreamState(state: 'streaming' | 'paused' | 'failed') {
  useChatStore.getState().setActivitySnapshot('session-1', {
    schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
    streamId: 'session-1',
    seq: 1,
    state,
    generatedAt: occurredAt,
    turns: [],
  });
}

describe('ChatPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.getState().reset();
    vi.mocked(useSessions).mockReturnValue({
      data: [{ id: 'session-1', title: '主会话', status: 'running' }],
      isFetching: false,
    } as unknown as ReturnType<typeof useSessions>);
    vi.mocked(useConfig).mockReturnValue({
      data: { decision: { provider: 'openai', model: 'gpt-test' } },
    } as unknown as ReturnType<typeof useConfig>);
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'session-2', title: '新会话' });
    vi.mocked(queryClient.invalidateQueries).mockResolvedValue(undefined);
    vi.stubGlobal('EventSource', class EventSource {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    vi.spyOn(window, 'prompt').mockReturnValue(' 新会话 ');
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('从查询结果归一化会话并仅启动 snapshot-first 活动流', async () => {
    render(<ChatPage />);

    await waitFor(() => expect(useChatStore.getState().activeSessionId).toBe('session-1'));
    expect(useChatStream).toHaveBeenLastCalledWith({ sessionId: 'session-1', enabled: true });
    expect(screen.getByText('会话选择器')).toBeInTheDocument();
    expect(screen.getByText('活动列表')).toBeInTheDocument();
  });

  it('创建会话时使用决策模型配置并选中新会话', async () => {
    render(<ChatPage />);
    fireEvent.click(screen.getByTitle('新建会话'));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/v1/chat/sessions', {
        title: '新会话',
        provider: 'openai',
        model: 'gpt-test',
      })
    );
    expect(useChatStore.getState().activeSessionId).toBe('session-2');
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
  });

  it('没有模型配置或取消提示时不创建会话', () => {
    vi.mocked(useConfig).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useConfig>);
    const { unmount } = render(<ChatPage />);
    fireEvent.click(screen.getByTitle('新建会话'));
    expect(window.alert).toHaveBeenCalledWith('请先在配置中设置决策模型');
    expect(apiClient.post).not.toHaveBeenCalled();
    unmount();

    vi.mocked(useConfig).mockReturnValue({
      data: { decision: { provider: 'openai', model: 'gpt-test' } },
    } as unknown as ReturnType<typeof useConfig>);
    vi.mocked(window.prompt).mockReturnValue(null);
    render(<ChatPage />);
    fireEvent.click(screen.getByTitle('新建会话'));
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('提供暂停、恢复、打断、取消和删除控制', async () => {
    render(<ChatPage />);
    await waitFor(() => expect(useChatStore.getState().activeSessionId).toBe('session-1'));
    act(() => setStreamState('streaming'));

    fireEvent.click(screen.getByRole('button', { name: /暂停/ }));
    expect(screen.getByText(/正在暂停/)).toBeInTheDocument();
    await waitFor(() =>
      expect(useChatStore.getState().activityBySession['session-1']?.state).toBe('paused')
    );

    fireEvent.click(screen.getByRole('button', { name: /继续/ }));
    fireEvent.click(screen.getByRole('button', { name: /打断/ }));
    act(() => setStreamState('streaming'));
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));
    fireEvent.click(screen.getByRole('button', { name: '删除当前会话' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    expect(useChatStore.getState().activeSessionId).toBeNull();
  });

  it('控制请求失败时保留可恢复界面且不遗留暂停反馈', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network'));
    render(<ChatPage />);
    await waitFor(() => expect(useChatStore.getState().activeSessionId).toBe('session-1'));
    act(() => setStreamState('streaming'));
    fireEvent.click(screen.getByRole('button', { name: /暂停/ }));
    await waitFor(() => expect(screen.queryByText(/正在暂停/)).not.toBeInTheDocument());

    act(() => setStreamState('streaming'));
    fireEvent.click(screen.getByRole('button', { name: /打断/ }));
    act(() => setStreamState('paused'));
    fireEvent.click(screen.getByRole('button', { name: /继续/ }));
    act(() => setStreamState('streaming'));
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));
    fireEvent.click(screen.getByRole('button', { name: '删除当前会话' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
  });
});
