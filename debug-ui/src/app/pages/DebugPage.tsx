import { useNavigate } from 'react-router-dom';
import { useLayoutStore, selectActiveActivityIcon, selectActiveRightTab, type ActivityIcon, type RightPanelTab } from '@/features/layout/store/layout.store.js';
import { useRuntimeStore, selectConnectionStatus, selectPlaywrightStatus } from '@/features/runtime/store/runtime.store.js';
import { useDebugSocket } from '@/features/runtime/hooks/useDebugSocket.js';
import { MonitorSidebarShell } from '@/features/runtime/components/MonitorSidebarShell.js';
import { MonitorMainShell } from '@/features/runtime/components/MonitorMainShell.js';
import { ControlPanel } from '@/features/playwright-control/components/ControlPanel.js';
import { SelectedElementCard } from '@/features/playwright-control/components/SelectedElementCard.js';
import { HistoryShell, InteractionsShell } from '@/features/history/components/index.js';
import { LiveViewCanvas } from '@/features/liveview/components/LiveViewCanvas.js';
import { AiToolbarShell, ChatMessageAreaShell, ChatComposerShell } from '@/features/chat/components/index.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { Tabs } from '@/shared/ui/Tabs.js';
import { testIds } from '@/shared/testing/testids.js';
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
  { icon: '💬', name: 'chat', title: '对话测试', isRoute: true },
  { icon: '📋', name: 'history', title: '历史', isRoute: false },
  { icon: '🖱️', name: 'interactions', title: '交互', isRoute: false },
];

const TESTID_MAP: Record<string, string> = {
  monitor: testIds.activityBtnMonitor,
  control: testIds.activityBtnControl,
  ai: testIds.activityBtnAi,
  chat: testIds.activityBtnChat,
  history: testIds.activityBtnHistory,
  interactions: testIds.activityBtnInteractions,
};

const SIDEBAR_TITLES: Record<ActivityIcon, string> = {
  monitor: 'Monitor',
  control: 'Control',
  ai: 'AI',
  history: 'History',
  interactions: 'Interactions',
};

export default function DebugPage() {
  const navigate = useNavigate();
  const activeIcon = useLayoutStore(selectActiveActivityIcon);
  const setActiveIcon = useLayoutStore((s) => s.setActiveActivityIcon);
  const activeRightTab = useLayoutStore(selectActiveRightTab);
  const setActiveRightTab = useLayoutStore((s) => s.setActiveRightTab);
  
  const connectionStatus = useRuntimeStore(selectConnectionStatus);
  const playwrightStatus = useRuntimeStore(selectPlaywrightStatus);

  // Initialize WebSocket connection
  useDebugSocket();

  const renderSidebarContent = () => {
    switch (activeIcon) {
      case 'monitor':
        return <MonitorSidebarShell />;
      case 'control':
        return (
          <>
            <ControlPanel />
            <SelectedElementCard />
          </>
        );
      case 'ai':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <AiToolbarShell />
            <ChatMessageAreaShell />
            <ChatComposerShell />
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
              onClick={() => (a.isRoute ? navigate('/chat') : setActiveIcon(a.name as ActivityIcon))}
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
          <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <StatusIndicator status={connectionStatus === 'connected' ? 'online' : (connectionStatus === 'connecting' || connectionStatus === 'reconnecting') ? 'loading' : 'offline'} />
              <span data-testid={testIds.connectionStatus} style={{ fontSize: '12px' }}>WS: {connectionStatus}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <StatusIndicator status={playwrightStatus === 'ready' ? 'online' : playwrightStatus === 'unhealthy' ? 'error' : 'offline'} />
              <span data-testid={testIds.playwrightStatus} style={{ fontSize: '12px' }}>PW: {playwrightStatus}</span>
            </div>
          </div>
          <h2 style={{ fontSize: '14px', margin: '0 0 8px 0' }}>{SIDEBAR_TITLES[activeIcon]}</h2>
          {renderSidebarContent()}
        </div>
      </aside>

      {/* Main Area */}
      <main className={styles.main} data-testid={testIds.debugMain}>
        {activeIcon === 'monitor' ? (
          <MonitorMainShell />
        ) : (
          <>
            <div className={styles.mainHeader}>
              <h2 className={styles.mainTitle}>Live View</h2>
            </div>
            <div className={styles.mainContent}>
              <LiveViewCanvas />
            </div>
          </>
        )}
      </main>

      {/* Right Panel */}
      <aside className={styles.rightPanel} data-testid={testIds.debugRightPanel}>
        <div className={styles.rightPanelContent}>
          <Tabs 
            tabs={[
              { id: 'dom-elements', label: 'DOM Elements' },
              { id: 'config', label: 'Config' }
            ]}
            activeTab={activeRightTab}
            onTabChange={(id) => setActiveRightTab(id as RightPanelTab)}
          >
            {activeRightTab === 'dom-elements' ? (
              <div data-testid={testIds.rightPanelTabDomElements} style={{ padding: '16px', color: 'var(--text-muted)' }}>
                <h3 style={{ fontSize: '14px', margin: '0 0 8px 0' }}>DOM Elements</h3>
              </div>
            ) : (
              <div data-testid={testIds.rightPanelTabConfig} style={{ padding: '16px', color: 'var(--text-muted)' }}>
                <h3 style={{ fontSize: '14px', margin: '0 0 8px 0' }}>Config</h3>
              </div>
            )}
          </Tabs>
        </div>
      </aside>
    </div>
  );
}
