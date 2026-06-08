import React from 'react';
import { Card, Table, Column, Button } from '@/shared/components';
import { ExecutionRun } from '../store/executionApi';
import styles from './ResultDashboard.module.css';

interface ResultDashboardProps {
  runs: ExecutionRun[];
  isLoading: boolean;
  onViewDetail: (run: ExecutionRun) => void;
  onRunScript: (scriptId: string) => void;
}

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
      render: (_, record) => {
        const statusMap: Record<string, string> = {
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
        return (
          <span className={`${styles.statusBadge} ${styles[record.status]}`}>
            {statusMap[record.status] || record.status}
          </span>
        );
      },
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
            className={styles.actionButton}
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
    <div className={styles.container}>
      <div className={styles.overview}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>总执行数</div>
          <div className={styles.statValue}>{total}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>通过</div>
          <div className={`${styles.statValue} ${styles.passed}`}>{passed}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>失败</div>
          <div className={`${styles.statValue} ${styles.failed}`}>{failed}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>执行中/等待</div>
          <div className={`${styles.statValue} ${styles.running}`}>{pending}</div>
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
