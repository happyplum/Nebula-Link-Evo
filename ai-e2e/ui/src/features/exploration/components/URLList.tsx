import React from 'react';
import { useParams } from 'react-router-dom';
import { DiscoveredURL } from '../store/explorationApi';
import { useRefreshUrlSnapshot } from '../store/explorationApi';
import { Button } from '@/shared/components';
import { cn } from '@/lib/utils';

interface URLListProps {
  urls: DiscoveredURL[];
  selectedUrlId?: string;
  onSelectUrl: (url: DiscoveredURL) => void;
  onAddManualUrl: () => void;
}

const statusClassMap: Record<string, string> = {
  explored: 'text-status-success',
  failed: 'text-status-error',
  pending: 'text-text-muted',
};

const statusTextMap: Record<string, string> = {
  explored: '已探索',
  failed: '失败',
  pending: '待探索',
};

export const URLList: React.FC<URLListProps> = ({
  urls,
  selectedUrlId,
  onSelectUrl,
  onAddManualUrl,
}) => {
  const { projectId } = useParams<{ projectId: string }>();
  const refreshSnapshot = useRefreshUrlSnapshot(projectId!);
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3">
        <div className="text-sm font-medium">发现的 URL ({urls.length})</div>
        <Button variant="ghost" size="sm" onClick={onAddManualUrl}>
          + 手动添加
        </Button>
      </div>
      
      <div className="flex-1 overflow-auto space-y-1">
        {urls.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-text-muted text-sm">暂无发现的 URL</div>
        ) : (
          urls.map((url) => (
            <div
              key={url.id}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer hover:bg-surface-elevated',
                selectedUrlId === url.id && 'bg-accent text-accent-foreground'
              )}
              onClick={() => onSelectUrl(url)}
            >
              <div className="text-sm font-medium truncate" title={url.title || url.url}>
                {url.title || '未知标题'}
              </div>
              <div className="text-xs text-text-muted truncate" title={url.url}>
                {url.url}
              </div>
              <div className={cn('ml-auto text-xs', statusClassMap[url.status] ?? 'text-text-muted')}>
                {statusTextMap[url.status] ?? '待探索'}
              </div>
              {(url.status === 'explored' || url.status === 'failed') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    refreshSnapshot.mutate(url.id);
                  }}
                  disabled={refreshSnapshot.isPending}
                  title="刷新快照"
                >
                  ↻
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
