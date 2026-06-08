import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Script, useScriptVersions } from '../store/scriptsApi';
import { CodeEditor } from '@/shared/components';

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
    return <div className="flex items-center justify-center py-8 text-text-muted">加载版本历史中...</div>;
  }

  if (versions.length === 0) {
    return <div className="flex h-full items-center justify-center text-text-muted">暂无版本历史</div>;
  }

  return (
    <div className="flex h-full">
      <div className="flex w-64 flex-col border-r border-border-default">
        <h4 className="border-b border-border-default px-4 py-3 text-sm font-medium">版本记录</h4>
        <div className="flex-1 overflow-auto">
          {versions.map(version => (
            <div 
              key={version.id}
              className={cn(
                'cursor-pointer border-b border-border-default px-4 py-3 hover:bg-surface-elevated',
                selectedVersion?.id === version.id && 'bg-accent'
              )}
              onClick={() => setSelectedVersionId(version.id)}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">v{version.version}</span>
                <span className="text-xs text-text-muted">{formatDate(version.created_at)}</span>
              </div>
              <div className="mt-1 text-xs text-text-muted">
                <span>{getGeneratedByText(version.generated_by)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="flex flex-1 flex-col">
        {selectedVersion ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border-default px-4 py-2">
              <span>查看版本 v{selectedVersion.version}</span>
              <span className="rounded bg-surface-elevated px-2 py-0.5 text-xs text-text-muted">只读</span>
            </div>
            <CodeEditor
              value={selectedVersion.content}
              readOnly
              language="typescript"
              className="flex-1"
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-text-muted">请选择一个版本查看</div>
        )}
      </div>
    </div>
  );
};
