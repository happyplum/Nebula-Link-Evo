import React from 'react';
import { ProjectRecentFailureItem } from '@/types/report';
import { Card, Table, Column } from '@/shared/components';
import styles from './ReportPanel.module.css';

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

export const RecentFailures: React.FC<RecentFailuresProps> = ({ failures }) => {
  const columns: Column<ProjectRecentFailureItem>[] = [
    {
      key: 'timestamp',
      title: '时间',
      dataIndex: 'timestamp',
      width: '180px',
      render: (value) => new Date(value).toLocaleString(),
    },
    {
      key: 'failureType',
      title: '失败类型',
      dataIndex: 'failureType',
      width: '120px',
      render: (value) => (
        <span className={`${styles.typeBadge} ${styles[`type-${value}`] || styles['type-unknown']}`}>
          {typeLabels[value] || value}
        </span>
      ),
    },
    {
      key: 'diagnosis',
      title: 'AI 诊断',
      dataIndex: 'diagnosis',
      render: (value) => (
        <div className={styles.diagnosisText} title={value}>
          {value}
        </div>
      ),
    },
  ];

  return (
    <Card title="最近失败记录" noPadding>
      <Table
        columns={columns}
        data={failures}
        rowKey="runId"
        emptyText="暂无失败记录"
      />
    </Card>
  );
};
