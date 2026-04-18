import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';
import { useDebugSocket } from '@/features/runtime/hooks/useDebugSocket.js';
import styles from './DebugToggle.module.css';

export function DebugToggle() {
  const debugEnabled = useRuntimeStore((s) => s.debugEnabled);
  const toggleDebug = useRuntimeStore((s) => s.toggleDebug);
  const { sendMessage } = useDebugSocket();

  const handleClick = () => {
    const newValue = !debugEnabled;
    toggleDebug();

    if (import.meta.env.DEV) {
      sendMessage('debug_toggle', { enabled: newValue });
    }
  };

  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <button
      type="button"
      className={`${styles.toggle}${debugEnabled ? ` ${styles.active}` : ''}`}
      onClick={handleClick}
      title={debugEnabled ? '关闭调试模式' : '开启调试模式'}
      data-testid="debug-toggle-button"
    >
      <span className={`${styles.icon}${debugEnabled ? ` ${styles.iconOn}` : ''}`}>
        {debugEnabled ? '🐞' : '🐛'}
      </span>
    </button>
  );
}
