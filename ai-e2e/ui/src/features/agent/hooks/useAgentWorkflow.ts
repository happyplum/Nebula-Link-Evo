import { useCallback, useMemo } from 'react';
import { useAgentStore } from '../store/agentStore.js';
import { useUploadPRD, useAnalyzePRD, useTransitionState } from '../../analysis/store/analysisApi.js';
import { useStartExploration, useExplorationStatus } from '../../exploration/store/explorationApi.js';
import { useGenerateScripts } from '../../scripts/store/scriptsApi.js';
import { useRunAllScripts, useRuns } from '../../execution/store/executionApi.js';
import { useSSE } from '../../../hooks/use-sse.js';
import type { AgentPhase } from '../types/agent.js';

export interface UseAgentWorkflowReturn {
  send: (prompt: string) => void;
  isRunning: boolean;
  currentPhase: AgentPhase;
}

export function useAgentWorkflow(projectId: string): UseAgentWorkflowReturn {
  const addMessage = useAgentStore((s) => s.addMessage);
  const setPhase = useAgentStore((s) => s.setPhase);
  const phase = useAgentStore((s) => s.phase);

  const { mutateAsync: uploadPRD } = useUploadPRD(projectId);
  const { mutateAsync: analyzePRD } = useAnalyzePRD(projectId);
  const { mutateAsync: startExploration } = useStartExploration(projectId);
  const { data: explorationStatus } = useExplorationStatus(projectId);
  const { mutateAsync: generateScripts } = useGenerateScripts(projectId);
  const { mutateAsync: runAllScripts } = useRunAllScripts(projectId);
  const { mutate: transitionState } = useTransitionState(projectId);
  const { data: runs } = useRuns(projectId);

  const latestRun = useMemo(() => {
    if (!runs?.length) return undefined;
    return [...runs].sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    )[0];
  }, [runs]);

  useSSE({
    projectId,
    enabled: phase === 'running',
    handlers: {
      'execution.started': () => {
        addMessage({ role: 'agent', content: '测试执行已启动。' });
      },
      'execution.progress': (data) => {
        addMessage({ role: 'agent', content: `执行中：${data.step}` });
      },
      'execution.completed': () => {
        setPhase('completed');
        addMessage({ role: 'agent', content: '测试执行完成。' });
      },
      'execution.failed': (data) => {
        setPhase('failed');
        addMessage({ role: 'agent', content: `测试执行失败：${data.error}` });
      },
    },
  });

  const isRunning = phase !== 'idle' && phase !== 'completed' && phase !== 'failed';

  // Read fresh message ID from the store to avoid stale closures inside async callbacks.
  const appendActionToLast = useCallback((label: string, onClick: () => void) => {
    const { messages, appendAction } = useAgentStore.getState();
    const last = messages[messages.length - 1];
    if (!last) return;
    appendAction(last.id, {
      id: `${label}-${Date.now()}`,
      label,
      variant: 'primary',
      onClick,
    });
  }, []);

  const clearLastActions = useCallback(() => {
    const { messages, clearActions } = useAgentStore.getState();
    const last = messages[messages.length - 1];
    if (!last) return;
    clearActions(last.id);
  }, []);

  const runWorkflow = useCallback(
    async (prompt: string) => {
      if (!projectId || !prompt.trim()) return;

      addMessage({ role: 'user', content: prompt });
      setPhase('analyzing');

      try {
        await uploadPRD({ content: prompt, format: 'text' });
        await analyzePRD({ content: prompt, format: 'text' });

        addMessage({
          role: 'agent',
          content: '分析完成。接下来我可以自动探索目标站点。',
        });

        appendActionToLast('开始探索', async () => {
          clearLastActions();
          setPhase('exploring');
          await startExploration({});

          const urlsFound = explorationStatus?.urls_found ?? 0;
          addMessage({
            role: 'agent',
            content: `探索完成，发现 ${urlsFound} 个 URL。`,
          });

          appendActionToLast('生成脚本', async () => {
            clearLastActions();
            setPhase('generating');
            await generateScripts();

            addMessage({
              role: 'agent',
              content: '测试脚本已生成。',
            });

            appendActionToLast('执行测试', async () => {
              clearLastActions();
              setPhase('running');
              transitionState({ targetStatus: 'running' });
              await runAllScripts();

              const runId = latestRun?.id ?? 'unknown';
              addMessage({
                role: 'agent',
                content: `测试已启动，运行 ID：${runId}。`,
              });
            });
          });
        });
      } catch (err) {
        setPhase('failed');
        addMessage({
          role: 'agent',
          content: `处理失败：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    [
      projectId,
      addMessage,
      setPhase,
      uploadPRD,
      analyzePRD,
      appendActionToLast,
      clearLastActions,
      startExploration,
      explorationStatus,
      generateScripts,
      runAllScripts,
      transitionState,
      latestRun,
    ],
  );

  return { send: runWorkflow, isRunning, currentPhase: phase };
}
