import { create } from 'zustand';
import {
  AGENT_STREAM_SNAPSHOT_SCHEMA,
  type AgentStreamEventV1,
  type AgentStreamSnapshotV1,
  type AgentStreamTurnV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import { reduceAgentStream } from '@nebula-link-evo/agent-activity-ui';
import type { ChatSession, StreamingState } from '@/features/chat/types/index.js';

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  activityBySession: Record<string, AgentStreamSnapshotV1>;
  isLoadingSessions: boolean;
  connectivityResult: { ok: boolean; latencyMs: number; message: string } | null;
  setSessions: (sessions: ChatSession[]) => void;
  addSession: (session: ChatSession) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  setActivitySnapshot: (sessionId: string, snapshot: AgentStreamSnapshotV1) => void;
  applyActivityEvent: (sessionId: string, event: AgentStreamEventV1) => void;
  addOptimisticTurn: (sessionId: string, content: string) => string;
  reconcileOptimisticTurn: (sessionId: string, tempTurnId: string, messageId: string) => void;
  setStreamingState: (state: StreamingState) => void;
  setIsLoadingSessions: (loading: boolean) => void;
  setConnectivityResult: (
    result: { ok: boolean; latencyMs: number; message: string } | null
  ) => void;
  reset: () => void;
}

const initialState = {
  sessions: [] as ChatSession[],
  activeSessionId: null as string | null,
  activityBySession: {} as Record<string, AgentStreamSnapshotV1>,
  isLoadingSessions: false,
  connectivityResult: null as { ok: boolean; latencyMs: number; message: string } | null,
};

export const useChatStore = create<ChatState>()((set) => ({
  ...initialState,
  setSessions: (sessions) => set({ sessions }),
  addSession: (session) => set((state) => ({ sessions: [session, ...state.sessions] })),
  removeSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _removed, ...activityBySession } = state.activityBySession;
      return {
        sessions: state.sessions.filter((session) => session.id !== sessionId),
        activityBySession,
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    }),
  setActiveSession: (activeSessionId) => set({ activeSessionId }),
  setActivitySnapshot: (sessionId, snapshot) =>
    set((state) => {
      const optimistic = (state.activityBySession[sessionId]?.turns ?? []).filter((turn) =>
        turn.turnId.startsWith('optimistic:')
      );
      const serverTurnIds = new Set(snapshot.turns.map((turn) => turn.turnId));
      return {
        activityBySession: {
          ...state.activityBySession,
          [sessionId]: {
            ...snapshot,
            turns: [
              ...snapshot.turns,
              ...optimistic.filter((turn) => !serverTurnIds.has(turn.turnId)),
            ],
          },
        },
      };
    }),
  applyActivityEvent: (sessionId, event) =>
    set((state) => {
      const current = state.activityBySession[sessionId] ?? emptySnapshot(sessionId);
      return {
        activityBySession: {
          ...state.activityBySession,
          [sessionId]: reduceAgentStream(current, event),
        },
      };
    }),
  addOptimisticTurn: (sessionId, content) => {
    const turnId = `optimistic:${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const turn: AgentStreamTurnV1 = {
      turnId,
      role: 'user',
      state: 'completed',
      createdAt: now,
      updatedAt: now,
      sections: [
        {
          type: 'user',
          sectionId: `${turnId}:content`,
          createdAt: now,
          updatedAt: now,
          markdown: content,
        },
      ],
    };
    set((state) => {
      const current = state.activityBySession[sessionId] ?? emptySnapshot(sessionId);
      return {
        activityBySession: {
          ...state.activityBySession,
          [sessionId]: { ...current, state: 'streaming', turns: [...current.turns, turn] },
        },
      };
    });
    return turnId;
  },
  reconcileOptimisticTurn: (sessionId, tempTurnId, messageId) =>
    set((state) => {
      const current = state.activityBySession[sessionId];
      if (!current) return state;
      const turnId = `user:${messageId}`;
      const alreadyPresent = current.turns.some(
        (turn) => turn.turnId === turnId && turn.turnId !== tempTurnId
      );
      return {
        activityBySession: {
          ...state.activityBySession,
          [sessionId]: {
            ...current,
            turns: alreadyPresent
              ? current.turns.filter((turn) => turn.turnId !== tempTurnId)
              : current.turns.map((turn) =>
                  turn.turnId === tempTurnId
                    ? {
                        ...turn,
                        turnId,
                        sections: turn.sections.map((section) => ({
                          ...section,
                          sectionId: section.sectionId.replace(tempTurnId, turnId),
                        })),
                      }
                    : turn
                ),
          },
        },
      };
    }),
  setStreamingState: (streamingState) =>
    set((state) => {
      if (!state.activeSessionId) return state;
      const current =
        state.activityBySession[state.activeSessionId] ?? emptySnapshot(state.activeSessionId);
      return {
        activityBySession: {
          ...state.activityBySession,
          [state.activeSessionId]: { ...current, state: mapLocalState(streamingState) },
        },
      };
    }),
  setIsLoadingSessions: (isLoadingSessions) => set({ isLoadingSessions }),
  setConnectivityResult: (connectivityResult) => set({ connectivityResult }),
  reset: () => set(initialState),
}));

function emptySnapshot(streamId: string): AgentStreamSnapshotV1 {
  return {
    schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
    streamId,
    seq: 0,
    state: 'idle',
    generatedAt: new Date(0).toISOString(),
    turns: [],
  };
}

function mapLocalState(state: StreamingState): AgentStreamSnapshotV1['state'] {
  if (state === 'streaming') return 'streaming';
  if (state === 'paused' || state === 'blocked') return 'paused';
  if (state === 'error') return 'failed';
  return 'idle';
}

export const selectSessions = (state: ChatState) => state.sessions;
export const selectActiveSessionId = (state: ChatState) => state.activeSessionId;
export const selectActiveSession = (state: ChatState) =>
  state.sessions.find((session) => session.id === state.activeSessionId) ?? null;
export const selectActiveActivity = (state: ChatState) =>
  state.activeSessionId ? (state.activityBySession[state.activeSessionId] ?? null) : null;
export const selectStreamingState = (state: ChatState): StreamingState => {
  const stream = selectActiveActivity(state);
  if (
    !stream ||
    stream.state === 'idle' ||
    stream.state === 'completed' ||
    stream.state === 'cancelled'
  ) {
    return 'idle';
  }
  if (stream.state === 'paused') return 'paused';
  if (stream.state === 'failed') return 'error';
  return 'streaming';
};
export const selectIsLoadingSessions = (state: ChatState) => state.isLoadingSessions;
export const selectConnectivityResult = (state: ChatState) => state.connectivityResult;
