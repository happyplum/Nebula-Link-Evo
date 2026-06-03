import { create } from 'zustand';

function getInitialShowThinking(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  const stored = window.localStorage.getItem('showThinking');
  return stored == null ? true : stored === 'true';
}

import type { ChatMessage, ChatSession, StreamingState, ToolCall } from '@/features/chat/types/index.js';
import type { PendingJobInfo } from '@nebula-link-evo/shared';

const EMPTY_MESSAGES: ChatMessage[] = [];
const DEFAULT_PAGE_SIZE = 50;

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
  streamingToolCalls: ToolCall[];
  // UI state
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  // Shared UI state (synced across ChatPanel and ChatPage)
  showThinking: boolean;
  screenshotData: string | null;
  connectivityResult: { ok: boolean; latencyMs: number; message: string } | null;
  // Pagination
  visibleMessageCounts: Record<string, number>;
  // Pending jobs (keyed by session ID)
  pendingJobs: Record<string, PendingJobInfo[]>;

  // Session actions
  setSessions: (sessions: ChatSession[]) => void;
  addSession: (session: ChatSession) => void;
  removeSession: (sessionId: string) => void;
  updateSession: (sessionId: string, update: Partial<ChatSession>) => void;
  setActiveSession: (sessionId: string | null) => void;

  // Message actions
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  addOptimisticMessage: (sessionId: string, content: string, screenshot?: string | null) => string;
  reconcileMessage: (sessionId: string, tempId: string, serverMessage: ChatMessage) => void;
  updateMessage: (sessionId: string, messageId: string, update: Partial<ChatMessage>) => void;
  appendToLastAssistantMessage: (sessionId: string, token: string) => void;

  // Streaming actions
  setStreamingState: (state: StreamingState) => void;
  appendStreamingContent: (token: string) => void;
  appendStreamingThinking: (token: string) => void;
  appendStreamingToolCall: (toolCall: ToolCall) => void;
  updateStreamingToolCallResult: (toolCallId: string, result: string) => void;
  flushStreamingToMessage: (sessionId: string, force?: boolean) => void;
  resetStreaming: () => void;

  // Loading actions
  setIsLoadingSessions: (loading: boolean) => void;
  setIsLoadingMessages: (loading: boolean) => void;

  // Shared UI actions
  setShowThinking: (show: boolean) => void;
  setScreenshotData: (data: string | null) => void;
  clearScreenshotData: () => void;
  setConnectivityResult: (
    result: { ok: boolean; latencyMs: number; message: string } | null
  ) => void;

  // Pagination actions
  expandVisibleMessages: (sessionId: string) => void;
  resetVisibleMessages: (sessionId: string) => void;

  // Pending jobs actions
  addPendingJob: (sessionId: string, job: PendingJobInfo) => void;
  updateJobStarted: (sessionId: string, jobId: string) => void;
  removePendingJob: (sessionId: string, jobId: string) => void;
  setPendingJobsFromSnapshot: (sessionId: string, jobs: PendingJobInfo[]) => void;
  clearPendingJobs: (sessionId: string) => void;

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
  streamingToolCalls: [] as ToolCall[],
  isLoadingSessions: false,
  isLoadingMessages: false,
  showThinking: getInitialShowThinking(),
  screenshotData: null as string | null,
  connectivityResult: null as { ok: boolean; latencyMs: number; message: string } | null,
  visibleMessageCounts: {} as Record<string, number>,
  pendingJobs: {} as Record<string, PendingJobInfo[]>,
};

