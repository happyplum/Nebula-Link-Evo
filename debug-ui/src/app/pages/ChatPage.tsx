import React, { useEffect, useState } from 'react';
import { SessionSelector, MessageList, Composer } from '@/features/chat/components/index.js';
import {
  API_CHAT_SESSIONS,
  apiChatSession,
  apiChatSessionInterrupt,
  apiChatSessionCancel,
  apiChatSessionPause,
  apiChatSessionResume,
} from '@/shared/api/endpoints.js';
import { useChatStream } from '@/features/chat/hooks/useChatStream.js';
import { useConfig } from '@/features/config/api/config.queries.js';
import { apiClient } from '@/shared/api/client.js';
import { queryClient } from '@/shared/query/query-client.js';
import { queryKeys } from '@/shared/query/query-keys.js';
import { useSessions } from '@/shared/query/hooks.js';
import type { ConfigResponse } from '@/features/config/types/index.js';
import {
  useChatStore,
  selectStreamingState,
  selectActiveSessionId,
} from '@/features/chat/store/chat.store.js';
import type { ChatSession } from '@/features/chat/types/index.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ChatPage.module.css';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeSession(payload: unknown): ChatSession | null {
  if (!isRecord(payload) || typeof payload.id !== 'string') {
    return null;
  }

  return {
    id: payload.id,
    title:
      typeof payload.title === 'string' && payload.title.trim()
        ? payload.title
        : `会话 ${payload.id.slice(0, 8)}`,
    created_at: typeof payload.created_at === 'string' ? payload.created_at : undefined,
    status:
      payload.status === 'idle' ||
      payload.status === 'running' ||
      payload.status === 'paused' ||
      payload.status === 'blocked' ||
      payload.status === 'completed'
        ? payload.status
        : undefined,
  };
}

function extractSessions(data: unknown): ChatSession[] {
  const raw = Array.isArray(data) ? data : [];

  return raw.map(normalizeSession).filter((session): session is ChatSession => session !== null);
}

function getDefaultChatConfig(config: ConfigResponse | undefined) {
  if (!config?.decision?.provider || !config?.decision?.model) {
    return null;
  }
  return {
    provider: config.decision.provider,
    model: config.decision.model,
  };
}

function toRequestUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost';

  return new URL(path, origin).toString();
}

