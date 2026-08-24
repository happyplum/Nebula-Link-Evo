import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Boxes, CircleCheck, GitBranch, MonitorUp } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { semanticApi } from './api.js';

export function SemanticHomePage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const versions = useQuery({
    queryKey: ['semantic-versions', projectId],
    queryFn: () => semanticApi.listVersions(projectId),
    enabled: Boolean(projectId),
  });

  return (
    <main className="h-full overflow-y-auto bg-surface-base p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              className="text-xs text-text-secondary hover:text-text-primary"
              to="/"
            >
              ← 返回项目工作区
            </Link>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-text-primary">
              浏览器中心工作台
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-text-secondary">
              以业务版本为冻结边界，联动 PRD、模块、场景、浏览器证据与语义运行控制。
            </p>
          </div>
          <span className="rounded-full border border-cyan-700/40 bg-cyan-950/30 px-3 py-1.5 text-xs font-medium text-cyan-300">
            semantic v1 · 真实控制面
          </span>
        </div>

        {versions.isLoading && (
          <div className="rounded-xl border border-border-default bg-surface-content p-10 text-center text-text-secondary">
            正在加载业务版本…
          </div>
        )}
        {versions.error && (
          <div
            role="alert"
            className="rounded-xl border border-red-800 bg-red-950/30 p-5 text-red-200"
          >
            {versions.error.message}
          </div>
        )}
        {versions.data?.length === 0 && (
          <div className="rounded-xl border border-dashed border-border-hover bg-surface-content p-10 text-center">
            <Boxes className="mx-auto h-8 w-8 text-text-muted" aria-hidden="true" />
            <h2 className="mt-3 font-medium text-text-primary">还没有 semantic v1 业务版本</h2>
            <p className="mt-2 text-sm text-text-secondary">
              从项目工作区创建包含 PRD 与部署信息的业务版本，再进入资产编排。
            </p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {versions.data?.map((version) => (
            <article
              key={version.id}
              className="group rounded-xl border border-border-default bg-surface-content p-5 transition hover:border-cyan-700/60"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg border border-cyan-800/50 bg-cyan-950/40 text-cyan-300">
                  <GitBranch className="h-5 w-5" aria-hidden="true" />
                </div>
                <span className="rounded-full bg-surface-elevated px-2.5 py-1 text-[11px] text-text-secondary">
                  {version.validationStatus}
                </span>
              </div>
              <h2 className="mt-4 text-base font-semibold text-text-primary">{version.name}</h2>
              <p className="mt-1 font-mono text-xs text-text-muted">{version.versionKey}</p>
              <div className="mt-5 flex items-center gap-4 text-xs text-text-secondary">
                <span className="inline-flex items-center gap-1.5">
                  <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {version.validationStatus === 'valid' ? '可运行' : '需验证'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MonitorUp className="h-3.5 w-3.5" aria-hidden="true" />
                  浏览器编排
                </span>
              </div>
              <Link
                className="mt-5 flex min-h-10 items-center justify-between rounded-lg border border-border-default bg-surface-panel px-3 text-sm font-medium text-text-primary hover:border-cyan-700/60 hover:text-cyan-300"
                to={`/semantic/${projectId}/authoring/${version.id}`}
              >
                打开工作台
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
