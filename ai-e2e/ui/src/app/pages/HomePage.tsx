import { useState } from 'react';
import { ProjectList } from '../../features/project/components/ProjectList.js';
import { QuickActions } from '../../features/project/components/QuickActions.js';
import { RecentRuns } from '../../features/execution/components/RecentRuns.js';
import { DashboardMetricCard } from '../../features/project/components/DashboardMetricCard.js';
import { useProjects } from '../../features/project/store/projectApi.js';
import { useRecentRuns } from '../../features/execution/hooks/useRecentRuns.js';
import { CreateProjectDialog } from '../../features/project/components/CreateProjectDialog.js';
import type { ExecutionRun } from '../../features/execution/store/executionApi.js';

function isSuccess(status: ExecutionRun['status']): boolean {
  return status === 'pass' || status === 'passed' || status === 'fix_applied';
}

function isFailure(status: ExecutionRun['status']): boolean {
  return (
    status === 'fail' ||
    status === 'failed' ||
    status === 'error' ||
    status === 'timeout' ||
    status === 'fix_rejected'
  );
}

export function HomePage() {
  const { data: projects = [] } = useProjects();
  const { runs, isLoading: runsLoading } = useRecentRuns(5);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const completed = runs.filter((r) => isSuccess(r.status)).length;
  const failed = runs.filter((r) => isFailure(r.status)).length;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">工作区</h1>
        <p className="text-sm text-text-secondary">管理并运行你的 AI E2E 测试</p>
      </div>

      <QuickActions onCreateProject={() => setIsCreateOpen(true)} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <DashboardMetricCard label="项目数" value={projects.length} />
        <DashboardMetricCard label="通过次数" value={completed} status="success" />
        <DashboardMetricCard label="失败次数" value={failed} status={failed > 0 ? 'error' : 'neutral'} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProjectList onCreateProject={() => setIsCreateOpen(true)} />
        </div>
        <div>
          <RecentRuns runs={runs} isLoading={runsLoading} />
        </div>
      </div>

      <CreateProjectDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </div>
  );
}
