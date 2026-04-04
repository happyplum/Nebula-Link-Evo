import React from 'react';
import { SessionSelector, MessageList, StatusBar, Composer } from '@/features/chat/components/index.js';
import {
  apiChatSessionInterrupt,
  apiChatSessionCancel,
  apiChatSessionPause,
  apiChatSessionResume,
} from '@/shared/api/endpoints.js';
import {
  useChatStore,
  selectShowThinking,
  selectSelectedModel,
  selectStreamingState,
  selectActiveSessionId,
} from '@/features/chat/store/chat.store.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ChatPage.module.css';

export default function ChatPage() {
  const streamingState = useChatStore(selectStreamingState);
  const activeSessionId = useChatStore(selectActiveSessionId);
  const showThinking = useChatStore(selectShowThinking);
  const selectedModel = useChatStore(selectSelectedModel);
  const addSession = useChatStore((s) => s.addSession);
  const removeSession = useChatStore((s) => s.removeSession);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const setStreamingState = useChatStore((s) => s.setStreamingState);
  const setShowThinking = useChatStore((s) => s.setShowThinking);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);

  const handleCreateSession = () => {
    const newSession = {
      id: `sess-${Date.now()}`,
      title: 'New Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addSession(newSession);
    setActiveSession(newSession.id);
  };

  const handleDeleteSession = async () => {
    if (activeSessionId) {
      try {
        await fetch(`/api/chat/sessions/${activeSessionId}`, { method: 'DELETE' });
      } catch (e) { console.error(e); }
      removeSession(activeSessionId);
    }
  };

  const handleRenameSession = async () => {
    if (!activeSessionId) return;
    const newTitle = window.prompt('Enter new session name:');
    if (newTitle && newTitle.trim() !== '') {
      try {
        await fetch(`/api/chat/sessions/${activeSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle.trim() }),
        });
        useChatStore.getState().updateSession(activeSessionId, { title: newTitle.trim() });
      } catch (e) {
        console.error('Failed to rename session', e);
      }
    }
  };

  const handleInterrupt = async () => {
    if (!activeSessionId) return;
    try { await fetch(apiChatSessionInterrupt(activeSessionId), { method: 'POST' }); } catch (e) { console.error(e); }
    setStreamingState('idle'); // optimistic
  };

  const handlePause = async () => {
    if (!activeSessionId) return;
    try { await fetch(apiChatSessionPause(activeSessionId), { method: 'POST' }); } catch (e) { console.error(e); }
    setStreamingState('paused');
  };

  const handleResume = async () => {
    if (!activeSessionId) return;
    try { await fetch(apiChatSessionResume(activeSessionId), { method: 'POST' }); } catch (e) { console.error(e); }
    setStreamingState('streaming');
  };

  const handleCancel = async () => {
    if (!activeSessionId) return;
    try { await fetch(apiChatSessionCancel(activeSessionId), { method: 'POST' }); } catch (e) { console.error(e); }
    setStreamingState('idle');
  };

  return (
    <div className={styles.fullPage} data-testid={testIds.chatPageRoot}>
      {/* Header Bar */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <select className={styles.statusFilter} defaultValue="" title="按状态筛选">
            <option value="">全部</option>
            <option value="idle">⏸️空闲</option>
            <option value="running">▶️运行</option>
            <option value="paused">⏸️暂停</option>
            <option value="blocked">🚫阻塞</option>
            <option value="completed">✅完成</option>
          </select>
          <div className={styles.sessionSelectorWrapper}>
            <SessionSelector />
          </div>
        </div>
        <div className={styles.headerRight}>
          <label className={styles.cotToggle} title="显示思考过程">
            <input 
              type="checkbox" 
              checked={showThinking}
              onChange={(e) => setShowThinking(e.target.checked)}
            />
            <span>CoT</span>
          </label>
          <div className={styles.divider} />
          <button type="button" className={styles.iconBtn} onClick={handleCreateSession} title="新建会话">➕</button>
          <button type="button" className={styles.iconBtn} onClick={handleRenameSession} title="重命名会话">✏️</button>
          <button type="button" className={`${styles.iconBtn} ${styles.errorText}`} onClick={handleDeleteSession} title="删除会话">🗑️</button>
        </div>
      </div>

      {/* Control Bar */}
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
          disabled={streamingState === 'idle'}
        >
          ❌ 取消
        </button>
      </div>

      {/* Message Region */}
      <div className={styles.messageRegion}>
        {streamingState === 'blocked' && (
          <div className={styles.blockedBanner} style={{ padding: '8px', background: 'var(--accent-warning)', color: '#fff', textAlign: 'center', zIndex: 10 }}>
            ⚠️ 任务被阻塞 (Blocked). 请人工确认或解决问题后点击 [继续]
          </div>
        )}
        <MessageList />
      </div>

      {/* Footer / Composer */}
      <div className={styles.footer}>
        <div className={styles.modelSelectWrapper}>
          <select 
            className={styles.modelSelect} 
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            <option value="decision">决策模型 (Decision)</option>
            <option value="vision">视觉模型 (Vision)</option>
          </select>
        </div>
        <div className={styles.composerWrapper}>
          <Composer />
        </div>
        <StatusBar />
      </div>
    </div>
  );
}