export default function ChatPage() {
  const streamingState = useChatStore(selectStreamingState);
  const activeSessionId = useChatStore(selectActiveSessionId);
  const addSession = useChatStore((s) => s.addSession);
  const removeSession = useChatStore((s) => s.removeSession);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const setStreamingState = useChatStore((s) => s.setStreamingState);
  const setSessions = useChatStore((s) => s.setSessions);
  const setIsLoadingSessions = useChatStore((s) => s.setIsLoadingSessions);
  const [isPausing, setIsPausing] = useState(false);
  const { data: configData } = useConfig();
  const { data: sessionsData, isFetching: isFetchingSessions } = useSessions();
  const sseEnabled =
    Boolean(activeSessionId) &&
    typeof EventSource !== 'undefined' &&
    typeof useChatStore.getState === 'function';

  useChatStream({
    sessionId: activeSessionId,
    enabled: sseEnabled,
  });

  useEffect(() => {
    setIsLoadingSessions(isFetchingSessions);
  }, [isFetchingSessions, setIsLoadingSessions]);

  useEffect(() => {
    if (!sessionsData) {
      return;
    }

    const normalizedSessions = extractSessions(sessionsData);
    const currentActiveSessionId = useChatStore.getState().activeSessionId;
    setSessions(normalizedSessions);

    if (
      !currentActiveSessionId ||
      !normalizedSessions.some((session) => session.id === currentActiveSessionId)
    ) {
      setActiveSession(normalizedSessions[0]?.id ?? null);
    }
  }, [sessionsData, setActiveSession, setSessions]);

  const handleCreateSession = async () => {
    const defaults = getDefaultChatConfig(configData);
    if (!defaults) {
      window.alert('请先在配置中设置决策模型');
      return;
    }

    const nextTitle = window.prompt('请输入会话名称：', '新会话');
    if (nextTitle == null) {
      return;
    }

    const title = nextTitle.trim() || '新会话';

    try {
      const created = await apiClient.post<unknown>(API_CHAT_SESSIONS, {
        title,
        provider: defaults.provider,
        model: defaults.model,
      });

      const session = normalizeSession(created);
      if (session) {
        addSession(session);
        setActiveSession(session.id);
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    } catch (error) {
      console.error('Failed to create session', error);
    }
  };

  const handleDeleteSession = async () => {
    if (!activeSessionId) return;

    removeSession(activeSessionId);

    try {
      await fetch(toRequestUrl(apiChatSession(activeSessionId)), { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    } catch (error) {
      console.error('Failed to delete session', error);
    }
  };

  const handleInterrupt = async () => {
    setStreamingState('idle');

    if (!activeSessionId) return;

    try {
      await fetch(toRequestUrl(apiChatSessionInterrupt(activeSessionId)), { method: 'POST' });
    } catch (error) {
      console.error('Failed to interrupt session', error);
    }
  };

  const handlePause = async () => {
    if (!activeSessionId) return;
    setIsPausing(true);

    try {
      await fetch(toRequestUrl(apiChatSessionPause(activeSessionId)), { method: 'POST' });
      setStreamingState('paused');
    } catch (error) {
      console.error('Failed to pause session', error);
    } finally {
      setIsPausing(false);
    }
  };

  const handleResume = async () => {
    setStreamingState('streaming');

    if (!activeSessionId) return;

    try {
      await fetch(toRequestUrl(apiChatSessionResume(activeSessionId)), { method: 'POST' });
    } catch (error) {
      console.error('Failed to resume session', error);
    }
  };

  const handleCancel = async () => {
    setStreamingState('idle');

    if (!activeSessionId) return;

    try {
      await fetch(toRequestUrl(apiChatSessionCancel(activeSessionId)), { method: 'POST' });
    } catch (error) {
      console.error('Failed to cancel session', error);
    }
  };

  return (
    <div className={styles.fullPage} data-testid={testIds.chatPageRoot}>
      {/* Header Bar */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.sessionSelectorWrapper}>
            <SessionSelector />
          </div>
        </div>
        <div className={styles.headerRight}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={handleCreateSession}
            title="新建会话"
          >
            ➕
          </button>
        </div>
      </div>

      {/* Active session controls */}
      {streamingState !== 'idle' && (
        <div className={styles.controlBar}>
          <button
            type="button"
            className={`${styles.controlBtn} ${styles.btnError}`}
            onClick={handleInterrupt}
            disabled={streamingState !== 'streaming'}
          >
            🔴 打断
          </button>
          <button
            type="button"
            className={`${styles.controlBtn} ${styles.btnWarning}`}
            onClick={handlePause}
            disabled={streamingState !== 'streaming'}
          >
            ⏸️ 暂停
          </button>
          <button
            type="button"
            className={`${styles.controlBtn} ${styles.btnSuccess}`}
            onClick={handleResume}
            disabled={streamingState !== 'paused'}
          >
            ▶️ 继续
          </button>
          <button
            type="button"
            className={`${styles.controlBtn} ${styles.btnCancel}`}
            onClick={handleCancel}
          >
            ❌ 取消
          </button>
        </div>
      )}

      {/* Pausing feedback */}
      {isPausing && <div className={styles.pausingFeedback}>⏳ 正在暂停...</div>}

      {/* Message Region */}
      <div className={styles.messageRegion}>
        <MessageList />
      </div>

      {/* Footer / Composer */}
      <div className={styles.footer}>
        <div className={styles.composerWrapper}>
          <Composer onDeleteSession={handleDeleteSession} />
        </div>
      </div>
    </div>
  );
}
