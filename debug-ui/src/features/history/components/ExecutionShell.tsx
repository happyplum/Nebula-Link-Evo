import { Tabs } from '@/shared/ui/Tabs.js';
import { testIds } from '@/shared/testing/testids.js';
import type { InteractionFilters } from '../types/index.js';
import { useExecutionStore, type ExecutionTab } from '../store.js';
import { ExecutionStatsCards } from './ExecutionStatsCards.js';
import { ExecutionContextBar } from './ExecutionContextBar.js';
import { TaskListPane } from './TaskListPane.js';
import { TaskDetailPane } from './TaskDetailPane.js';
import { ActionStreamPane } from './ActionStreamPane.js';
import styles from './ExecutionShell.module.css';

export const EXECUTION_TABS: { id: ExecutionTab; label: string }[] = [
  { id: 'tasks', label: '任务' },
  { id: 'interactions', label: '交互' },
];

interface ExecutionShellProps {
  filters: InteractionFilters;
}

export function ExecutionShell({ filters }: ExecutionShellProps) {
  const activeTab = useExecutionStore((state) => state.activeTab);
  const selectedTaskId = useExecutionStore((state) => state.selectedTaskId);
  const setActiveTab = useExecutionStore((state) => state.setActiveTab);

  return (
    <div className={styles.shell} data-testid={testIds.executionShell}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>执行总览</h2>
          <p className={styles.subtitle}>统一查看任务进度、任务上下文与交互流细节</p>
        </div>
      </div>

      <ExecutionStatsCards />
      {selectedTaskId ? <ExecutionContextBar /> : null}

      <div className={styles.tabsRegion}>
        <Tabs
          tabs={EXECUTION_TABS}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as ExecutionTab)}
        >
          <div className={styles.content}>
            {activeTab === 'tasks' ? selectedTaskId ? <TaskDetailPane /> : <TaskListPane /> : null}
            {activeTab === 'interactions' ? <ActionStreamPane filters={filters} /> : null}
          </div>
        </Tabs>
      </div>
    </div>
  );
}
