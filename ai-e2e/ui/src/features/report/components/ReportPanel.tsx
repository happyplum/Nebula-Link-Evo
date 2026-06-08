import React from 'react';
import { useProjectReport } from '../store/reportApi.js';
import { FailureDistribution } from './FailureDistribution.js';
import { RecentFailures } from './RecentFailures.js';
import { Button } from '@/components/ui/button.js';

interface ReportPanelProps {
  projectId: string;
}

export const ReportPanel: React.FC<ReportPanelProps> = ({ projectId }) => {
  const { data: report, isLoading, error } = useProjectReport(projectId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-center py-12 text-text-muted">加载诊断报告中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-center py-12 text-text-muted">
          加载诊断报告失败: {error instanceof Error ? error.message : '未知错误'}
        </div>
      </div>
    );
  }

  if (!report || report.totalRuns === 0) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col items-center justify-center py-12 text-center">暂无诊断数据</div>
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
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">项目诊断报告</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDownloadJson}>
            下载 JSON
          </Button>
          <Button variant="default" onClick={handleViewHtml}>
            查看 HTML 报告
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-surface-content border border-border-default rounded-md p-4 text-center">
          <div className="text-xs text-text-muted">总执行数</div>
          <div className="text-2xl font-bold">{report.totalRuns}</div>
        </div>
        <div className="bg-surface-content border border-border-default rounded-md p-4 text-center">
          <div className="text-xs text-text-muted">失败数</div>
          <div className="text-2xl font-bold text-status-error">{report.failedRuns}</div>
        </div>
        <div className="bg-surface-content border border-border-default rounded-md p-4 text-center">
          <div className="text-xs text-text-muted">已诊断</div>
          <div className="text-2xl font-bold text-status-success">{report.diagnosedRuns}</div>
        </div>
        <div className="bg-surface-content border border-border-default rounded-md p-4 text-center">
          <div className="text-xs text-text-muted">未诊断</div>
          <div className="text-2xl font-bold text-text-muted">{report.undiagnosedRuns}</div>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <RecentFailures failures={report.recentFailures} />
        </div>
        <div className="w-80">
          <FailureDistribution distribution={report.failureDistribution} />
        </div>
      </div>
    </div>
  );
};
