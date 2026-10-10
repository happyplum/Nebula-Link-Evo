import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client.js';
import { API_CHAT_CONNECTIVITY_TEST } from '@/shared/api/endpoints.js';
import { useChatStore } from '@/features/chat/store/chat.store.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ConnectivityTest.module.css';

interface ConnectivityResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export function ConnectivityTest() {
  const [result, setResult] = useState<ConnectivityResult | null>(null);
  const setConnectivityResult = useChatStore((s) => s.setConnectivityResult);

  const mutation = useMutation({
    mutationFn: () => apiClient.post<ConnectivityResult>(API_CHAT_CONNECTIVITY_TEST, {}),
    onSuccess: (data) => {
      setResult(data);
      setConnectivityResult(data);
    },
    onError: (err) => {
      const errResult = { ok: false, latencyMs: 0, message: err.message };
      setResult(errResult);
      setConnectivityResult(errResult);
    },
  });

  return (
    <div className={styles.container} data-testid={testIds.configConnectivityTest}>
      <h2 className={styles.title}>连通性测试</h2>
      <button
        type="button"
        className={styles.testBtn}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '测试中...' : result ? '重新测试' : '测试连接'}
      </button>

      {!result && !mutation.isPending && <div className={styles.idle}>未测试</div>}

      {result && (
        <div className={`${styles.result} ${result.ok ? styles.success : styles.failure}`}>
          {result.ok ? '✓' : '✗'} {result.ok ? '成功' : '失败'}
          {result.latencyMs > 0 && ` (${result.latencyMs}ms)`} — {result.message}
        </div>
      )}
    </div>
  );
}
