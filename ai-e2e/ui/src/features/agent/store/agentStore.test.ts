import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from './agentStore.js';
import type { AgentAction } from '../types/agent.js';

describe('agentStore', () => {
  beforeEach(() => {
    useAgentStore.getState().clearMessages();
    useAgentStore.setState({ isOpen: false, phase: 'idle' });
  });

  it('adds a message', () => {
    useAgentStore.getState().addMessage({ role: 'agent', content: 'hello' });
    expect(useAgentStore.getState().messages).toHaveLength(1);
    expect(useAgentStore.getState().messages[0].content).toBe('hello');
  });

  it('assigns id and timestamp on addMessage', () => {
    useAgentStore.getState().addMessage({ role: 'user', content: 'hi' });
    const msg = useAgentStore.getState().messages[0];
    expect(typeof msg.id).toBe('string');
    expect(msg.id.length).toBeGreaterThan(0);
    expect(typeof msg.timestamp).toBe('number');
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  it('preserves role on addMessage', () => {
    useAgentStore.getState().addMessage({ role: 'user', content: 'ping' });
    expect(useAgentStore.getState().messages[0].role).toBe('user');
  });

  it('sets open state via setOpen', () => {
    expect(useAgentStore.getState().isOpen).toBe(false);
    useAgentStore.getState().setOpen(true);
    expect(useAgentStore.getState().isOpen).toBe(true);
    useAgentStore.getState().setOpen(false);
    expect(useAgentStore.getState().isOpen).toBe(false);
  });

  it('sets phase via setPhase', () => {
    expect(useAgentStore.getState().phase).toBe('idle');
    useAgentStore.getState().setPhase('analyzing');
    expect(useAgentStore.getState().phase).toBe('analyzing');
    useAgentStore.getState().setPhase('completed');
    expect(useAgentStore.getState().phase).toBe('completed');
  });

  it('appends an action to a message via appendAction', () => {
    useAgentStore.getState().addMessage({ role: 'agent', content: 'choose' });
    const messageId = useAgentStore.getState().messages[0].id;
    const action: AgentAction = {
      id: 'act-1',
      label: 'Run',
      variant: 'primary',
      onClick: () => undefined,
    };
    useAgentStore.getState().appendAction(messageId, action);
    const msg = useAgentStore.getState().messages[0];
    expect(msg.actions).toHaveLength(1);
    expect(msg.actions?.[0].id).toBe('act-1');
  });

  it('appends multiple actions preserving order', () => {
    useAgentStore.getState().addMessage({ role: 'agent', content: 'choose' });
    const messageId = useAgentStore.getState().messages[0].id;
    useAgentStore.getState().appendAction(messageId, {
      id: 'a1',
      label: 'One',
      variant: 'primary',
      onClick: () => undefined,
    });
    useAgentStore.getState().appendAction(messageId, {
      id: 'a2',
      label: 'Two',
      variant: 'secondary',
      onClick: () => undefined,
    });
    const msg = useAgentStore.getState().messages[0];
    expect(msg.actions?.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('does not mutate other messages when appending an action', () => {
    useAgentStore.getState().addMessage({ role: 'agent', content: 'first' });
    useAgentStore.getState().addMessage({ role: 'agent', content: 'second' });
    const [firstId, secondId] = useAgentStore.getState().messages.map((m) => m.id);
    useAgentStore.getState().appendAction(firstId, {
      id: 'x',
      label: 'X',
      variant: 'primary',
      onClick: () => undefined,
    });
    const msgs = useAgentStore.getState().messages;
    expect(msgs.find((m) => m.id === firstId)?.actions).toHaveLength(1);
    expect(msgs.find((m) => m.id === secondId)?.actions).toBeUndefined();
  });

  it('clears actions for a specific message via clearActions', () => {
    useAgentStore.getState().addMessage({ role: 'agent', content: 'choose', actions: [
      { id: 'a1', label: 'One', variant: 'primary', onClick: () => undefined },
    ] });
    const messageId = useAgentStore.getState().messages[0].id;
    useAgentStore.getState().clearActions(messageId);
    expect(useAgentStore.getState().messages[0].actions).toEqual([]);
  });

  it('clears messages and resets phase via clearMessages', () => {
    useAgentStore.getState().addMessage({ role: 'user', content: 'hi' });
    useAgentStore.getState().setPhase('running');
    useAgentStore.getState().clearMessages();
    expect(useAgentStore.getState().messages).toEqual([]);
    expect(useAgentStore.getState().phase).toBe('idle');
  });
});
