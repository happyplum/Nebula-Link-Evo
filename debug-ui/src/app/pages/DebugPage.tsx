import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useLayoutStore,
  selectActiveActivityIcon,
  selectActiveRightTab,
  type ActivityIcon,
  type RightPanelTab,
} from '@/features/layout/store/layout.store.js';
import { MonitorSidebarShell } from '@/features/runtime/components/MonitorSidebarShell.js';
import { MonitorMainShell } from '@/features/runtime/components/MonitorMainShell.js';
import { BrowserBasicShell } from '@/features/playwright-control/components/BrowserBasicShell.js';
import { PageInteractionShell } from '@/features/playwright-control/components/PageInteractionShell.js';
import { OperationLogsShell } from '@/features/playwright-control/components/OperationLogsShell.js';
import { SelectedElementCard } from '@/features/playwright-control/components/SelectedElementCard.js';
import { DomElementsTable } from '@/features/playwright-control/components/DomElementsTable.js';
import { HistoryShell, InteractionsShell } from '@/features/history/components/index.js';
import ChatPage from './ChatPage.js';
import { Tabs } from '@/shared/ui/Tabs.js';
import { testIds } from '@/shared/testing/testids.js';
import {
  ConfigPanel,
  HealthStatusCard,
  McpStatusList,
  McpToolsModal,
  ApiKeysStatus,
  ConnectivityTest,
  AiTest,
} from '@/features/config/components/index.js';
import styles from './DebugPage.module.css';

interface ActivityDef {
  icon: string;
  name: ActivityIcon | 'chat';
  title: string;
  isRoute: boolean;
}

const ACTIVITIES: ActivityDef[] = [
  { icon: '📊', name: 'monitor', title: '状态', isRoute: false },
  { icon: '🎮', name: 'control', title: '控制', isRoute: false },
  { icon: '🤖', name: 'ai', title: 'AI', isRoute: false },
  { icon: '📋', name: 'history', title: '历史', isRoute: false },
  { icon: '🖱️', name: 'interactions', title: '交互', isRoute: false },
];

const TESTID_MAP: Record<string, string> = {
  monitor: testIds.activityBtnMonitor,
  control: testIds.activityBtnControl,
  ai: testIds.activityBtnAi,
  history: testIds.activityBtnHistory,
  interactions: testIds.activityBtnInteractions,
};

const SIDEBAR_TITLES: Record<ActivityIcon, string> = {
  monitor: '状态',
  control: '控制',
  ai: 'AI',
  history: '历史',
  interactions: '交互',
};

export default function DebugPage() {
  const navigate = useNavigate();
  const activeIcon = useLayoutStore(selectActiveActivityIcon);
  const setActiveIcon = useLayoutStore((s) => s.setActiveActivityIcon);
  const activeRightTab = useLayoutStore(selectActiveRightTab);
  const setActiveRightTab = useLayoutStore((s) => s.setActiveRightTab);

  const [selectedMcpServer, setSelectedMcpServer] = useState<string | null>(null);
  const [browserBasicOpen, setBrowserBasicOpen] = useState(true);
  const [pageInteractionOpen, setPageInteractionOpen] = useState(true);
  const [operationLogsOpen, setOperationLogsOpen] = useState(true);

  const renderSidebarContent = () => {
    switch (activeIcon) {
      case 'monitor':
        return <MonitorSidebarShell />;
      case 'control':
        return (
          <div className={styles.controlSidebar}>
            <BrowserBasicShell
              open={browserBasicOpen}
              onToggle={() => setBrowserBasicOpen((value) => !value)}
              icon="🌐"
            />
            <PageInteractionShell
              open={pageInteractionOpen}
              onToggle={() => setPageInteractionOpen((value) => !value)}
            />
            <OperationLogsShell
              open={operationLogsOpen}
              onToggle={() => setOperationLogsOpen((value) => !value)}
            />
          </div>
        );
      case 'ai':
        return (
          <div className={styles.aiSidebar}>
            <ChatPage />
          </div>
        );
      case 'history':
        return <HistoryShell />;
      case 'interactions':
        return <InteractionsShell />;
      default:
        return null;
    }
  };

  return (
    <div className={styles.shell} data-testid={testIds.debugShell}>
      {/* Activity Bar */}
      <nav className={styles.activityBar} data-testid={testIds.activityBar}>
        {ACTIVITIES.map((a) => {
          const isSidebar = !a.isRoute;
          const isActive = isSidebar && activeIcon === a.name;
          return (
            <button
              key={a.name}
              type="button"
              className={`${styles.activityIcon} ${isActive ? styles.active : ''}`}
              onClick={() =>
                a.isRoute ? navigate('/chat') : setActiveIcon(a.name as ActivityIcon)
              }
              title={a.title}
              data-testid={TESTID_MAP[a.name]}
            >
              {a.icon}
            </button>
          );
        })}
      </nav>

      {/* Sidebar */}
      <aside className={styles.sidebar} data-testid={testIds.debugSidebar}>
        <div className={styles.sidebarHeader}>
          <h1 className={styles.sidebarTitle}>🌌 Nebula Debug</h1>
        </div>
        <div className={styles.sidebarContent}>
          <h2 className={styles.visuallyHidden}>{SIDEBAR_TITLES[activeIcon]}</h2>
          {renderSidebarContent()}
        </div>
      </aside>

      {/* Main Area */}
      <main className={styles.main} data-testid={testIds.debugMain}>
        <MonitorMainShell />
      </main>

      {/* Right Panel */}
      <aside className={styles.rightPanel} data-testid={testIds.debugRightPanel}>
        <div className={styles.rightPanelContent}>
          <Tabs
            tabs={[
              { id: 'dom-elements', label: '📍 DOM Elements' },
              { id: 'config', label: '⚙️ 配置' },
            ]}
            activeTab={activeRightTab}
            onTabChange={(id) => setActiveRightTab(id as RightPanelTab)}
          >
            {activeRightTab === 'dom-elements' ? (
              <div
                className={styles.domElementsContent}
                data-testid={testIds.rightPanelTabDomElements}
              >
                <DomElementsTable />
                <SelectedElementCard />
              </div>
            ) : (
              <div className={styles.configContent} data-testid={testIds.configContent}>
                <ConfigPanel />
                <HealthStatusCard />
                <McpStatusList onSelectServer={setSelectedMcpServer} />
                <ApiKeysStatus />
                <ConnectivityTest />
                <AiTest />
              </div>
            )}
          </Tabs>
        </div>
      </aside>

      <McpToolsModal serverName={selectedMcpServer} onClose={() => setSelectedMcpServer(null)} />
    </div>
  );
}
