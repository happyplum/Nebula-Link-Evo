import React, { useState } from 'react';
import { Script, useScriptVersions } from '../store/scriptsApi';
import { CodeEditor } from '@/shared/components';
import styles from './VersionHistory.module.css';

interface VersionHistoryProps {
  projectId: string;
  script: Script;
}

export const VersionHistory: React.FC<VersionHistoryProps> = ({ projectId, script }) => {
  const { data: versions = [], isLoading } = useScriptVersions(projectId, script.id);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const selectedVersion = versions.find(v => v.id === selectedVersionId) || versions[0];

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getGeneratedByText = (type: string) => {
    switch (type) {
      case 'ai_generated': return 'AI 生成';
      case 'human_edited': return '人工编辑';
      case 'ai_auto_fix': return 'AI 修复';
      default: return type;
    }
  };

  if (isLoading) {
    return <div className={styles.loading}>加载版本历史中...</div>;
  }

  if (versions.length === 0) {
    return <div className={styles.empty}>暂无版本历史</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <h4 className={styles.sidebarTitle}>版本记录</h4>
        <div className={styles.versionList}>
          {versions.map(version => (
            <div 
              key={version.id}
              className={`${styles.versionItem} ${selectedVersion?.id === version.id ? styles.selected : ''}`}
              onClick={() => setSelectedVersionId(version.id)}
            >
              <div className={styles.versionHeader}>
                <span className={styles.versionNumber}>v{version.version}</span>
                <span className={styles.versionDate}>{formatDate(version.created_at)}</span>
              </div>
              <div className={styles.versionMeta}>
                <span className={styles.generatedBy}>{getGeneratedByText(version.generated_by)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className={styles.main}>
        {selectedVersion ? (
          <div className={styles.editorContainer}>
            <div className={styles.editorHeader}>
              <span>查看版本 v{selectedVersion.version}</span>
              <span className={styles.readOnlyBadge}>只读</span>
            </div>
            <CodeEditor
              value={selectedVersion.content}
              readOnly
              language="typescript"
              className={styles.editor}
            />
          </div>
        ) : (
          <div className={styles.emptySelection}>请选择一个版本查看</div>
        )}
      </div>
    </div>
  );
};
