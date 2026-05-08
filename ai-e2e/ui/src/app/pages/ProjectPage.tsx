import { useState } from 'react';
import { useParams } from 'react-router-dom';
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
        {activeTab === 0 && <div>配置面板 (Placeholder)</div>}
        {activeTab === 1 && <div>PRD 分析面板 (Placeholder)</div>}
        {activeTab === 2 && <div>探索面板 (Placeholder)</div>}
        {activeTab === 3 && <div>脚本面板 (Placeholder)</div>}
        {activeTab === 4 && <div>执行面板 (Placeholder)</div>}
      </div>
    </div>
  );
}
