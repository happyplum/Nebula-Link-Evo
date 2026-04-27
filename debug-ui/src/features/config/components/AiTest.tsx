import { useState } from 'react';
import { useTestAi } from '../api/config.mutations.js';
import { testIds } from '@/shared/testing/testids.js';
import type { TestAiResponse } from '../types/index.js';
import styles from './AiTest.module.css';

function ModelResult({ label, result }: { label: string; result: { status: string; provider?: string; model?: string; responseTime?: number; intro?: string; error?: string } | undefined }) {
  if (!result) return null;

  const isConnected = result.status === 'connected';

  return (
    <div className={styles.modelCard}>
      <div className={styles.modelHeader}>
        <span className={styles.modelLabel}>{label}</span>
        <span className={`${styles.modelStatus} ${isConnected ? styles.connected : styles.disconnected}`}>
          {isConnected ? '✓ 已连接' : '✗ ' + (result.status === 'not_configured' ? '未配置' : '连接失败')}
        </span>
      </div>
      {(result.provider || result.model) && (
        <div className={styles.modelInfo}>
          {result.provider} / {result.model}
        </div>
      )}
      {result.responseTime != null && (
        <div className={styles.modelTime}>{result.responseTime}ms</div>
      )}
      {result.intro && (
        <div className={styles.modelIntro}>{result.intro}</div>
      )}
      {result.error && (
        <div className={styles.modelError}>{result.error}</div>
      )}
    </div>
  );
}

export function AiTest() {
  const [result, setResult] = useState<TestAiResponse | null>(null);

  const mutation = useTestAi();

  const handleTest = async () => {
    try {
      const data = await mutation.mutateAsync();
      setResult(data);
    } catch {
      // Ignore errors - just clear the result on failure
      setResult(null);
    }
  };

  const hasError = mutation.isError && !result;

  return (
    <div className={styles.container} data-testid={testIds.configAiTest}>
      <h2 className={styles.title}>AI 模型测试</h2>
      <button
        type="button"
        className={styles.testBtn}
        disabled={mutation.isPending}
        onClick={handleTest}
      >
        {mutation.isPending ? '测试中...' : '测试 AI 连通性'}
      </button>

      {!mutation.isPending && !result && !hasError && (
        <div className={styles.testing}>未测试</div>
      )}

      {mutation.isPending && (
        <div className={styles.testing}>正在测试...</div>
      )}

      {result && (
        <div className={styles.results}>
          <ModelResult label="Vision" result={result.vision} />
          <ModelResult label="Decision" result={result.decision} />
          {result.totalResponseTime != null && (
            <div className={styles.totalTime}>
              总耗时: {result.totalResponseTime}ms
            </div>
          )}
        </div>
      )}

      {hasError && (
        <div className={styles.error}>
          测试失败: {mutation.error?.message || '未知错误'}
        </div>
      )}
    </div>
  );
}
