import React from 'react';
import { Card, Table, Column, Button } from '@/shared/components';
import { ExecutionRun } from '../store/executionApi';
import { cn } from '@/lib/utils';

interface ResultDashboardProps {
  runs: ExecutionRun[];
  isLoading: boolean;
  onViewDetail: (run: ExecutionRun) => void;
  onRunScript: (scriptId: string) => void;
}

const statusBadgeMap: Record<string, string> = {
  passed: 'bg-status-success/20 text-status-success',
  pass: 'bg-status-success/20 text-status-success',
  failed: 'bg-status-error/20 text-status-error',
  fail: 'bg-status-error/20 text-status-error',
  error: 'bg-status-error/20 text-status-error',
  running: 'bg-status-info/20 text-status-info',
  pending: 'bg-surface-elevated text-text-muted',
  timeout: 'bg-status-warning/20 text-status-warning',
  fix_applied: 'bg-status-success/20 text-status-success',
  fix_rejected: 'bg-status-error/20 text-status-error',
};

const statusTextMap: Record<string, string> = {
  pending: '等待中',
  running: '执行中',
  pass: '通过',
  passed: '通过',
  fail: '失败',
  failed: '失败',
  error: '错误',
  timeout: '超时',
  fix_applied: '已修复',
  fix_rejected: '已拒绝修复',
};

export const ResultDashboard: React.FC<ResultDashboardProps> = ({
  runs,
  isLoading,
  onViewDetail,
  onRunScript,
}) => {
  const total = runs.length;
  const passed = runs.filter(r => r.status === 'pass' || r.status === 'passed').length;
  const failed = runs.filter(r => r.status === 'fail' || r.status === 'failed' || r.status === 'error').length;
  const pending = runs.filter(r => r.status === 'pending' || r.status === 'running').length;

  const columns: Column<ExecutionRun>[] = [
    {
      key: 'script_name',
      title: '脚本名称',
      dataIndex: 'script_name',
    },
    {
      key: 'status',
      title: '状态',
      render: (_, record) => (
        <span className={cn("text-xs px-2 py-0.5 rounded-full", statusBadgeMap[record.status] || 'bg-surface-elevated text-text-muted')}>
          {statusTextMap[record.status] || record.status}
        </span>
      ),
    },
    {
      key: 'duration',
      title: '耗时',
      render: (_, record) => record.duration_ms ? `${(record.duration_ms / 1000).toFixed(1)}s` : '-',
    },
    {
      key: 'started_at',
      title: '执行时间',
      render: (_, record) => new Date(record.started_at).toLocaleString(),
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (_, record) => (
        <div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="mr-2"
            onClick={(e) => {
              e.stopPropagation();
              onRunScript(record.script_id);
            }}
          >
            重新执行
          </Button>
          <Button 
            variant="secondary" 
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onViewDetail(record);
            }}
          >
            查看详情
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-surface-content border border-border-default rounded-md p-4 text-center">
          <div className="text-xs text-text-muted">总执行数</div>
          <div className="text-2xl font-bold">{total}</div>
        </div>
        <div className="bg-surface-content border border-border-default rounded-md p-4 text-center">
          <div className="text-xs text-text-muted">通过</div>
          <div className="text-2xl font-bold text-status-success">{passed}</div>
        </div>
        <div className="bg-surface-content border border-border-default rounded-md p-4 text-center">
          <div className="text-xs text-text-muted">失败</div>
          <div className="text-2xl font-bold text-status-error">{failed}</div>
        </div>
        <div className="bg-surface-content border border-border-default rounded-md p-4 text-center">
          <div className="text-xs text-text-muted">执行中/等待</div>
          <div className="text-2xl font-bold text-status-info">{pending}</div>
        </div>
      </div>

      <Card title="执行结果列表" noPadding>
        <Table
          columns={columns}
          data={runs}
          rowKey="id"
          isLoading={isLoading}
          onRowClick={onViewDetail}
        />
      </Card>
    </div>
  );
};
