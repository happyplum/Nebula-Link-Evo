import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AgentStreamRenderer } from '@nebula-link-evo/agent-activity-ui';
import { selectActiveActivity, useChatStore } from '../store/chat.store.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './MessageList.module.css';

export function MessageList() {
  const snapshot = useChatStore(selectActiveActivity);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || userScrolledRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [snapshot?.seq, snapshot?.turns.length]);

  return (
    <div
      className={styles.container}
      ref={containerRef}
      onScroll={() => {
        const container = containerRef.current;
        if (!container) return;
        userScrolledRef.current =
          Math.abs(container.scrollHeight - container.scrollTop - container.clientHeight) >= 50;
      }}
      data-testid={testIds.messageList}
    >
      {snapshot ? (
        <AgentStreamRenderer
          snapshot={snapshot}
          density="comfortable"
          emptyLabel="发送一条消息，开始新的 Agent 会话"
          slots={{
            renderMarkdown: (markdown) => (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
            ),
            renderArtifact: (reference) => <span>{reference}</span>,
          }}
        />
      ) : (
        <div className={styles.emptyState}>选择或创建会话后开始对话</div>
      )}
    </div>
  );
}
