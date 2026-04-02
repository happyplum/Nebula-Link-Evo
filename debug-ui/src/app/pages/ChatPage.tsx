import { ChatPanel } from '@/features/chat/components/index.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ChatPage.module.css';

export default function ChatPage() {
  return (
    <div className={styles.fullPage} data-testid={testIds.chatPageRoot}>
      <ChatPanel />
    </div>
  );
}
