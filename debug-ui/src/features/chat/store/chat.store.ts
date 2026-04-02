import { create } from 'zustand';

import type { ChatMessage, ChatSession, StreamingState } from '@/features/chat/types/index.js';

const EMPTY_MESSAGES: ChatMessage[] = [];

interface ChatState {
  // Sessions
  sessions: ChatSession[];
  activeSessionId: string | null;
  // Messages (keyed by session ID)
  messagesBySession: Record<string, ChatMessage[]>;
  // Streaming
  streamingState: StreamingState;
  streamingContent: string;
  streamingThinking: string;
  // UI state
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;

  // Session actions
  setSessions: (sessions: ChatSession[]) => void;
  addSession: (session: ChatSession) => void;
  removeSession: (sessionId: string) => void;
  updateSession: (sessionId: string, update: Partial<ChatSession>) => void;
  setActiveSession: (sessionId: string | null) => void;

  // Message actions
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  addOptimisticMessage: (sessionId: string, content: string) => string;
  reconcileMessage: (sessionId: string, tempId: string, serverMessage: ChatMessage) => void;
  updateMessage: (sessionId: string, messageId: string, update: Partial<ChatMessage>) => void;
  appendToLastAssistantMessage: (sessionId: string, token: string) => void;

  // Streaming actions
  setStreamingState: (state: StreamingState) => void;
  appendStreamingContent: (token: string) => void;
  appendStreamingThinking: (token: string) => void;
  flushStreamingToMessage: (sessionId: string) => void;
  resetStreaming: () => void;

  // Loading actions
  setIsLoadingSessions: (loading: boolean) => void;
  setIsLoadingMessages: (loading: boolean) => void;

  // Reset
  reset: () => void;
}

const initialState = {
  sessions: [] as ChatSession[],
  activeSessionId: null as string | null,
  messagesBySession: {} as Record<string, ChatMessage[]>,
  streamingState: 'idle' as StreamingState,
  streamingContent: '',
  streamingThinking: '',
  isLoadingSessions: false,
  isLoadingMessages: false,
};

export const useChatStore = create<ChatState>()((set) => ({
  ...initialState,

  // Session actions
  setSessions: (sessions) => set({ sessions }),

  addSession: (session) =>
    set((s) => ({ sessions: [session, ...s.sessions] })),

  removeSession: (sessionId) =>
    set((s) => {
      const { [sessionId]: _removed, ...rest } = s.messagesBySession;
      return {
        sessions: s.sessions.filter((session) => session.id !== sessionId),
        messagesBySession: rest,
        activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
      };
    }),

  updateSession: (sessionId, update) =>
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === sessionId ? { ...session, ...update } : session,
      ),
    })),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  // Message actions
  setMessages: (sessionId, messages) =>
    set((s) => ({
      messagesBySession: { ...s.messagesBySession, [sessionId]: messages },
    })),

  addMessage: (sessionId, message) =>
    set((s) => {
      const existing = s.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...existing, message],
        },
      };
    }),

  addOptimisticMessage: (sessionId, content) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const message: ChatMessage = {
      id: tempId,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    set((s) => {
      const existing = s.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...existing, message],
        },
      };
    });
    return tempId;
  },

  reconcileMessage: (sessionId, tempId, serverMessage) =>
    set((s) => {
      const existing = s.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: existing.map((msg) =>
            msg.id === tempId ? serverMessage : msg,
          ),
        },
      };
    }),

  updateMessage: (sessionId, messageId, update) =>
    set((s) => {
      const existing = s.messagesBySession[sessionId];
      if (!existing) return s;
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: existing.map((msg) =>
            msg.id === messageId ? { ...msg, ...update } : msg,
          ),
        },
      };
    }),

  appendToLastAssistantMessage: (sessionId, token) =>
    set((s) => {
      const existing = s.messagesBySession[sessionId];
      if (!existing || existing.length === 0) return s;
      const lastIdx = existing.length - 1;
      const last = existing[lastIdx];
      if (last.role !== 'assistant') return s;
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: existing.map((msg, i) =>
            i === lastIdx ? { ...msg, content: msg.content + token } : msg,
          ),
        },
      };
    }),

  // Streaming actions
  setStreamingState: (state) => set({ streamingState: state }),

  appendStreamingContent: (token) =>
    set((s) => ({ streamingContent: s.streamingContent + token })),

  appendStreamingThinking: (token) =>
    set((s) => ({ streamingThinking: s.streamingThinking + token })),

  flushStreamingToMessage: (sessionId) =>
    set((s) => {
      if (!s.streamingContent && !s.streamingThinking) return s;
      const message: ChatMessage = {
        id: `stream-${Date.now()}`,
        role: 'assistant',
        content: s.streamingContent,
        thinking: s.streamingThinking || undefined,
        timestamp: Date.now(),
      };
      const existing = s.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...existing, message],
        },
        streamingContent: '',
        streamingThinking: '',
        streamingState: 'idle' as StreamingState,
      };
    }),

  resetStreaming: () =>
    set({ streamingContent: '', streamingThinking: '', streamingState: 'idle' }),

  // Loading actions
  setIsLoadingSessions: (loading) => set({ isLoadingSessions: loading }),
  setIsLoadingMessages: (loading) => set({ isLoadingMessages: loading }),

  // Reset
  reset: () => set(initialState),
}));

// Selectors
export const selectSessions = (s: ChatState) => s.sessions;
export const selectActiveSessionId = (s: ChatState) => s.activeSessionId;
export const selectActiveSession = (s: ChatState) =>
  s.sessions.find((session) => session.id === s.activeSessionId) ?? null;
export const selectMessagesBySession = (s: ChatState) => s.messagesBySession;
export const selectActiveMessages = (s: ChatState) =>
  s.activeSessionId ? (s.messagesBySession[s.activeSessionId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES;
export const selectStreamingState = (s: ChatState) => s.streamingState;
export const selectStreamingContent = (s: ChatState) => s.streamingContent;
export const selectStreamingThinking = (s: ChatState) => s.streamingThinking;
export const selectIsLoadingSessions = (s: ChatState) => s.isLoadingSessions;
export const selectIsLoadingMessages = (s: ChatState) => s.isLoadingMessages;
