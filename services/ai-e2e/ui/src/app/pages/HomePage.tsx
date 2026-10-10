import { useState } from 'react';
import { Blocks, CircleCheck, MonitorUp } from 'lucide-react';
import { CreateProjectDialog } from '../../features/project/components/CreateProjectDialog.js';
import { DashboardMetricCard } from '../../features/project/components/DashboardMetricCard.js';
import { ProjectList } from '../../features/project/components/ProjectList.js';
import { useProjects } from '../../features/project/store/projectApi.js';

export function HomePage() {
  const { data: projects = [] } = useProjects();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const validVersions = projects.filter((project) => project.latestVersion?.validationStatus === 'valid').length;
  const needsAttention = projects.filter((project) =>
    ['needs_recheck', 'invalid'].includes(project.latestVersion?.validationStatus ?? '')
  ).length;

  return (
    <div className="mx-auto max-w-7xl space-y-7 p-6 lg:p-8">
      <section className="relative overflow-hidden rounded-2xl border border-cyan-900/50 bg-gradient-to-br from-slate-950 via-slate-950 to-cyan-950/45 p-6 shadow-xl shadow-black/10 lg:p-8">
        <div className="relative z-10 max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-800/60 bg-cyan-950/40 px-3 py-1 text-xs font-medium text-cyan-300">
            <MonitorUp className="h-3.5 w-3.5" aria-hidden="true" />
            Semantic E2E 工作台
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white lg:text-3xl">
            从 PRD 到可见浏览器执行，一条链完成编排与验收
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            创建项目时同时冻结部署、业务版本和需求，随后由 Agent 在浏览器证据约束下生成结构化资产。
          </p>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-cyan-500 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            <Blocks className="h-4 w-4" aria-hidden="true" />
            创建项目并开始编排
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <DashboardMetricCard label="Semantic 项目" value={projects.length} />
        <DashboardMetricCard label="已验证版本" value={validVersions} status="success" />
        <DashboardMetricCard label="需要处理" value={needsAttention} status={needsAttention ? 'error' : 'neutral'} />
      </div>

      <ProjectList onCreateProject={() => setIsCreateOpen(true)} />

      <div className="flex items-center gap-2 text-xs text-text-muted">
        <CircleCheck className="h-4 w-4 text-status-success" aria-hidden="true" />
        所有运行均使用结构化 semantic 资产和 proxy-adapter 可见浏览器，不提供旧脚本执行入口。
      </div>

      <CreateProjectDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </div>
  );
}
