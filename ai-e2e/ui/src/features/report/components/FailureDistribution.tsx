import React from 'react';
import { ProjectFailureDistributionItem } from '@/types/report.js';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card.js';

interface FailureDistributionProps {
  distribution: ProjectFailureDistributionItem[];
}

const typeLabels: Record<string, string> = {
  selector: '选择器失效',
  timing: '等待超时',
  assertion: '断言失败',
  environment: '环境异常',
  data: '数据异常',
  unknown: '未知错误',
};

export const FailureDistribution: React.FC<FailureDistributionProps> = ({ distribution }) => {
  if (!distribution || distribution.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>失败类型分布</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-text-muted">暂无失败数据</div>
        </CardContent>
      </Card>
    );
  }

  const total = distribution.reduce((sum, item) => sum + item.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>失败类型分布</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {distribution.map((item) => {
            const percentage = total > 0 ? Math.round((item.count / total) * 100) : 0;
            return (
              <div key={item.type}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm">{typeLabels[item.type] ?? item.type}</span>
                  <span className="text-sm text-text-muted">{item.count} 次 ({percentage}%)</span>
                </div>
                <div className="w-full h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full bg-status-error rounded-full"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
