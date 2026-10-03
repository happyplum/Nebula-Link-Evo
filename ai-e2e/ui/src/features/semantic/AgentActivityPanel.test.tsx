import { fireEvent, render, screen } from '@testing-library/react';
import { AGENT_STREAM_SNAPSHOT_SCHEMA } from '@nebula-link-evo/shared/types/agent-stream';
import { describe, expect, it, vi } from 'vitest';
import { AgentActivityPanel } from './AgentActivityPanel.js';

const snapshot = {
  schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
  streamId: 'job-1',
  seq: 1,
  state: 'streaming' as const,
  generatedAt: '2026-08-27T08:00:00.000Z',
  turns: [],
};
const scope = {
  version: 'checkout-v1',
  url: '/checkout',
  module: '订单摘要',
  revision: '1234567890abcdef',
};

describe('AgentActivityPanel', () => {
  it('Authoring 使用 compact 活动流并提交结构化修改意见', () => {
    const onSend = vi.fn();
    const { container } = render(
      <AgentActivityPanel
        collapsed={false}
        busy={false}
        scope={scope}
        snapshot={snapshot}
        connectionStatus="live"
        onReconnect={vi.fn()}
        onToggle={vi.fn()}
        onSend={onSend}
      />
    );

    expect(container.querySelector('.nebula-agent-stream--compact')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('向编排 Agent 发送修改要求'), {
      target: { value: '重新编排库存检查' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送修改要求' }));
    expect(onSend).toHaveBeenCalledWith('重新编排库存检查');
  });

  it('恢复观察只调用重连并保留 Run 只读内容', () => {
    const reconnect = vi.fn();
    const onSend = vi.fn();
    render(
      <AgentActivityPanel
        collapsed={false}
        busy={false}
        readOnly
        scope={scope}
        snapshot={snapshot}
        connectionStatus="reconnecting"
        onReconnect={reconnect}
        onToggle={vi.fn()}
        onSend={onSend}
      />
    );
    expect(screen.getByRole('status', { name: '活动连接状态' })).toHaveTextContent('正在恢复活动');
    fireEvent.click(screen.getByRole('button', { name: '立即重连' }));
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('Run 为只读活动流且保留作用域锁', () => {
    render(
      <AgentActivityPanel
        collapsed={false}
        busy={false}
        readOnly
        scope={scope}
        snapshot={snapshot}
        connectionStatus="live"
        onReconnect={vi.fn()}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByLabelText('运行 Agent 活动')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('/checkout')).toBeInTheDocument();
    expect(screen.getByText('1234567890ab')).toBeInTheDocument();
  });
});