export const useChatStore = create<ChatState>()((set) => ({
  ...initialState,

  // Session actions
  setSessions: (sessions) => set({ sessions }),

  addSession: (session) => set((s) => ({ sessions: [session, ...s.sessions] })),

  removeSession: (sessionId) =>
    set((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [sessionId]: _removedMsg, ...msgRest } = s.messagesBySession;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [sessionId]: _removedVis, ...visRest } = s.visibleMessageCounts;
      return {
        sessions: s.sessions.filter((session) => session.id !== sessionId),
        messagesBySession: msgRest,
        visibleMessageCounts: visRest,
        activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
      };
    }),

  updateSession: (sessionId, update) =>
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === sessionId ? { ...session, ...update } : session
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

  addOptimisticMessage: (sessionId, content, screenshot) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const message: ChatMessage = {
      id: tempId,
      role: 'user',
      content,
      screenshot: screenshot ?? undefined,
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
          [sessionId]: existing.map((msg) => (msg.id === tempId ? serverMessage : msg)),
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
          [sessionId]: existing.map((msg) => (msg.id === messageId ? { ...msg, ...update } : msg)),
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
            i === lastIdx ? { ...msg, content: msg.content + token } : msg
          ),
        },
      };
    }),

  // Streaming actions
  setStreamingState: (state) => set({ streamingState: state }),

  appendStreamingContent: (token) => set((s) => ({ streamingContent: s.streamingContent + token })),

  appendStreamingThinking: (token) =>
    set((s) => ({ streamingThinking: s.streamingThinking + token })),

  appendStreamingToolCall: (toolCall) =>
    set((s) => {
      // Deduplicate by stable ID — prevents duplicate cards on reconnect or
      // event replay. If the ID already exists, skip silently.
      if (s.streamingToolCalls.some((tc) => tc.id === toolCall.id)) return s;
      return { streamingToolCalls: [...s.streamingToolCalls, toolCall] };
    }),

  updateStreamingToolCallResult: (toolCallId, result) =>
    set((s) => {
      // Primary: exact ID match
      const hasExactMatch = s.streamingToolCalls.some((tc) => tc.id === toolCallId);
      if (hasExactMatch) {
        return {
          streamingToolCalls: s.streamingToolCalls.map((tc) =>
            tc.id === toolCallId ? { ...tc, result, status: 'completed' as const } : tc
          ),
        };
      }

      // Emergency fallback: ONLY when exactly one running call exists in total,
      // associate the result with that sole call. This is the narrowest safe
      // rescue — never guess when multiple pending calls could mismatch.
      const runningCalls = s.streamingToolCalls.filter((tc) => tc.status === 'running');
      if (runningCalls.length === 1) {
        return {
          streamingToolCalls: s.streamingToolCalls.map((tc) =>
            tc.id === runningCalls[0].id ? { ...tc, result, status: 'completed' as const } : tc
          ),
        };
      }

      // No match found — return unchanged state
      return s;
    }),

  // `force=true` creates a message even with empty content, used by
  // run.error when tool calls exist without text content.
  flushStreamingToMessage: (sessionId, force) =>
    set((s) => {
      const hasToolCalls = s.streamingToolCalls.length > 0;
      if (!force && !s.streamingContent && !s.streamingThinking && !hasToolCalls) return s;
      const message: ChatMessage = {
        id: `stream-${Date.now()}`,
        role: 'assistant',
        content: s.streamingContent,
        thinking: s.streamingThinking || undefined,
        toolCalls: hasToolCalls ? s.streamingToolCalls : undefined,
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
        streamingToolCalls: [],
        streamingState: 'idle' as StreamingState,
      };
    }),

  resetStreaming: () =>
    set({ streamingContent: '', streamingThinking: '', streamingToolCalls: [], streamingState: 'idle' }),

  // Loading actions
  setIsLoadingSessions: (loading) => set({ isLoadingSessions: loading }),
  setIsLoadingMessages: (loading) => set({ isLoadingMessages: loading }),

  // Shared UI actions
  setShowThinking: (show) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('showThinking', String(show));
    }
    set({ showThinking: show });
  },
  setScreenshotData: (data) => set({ screenshotData: data }),
  clearScreenshotData: () => set({ screenshotData: null }),
  setConnectivityResult: (result) => set({ connectivityResult: result }),

  // Pagination actions
  expandVisibleMessages: (sessionId) =>
    set((s) => ({
      visibleMessageCounts: {
        ...s.visibleMessageCounts,
        [sessionId]: (s.visibleMessageCounts[sessionId] ?? DEFAULT_PAGE_SIZE) + DEFAULT_PAGE_SIZE,
      },
    })),

  resetVisibleMessages: (sessionId) =>
    set((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [sessionId]: _removed, ...rest } = s.visibleMessageCounts;
      return { visibleMessageCounts: rest };
    }),

  // Pending jobs actions
  addPendingJob: (sessionId, job) =>
    set((s) => {
      const existing = s.pendingJobs[sessionId] ?? [];
      // Idempotent: skip if jobId already exists
      if (existing.some((j) => j.jobId === job.jobId)) return s;
      return {
        pendingJobs: {
          ...s.pendingJobs,
          [sessionId]: [...existing, job],
        },
      };
    }),

  updateJobStarted: (sessionId, jobId) =>
    set((s) => {
      const existing = s.pendingJobs[sessionId];
      if (!existing) return s;
      // Find job by jobId and update status to running
      const updated = existing.map((job) => (job.jobId === jobId ? { ...job, status: 'running' as const } : job));
      // If no job found, return unchanged state
      if (updated.length === existing.length && !existing.some((j) => j.jobId === jobId)) return s;
      return {
        pendingJobs: {
          ...s.pendingJobs,
          [sessionId]: updated,
        },
      };
    }),

  removePendingJob: (sessionId, jobId) =>
    set((s) => {
      const existing = s.pendingJobs[sessionId];
      if (!existing) return s;
      const filtered = existing.filter((job) => job.jobId !== jobId);
      // If no jobs left, delete the entry
      if (filtered.length === 0) {
        const { [sessionId]: _removed, ...rest } = s.pendingJobs;
        return { pendingJobs: rest };
      }
      return {
        pendingJobs: {
          ...s.pendingJobs,
          [sessionId]: filtered,
        },
      };
    }),

  setPendingJobsFromSnapshot: (sessionId, jobs) =>
    set((s) => ({
      pendingJobs: {
        ...s.pendingJobs,
        [sessionId]: jobs,
      },
    })),

  clearPendingJobs: (sessionId) =>
    set((s) => {
      const { [sessionId]: _removed, ...rest } = s.pendingJobs;
      return { pendingJobs: rest };
    }),

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
export const selectStreamingToolCalls = (s: ChatState) => s.streamingToolCalls;
export const selectIsLoadingSessions = (s: ChatState) => s.isLoadingSessions;
export const selectIsLoadingMessages = (s: ChatState) => s.isLoadingMessages;
export const selectShowThinking = (s: ChatState) => s.showThinking;
export const selectScreenshotData = (s: ChatState) => s.screenshotData;
export const selectConnectivityResult = (s: ChatState) => s.connectivityResult;

