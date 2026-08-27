import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AGENT_STREAM_SNAPSHOT_SCHEMA } from '@nebula-link-evo/shared/types/agent-stream';
import { useChatStore } from '../../store/chat.store.js';
import { MessageList } from '../MessageList.js';
import { testIds } from '@/shared/testing/testids.js';

const occurredAt = '2026-08-27T08:00:00.000Z';

describe('MessageList', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('无活动时显示会话提示，有活动时使用公共渲染器展示 Markdown 与 artifact', () => {
    const { rerender } = render(<MessageList />);
    expect(screen.getByText('选择或创建会话后开始对话')).toBeInTheDocument();

    act(() => {
      useChatStore.getState().setActiveSession('session-1');
      useChatStore.getState().setActivitySnapshot('session-1', {
        schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
        streamId: 'session-1',
        seq: 3,
        state: 'completed',
        generatedAt: occurredAt,
        turns: [
          {
            turnId: 'assistant:1',
            role: 'assistant',
            state: 'completed',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            sections: [
              {
                type: 'content',
                sectionId: 'content:1',
                createdAt: occurredAt,
                updatedAt: occurredAt,
                markdown: '**完成**',
              },
              {
                type: 'file',
                sectionId: 'file:1',
                createdAt: occurredAt,
                updatedAt: occurredAt,
                name: '报告',
                artifactRef: 'artifact://report-1',
              },
            ],
          },
        ],
      });
    });
    rerender(<MessageList />);

    expect(screen.getByText('完成')).toBeInTheDocument();
    expect(screen.getByText('artifact://report-1')).toBeInTheDocument();
  });

  it('只在用户未离开底部时自动滚动', () => {
    const { container } = render(<MessageList />);
    const list = screen.getByTestId(testIds.messageList);
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 390 },
    });

    fireEvent.scroll(list);
    expect(list.scrollTop).toBe(390);
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 100 });
    fireEvent.scroll(list);

    act(() => useChatStore.getState().setActiveSession('session-1'));
    expect(container).toBeInTheDocument();
    expect(list.scrollTop).toBe(100);
  });
});
