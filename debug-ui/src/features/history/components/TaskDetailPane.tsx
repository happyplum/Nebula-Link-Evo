import { useMemo, useState } from 'react';
import { formatDateTime, formatDuration } from '@/shared/lib/date.js';
import { testIds } from '@/shared/testing/testids.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { useTaskDetail } from '../api/history.queries.js';
import { useExecutionStore } from '../store.js';
import type { TaskStep } from '../types/index.js';
import styles from './TaskDetailPane.module.css';

function getStatusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes('success') || normalized.includes('completed')) return styles.success;
  if (
    normalized.includes('fail') ||
    normalized.includes('error') ||
    normalized.includes('cancel')
  ) {
    return styles.error;
  }
  if (
    normalized.includes('run') ||
    normalized.includes('pending') ||
    normalized.includes('pause')
  ) {
    return styles.running;
  }
  return styles.muted;
}

function getDuration(startTime: string, endTime: string | null): string {
  if (!endTime) return '--';
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? formatDuration(end - start)
    : '--';
}

function StepItem({ step }: { step: TaskStep }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className={styles.stepItem}>
      <button
        type="button"
        className={styles.stepHeader}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={styles.stepLeading}>
          <span className={`${styles.dot} ${step.success ? styles.dotSuccess : styles.dotError}`} />
          <span className={styles.stepTitle}>步骤 {step.step}</span>
          <span className={styles.actionType}>{step.action.type}</span>
        </span>
        <span className={styles.stepMeta}>
          <span className={styles.stepTime}>{formatDateTime(step.timestamp)}</span>
          <span className={`${styles.stepBadge} ${step.success ? styles.success : styles.error}`}>
            {step.success ? '成功' : '失败'}
          </span>
          <span className={styles.expandMark}>{expanded ? '−' : '+'}</span>
        </span>
      </button>
      {expanded ? <p className={styles.stepMessage}>{step.message || '无附加信息'}</p> : null}
    </article>
  );
}

export function TaskDetailPane() {
  const selectedTaskId = useExecutionStore((state) => state.selectedTaskId);
  const setSelectedTaskId = useExecutionStore((state) => state.setSelectedTaskId);
  const { data: task, isLoading, error } = useTaskDetail(selectedTaskId ?? '');

  const orderedSteps = useMemo(() => {
    if (!task?.steps) return [];
    return [...task.steps].sort((a, b) => a.step - b.step);
  }, [task?.steps]);

  if (!selectedTaskId) return null;

  if (isLoading) {
    return (
      <div className={styles.state} data-testid={testIds.executionShellTaskDetail}>
        <StatusIndicator status="loading" label="加载任务详情..." />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className={styles.state} data-testid={testIds.executionShellTaskDetail}>
        <StatusIndicator status="error" label="任务详情加载失败" />
      </div>
    );
  }

  return (
    <div className={styles.panel} data-testid={testIds.executionShellTaskDetail}>
      <button type="button" className={styles.backButton} onClick={() => setSelectedTaskId(null)}>
        ← 返回列表
      </button>

      <section className={styles.section}>
        <div className={styles.headerRow}>
          <div>
            <span className={styles.sectionLabel}>Task ID</span>
            <h3 className={styles.taskId}>{task.taskId}</h3>
          </div>
          <span className={`${styles.badge} ${getStatusClass(task.status)}`}>{task.status}</span>
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.sectionLabel}>URL</span>
            <span className={styles.metaValue} title={task.url}>
              {task.url}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.sectionLabel}>开始</span>
            <span className={styles.metaValue}>{formatDateTime(task.startTime)}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.sectionLabel}>结束</span>
            <span className={styles.metaValue}>
              {task.endTime ? formatDateTime(task.endTime) : '--'}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.sectionLabel}>耗时</span>
            <span className={styles.metaValue}>{getDuration(task.startTime, task.endTime)}</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Instruction</span>
        <p className={styles.blockText}>{task.instruction}</p>
      </section>

      <section className={styles.section}>
        <div className={styles.resultHeader}>
          <span className={styles.sectionLabel}>结果 / 错误</span>
        </div>
        {task.result ? <p className={styles.blockText}>{task.result}</p> : null}
        {task.error ? (
          <p className={`${styles.blockText} ${styles.errorText}`}>{task.error}</p>
        ) : null}
        {!task.result && !task.error ? (
          <p className={styles.placeholder}>暂无结果或错误信息</p>
        ) : null}
      </section>

      <section className={styles.section}>
        <div className={styles.timelineHeader}>
          <span className={styles.sectionLabel}>步骤时间线</span>
          <span className={styles.timelineCount}>{orderedSteps.length} 步</span>
        </div>
        <div className={styles.timeline}>
          {orderedSteps.length > 0
            ? orderedSteps.map((step) => <StepItem key={step.step} step={step} />)
            : null}
          {orderedSteps.length === 0 ? <p className={styles.placeholder}>暂无步骤记录</p> : null}
        </div>
      </section>
    </div>
  );
}
