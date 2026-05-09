import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ConfigPanel } from '../../features/project/components/ConfigPanel';
import { AnalysisPanel } from '../../features/analysis/components/AnalysisPanel';
import ExplorationPanel from '../../features/exploration/components/ExplorationPanel';
import ScriptPanel from '../../features/scripts/components/ScriptPanel';
import ExecutionPanel from '../../features/execution/components/ExecutionPanel';
import styles from './ProjectPage.module.css';

const TABS = [
  { id: 0, label: '配置' },
  { id: 1, label: 'PRD 分析' },
  { id: 2, label: '探索' },
  { id: 3, label: '脚本' },
  { id: 4, label: '执行' },
];

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>项目: {projectId}</h1>
        <div className={styles.tabs}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>
      
      <div className={styles.content}>
        {activeTab === 0 && <ConfigPanel />}
        {activeTab === 1 && <AnalysisPanel />}
        {activeTab === 2 && <ExplorationPanel />}
        {activeTab === 3 && <ScriptPanel />}
        {activeTab === 4 && <ExecutionPanel />}
      </div>
    </div>
  );
}
