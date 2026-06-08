import React from 'react';
import { DiscoveredURL } from '../store/explorationApi';

interface PagePreviewProps {
  url: DiscoveredURL | null;
}

export const PagePreview: React.FC<PagePreviewProps> = ({ url }) => {
  if (!url) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-auto bg-surface-base border border-border-default rounded-md">
          <div className="flex items-center justify-center h-full text-text-muted text-sm">请选择左侧 URL 查看预览</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3">
        <div className="text-sm font-medium">{url.title || '未知标题'}</div>
        <div className="text-xs text-text-muted truncate">{url.url}</div>
      </div>
      <div className="flex-1 overflow-auto bg-surface-base border border-border-default rounded-md">
        <div className="flex items-center justify-center h-full text-text-muted text-sm">暂无截图</div>
      </div>
    </div>
  );
};
