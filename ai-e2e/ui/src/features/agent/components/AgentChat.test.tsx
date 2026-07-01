import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentChat } from './AgentChat.js';
import { useAgentStore } from '../store/agentStore.js';

describe('AgentChat', () => {
  beforeEach(() => {
    useAgentStore.getState().clearMessages();
    useAgentStore.getState().setOpen(false);
  });

  it('renders messages and sends input', () => {
    useAgentStore.getState().setOpen(true);
    useAgentStore.getState().addMessage({ role: 'agent', content: 'Hi' });
    const onSend = vi.fn();
    render(<AgentChat onSend={onSend} isRunning={false} />);
    expect(screen.getByText('Hi')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('输入指令...'), { target: { value: 'test login' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(onSend).toHaveBeenCalledWith('test login');
  });

  it('renders nothing when closed', () => {
    const { container } = render(<AgentChat onSend={vi.fn()} isRunning={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows empty-state hint when there are no messages', () => {
    useAgentStore.getState().setOpen(true);
    render(<AgentChat onSend={vi.fn()} isRunning={false} />);
    expect(screen.getByText('试试输入：帮我测试登录流程')).toBeInTheDocument();
  });

  it('shows running indicator while running', () => {
    useAgentStore.getState().setOpen(true);
    render(<AgentChat onSend={vi.fn()} isRunning={true} />);
    expect(screen.getByText('助手正在处理...')).toBeInTheDocument();
  });

  it('aligns user messages right and agent messages left', () => {
    useAgentStore.getState().setOpen(true);
    useAgentStore.getState().addMessage({ role: 'user', content: 'hello user' });
    useAgentStore.getState().addMessage({ role: 'agent', content: 'hello agent' });
    render(<AgentChat onSend={vi.fn()} isRunning={false} />);
    const userRow = screen.getByText('hello user').parentElement?.parentElement;
    const agentRow = screen.getByText('hello agent').parentElement?.parentElement;
    expect(userRow?.className).toContain('justify-end');
    expect(agentRow?.className).toContain('justify-start');
  });
});
