import { useState } from 'react';
import { Tabs } from '@/shared/ui/Tabs.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './HistoryShell.module.css';

type HistoryTab = 'tasks' | 'logs' | 'decisions';

const HISTORY_TABS: { id: HistoryTab; label: string }[] = [
  { id: 'tasks', label: '历史' },
  { id: 'logs', label: '日志' },
  { id: 'decisions', label: '决策' },
];

export function HistoryShell() {
  const [activeTab, setActiveTab] = useState<HistoryTab>('tasks');

  return (
    <div className={styles.shell} data-testid={testIds.historyShell}>
      <Tabs
        tabs={HISTORY_TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as HistoryTab)}
      >
        <div className={styles.tabContent} data-testid={testIds.historyShellTabContent}>
          {activeTab === 'tasks' && (
            <div className={styles.emptyState} data-testid={testIds.historyShellTasksEmpty}>
              等待数据...
            </div>
          )}
          {activeTab === 'logs' && (
            <div className={styles.emptyState} data-testid={testIds.historyShellLogsEmpty}>
              等待数据...
            </div>
          )}
          {activeTab === 'decisions' && (
            <div className={styles.emptyState} data-testid={testIds.historyShellDecisionsEmpty}>
              等待数据...
            </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}
