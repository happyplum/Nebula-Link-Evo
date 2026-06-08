import React from 'react';
import { ProjectRecentFailureItem } from '@/types/report.js';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card.js';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table.js';
import { cn } from '@/lib/utils.js';

interface RecentFailuresProps {
  failures: ProjectRecentFailureItem[];
}

const typeLabels: Record<string, string> = {
  selector: '选择器失效',
  timing: '等待超时',
  assertion: '断言失败',
  environment: '环境异常',
  data: '数据异常',
  unknown: '未知错误',
};

const typeBadgeVariants: Record<string, string> = {
  api: 'bg-status-info/20 text-status-info',
  navigation: 'bg-status-warning/20 text-status-warning',
  assertion: 'bg-status-error/20 text-status-error',
  unknown: 'bg-surface-elevated text-text-muted',
};

export const RecentFailures: React.FC<RecentFailuresProps> = ({ failures }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>最近失败记录</CardTitle>
      </CardHeader>
      <CardContent>
        {failures.length === 0 ? (
          <div className="py-8 text-center text-text-muted">暂无失败记录</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">时间</TableHead>
                <TableHead className="w-[120px]">失败类型</TableHead>
                <TableHead>AI 诊断</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failures.map((item) => (
                <TableRow key={item.runId}>
                  <TableCell>{new Date(item.timestamp).toLocaleString()}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full',
                        typeBadgeVariants[item.failureType] ?? typeBadgeVariants['unknown']
                      )}
                    >
                      {typeLabels[item.failureType] ?? item.failureType}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-text-secondary" title={item.diagnosis}>
                      {item.diagnosis}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
