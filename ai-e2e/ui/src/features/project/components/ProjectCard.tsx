import { ArrowRight, GitBranch, MonitorUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/shared/components';
import type { Project } from '@/types/project.js';

export function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const target = project.latestVersion
    ? `/semantic/${project.id}/authoring/${project.latestVersion.id}`
    : `/semantic/${project.id}`;

  return (
    <Card
      className="group cursor-pointer border-border-default bg-surface-elevated p-5 transition hover:border-cyan-700/60"
      onClick={() => navigate(target)}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg border border-cyan-800/50 bg-cyan-950/35 text-cyan-300">
          <MonitorUp className="h-5 w-5" aria-hidden="true" />
        </span>
        {project.latestVersion && (
          <span className="rounded-full bg-surface-content px-2.5 py-1 text-[11px] text-text-secondary">
            {project.latestVersion.validationStatus}
          </span>
        )}
      </div>
      <h3 className="mt-4 text-base font-semibold text-text-primary">{project.name}</h3>
      <p className="mt-1 line-clamp-2 min-h-10 text-sm text-text-secondary">
        {project.description || '尚未添加项目说明'}
      </p>
      <div className="mt-4 flex items-center justify-between border-t border-border-default pt-3 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
          {project.latestVersion?.name ?? '等待业务版本'}
        </span>
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
    </Card>
  );
}
