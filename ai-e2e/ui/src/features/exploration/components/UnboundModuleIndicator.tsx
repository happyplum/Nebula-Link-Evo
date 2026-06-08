import React from 'react';
import { Card, Button } from '@/shared/components';

interface UnboundModuleIndicatorProps {
  details: string[];
  onDismiss: () => void;
}

export const UnboundModuleIndicator: React.FC<UnboundModuleIndicatorProps> = ({ details, onDismiss }) => {
  if (!details || details.length === 0) return null;

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium">无法进入下一阶段</h3>
        <p className="text-xs text-text-muted">以下功能模块尚未绑定 URL，请先完成绑定：</p>
      </div>
      <ul className="space-y-2">
        {details.map((detail, index) => {
          // Extract module name from backend format: functional_modules_missing_url_binding:moduleId:moduleName
          const match = detail.match(/^functional_modules_missing_url_binding:[^:]+:(.+)$/);
          const name = match ? match[1] : detail;
          return (
            <li key={index} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-status-warning">•</span>
              <span className="text-sm">{name}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-1">
        <Button variant="secondary" onClick={onDismiss}>
          我知道了
        </Button>
      </div>
    </Card>
  );
};
