import { create } from 'zustand';
import type { AgentMessage, AgentPhase } from '../types/agent.js';

interface AgentState {
  isOpen: boolean;
  phase: AgentPhase;
  messages: AgentMessage[];
  setOpen: (open: boolean) => void;
  addMessage: (message: Omit<AgentMessage, 'id' | 'timestamp'>) => void;
  appendAction: (messageId: string, action: NonNullable<AgentMessage['actions']>[number]) => void;
  clearActions: (messageId: string) => void;
  setPhase: (phase: AgentPhase) => void;
  clearMessages: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  isOpen: false,
  phase: 'idle',
  messages: [],
  setOpen: (open) => set({ isOpen: open }),
  addMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...message,
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          timestamp: Date.now(),
        },
      ],
    })),
  appendAction: (messageId, action) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, actions: [...(m.actions ?? []), action] } : m,
      ),
    })),
  clearActions: (messageId) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === messageId ? { ...m, actions: [] } : m)),
    })),
  setPhase: (phase) => set({ phase }),
  clearMessages: () => set({ messages: [], phase: 'idle' }),
}));
