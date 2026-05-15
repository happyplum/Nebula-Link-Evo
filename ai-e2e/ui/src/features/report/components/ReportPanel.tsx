import React from 'react';
import { useProjectReport } from '../store/reportApi';
import { FailureDistribution } from './FailureDistribution';
import { RecentFailures } from './RecentFailures';
import { Button } from '@/shared/components';
import styles from './ReportPanel.module.css';

interface ReportPanelProps {
  projectId: string;
}

export const ReportPanel: React.FC<ReportPanelProps> = ({ projectId }) => {
  const { data: report, isLoading, error } = useProjectReport(projectId);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingState}>加载诊断报告中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          加载诊断报告失败: {error instanceof Error ? error.message : '未知错误'}
        </div>
      </div>
    );
  }

  if (!report || report.totalRuns === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>暂无诊断数据</div>
      </div>
    );
  }

  const handleDownloadJson = () => {
    window.open(`/api/projects/${projectId}/diagnosis/report?format=json`, '_blank');
  };

  const handleViewHtml = () => {
    window.open(`/api/projects/${projectId}/diagnosis/report?format=html`, '_blank');
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>项目诊断报告</h2>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={handleDownloadJson}>
            下载 JSON
          </Button>
          <Button variant="primary" onClick={handleViewHtml}>
            查看 HTML 报告
          </Button>
        </div>
      </div>

      <div className={styles.overview}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>总执行数</div>
          <div className={styles.statValue}>{report.totalRuns}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>失败数</div>
          <div className={`${styles.statValue} ${styles.failed}`}>{report.failedRuns}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>已诊断</div>
          <div className={`${styles.statValue} ${styles.diagnosed}`}>{report.diagnosedRuns}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>未诊断</div>
          <div className={`${styles.statValue} ${styles.undiagnosed}`}>{report.undiagnosedRuns}</div>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.mainColumn}>
          <RecentFailures failures={report.recentFailures} />
        </div>
        <div className={styles.sideColumn}>
          <FailureDistribution distribution={report.failureDistribution} />
        </div>
      </div>
    </div>
  );
};
