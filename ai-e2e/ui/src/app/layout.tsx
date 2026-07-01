import { Outlet, NavLink, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useProjects, useProject, projectKeys } from '../features/project/store/projectApi.js';
import { useSSE } from '@/hooks/use-sse.js';
import { AgentEntry } from '../features/agent/components/AgentEntry.js';

export function Layout() {
  const { data: projects } = useProjects();
  const { projectId } = useParams<{ projectId: string }>();
  const { data: currentProject } = useProject(projectId || '');
  const queryClient = useQueryClient();

  // Listen for project status changes to refresh project data
  useSSE({
    projectId: projectId || '',
    handlers: {
      'project.status_changed': () => {
        if (projectId) {
          queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
        }
        queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      },
    },
    enabled: !!projectId,
  });

  // Get up to 5 most recent projects
  const recentProjects = projects
    ? [...projects]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 5)
    : [];

  // Workspace header title: project name when inside a project, otherwise the workspace label.
  const workspaceTitle = projectId ? (currentProject?.name || projectId) : '工作区';

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {/* Main Area: Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-border-default bg-surface-panel">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border-default px-4 py-3">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-status-info text-xs font-bold text-white">
              AI
            </span>
            <span className="text-sm font-semibold text-text-primary">AI E2E 测试工具</span>
          </div>

          {/* Navigation */}
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-3">
            <NavLink
              to="/"
              className={({ isActive }) =>
                cn(
                  'rounded-sm py-1.5 pr-3 text-[13px] text-text-secondary no-underline transition-colors',
                  isActive
                    ? 'border-l-2 border-l-status-info bg-surface-elevated pl-2.5 font-semibold text-text-primary'
                    : 'px-3 hover:bg-surface-elevated hover:text-text-primary'
                )
              }
            >
              首页
            </NavLink>

            {recentProjects.length > 0 && (
              <>
                <div className="mt-3 px-3 text-xs text-text-muted">最近项目</div>
                {recentProjects.map((project) => (
                  <NavLink
                    key={project.id}
                    to={`/project/${project.id}`}
                    className={({ isActive }) =>
                      cn(
                        'truncate rounded-sm py-1.5 pr-3 text-[13px] no-underline transition-colors',
                        isActive
                          ? 'border-l-2 border-l-status-info bg-surface-elevated pl-2.5 font-semibold text-text-primary'
                          : 'px-3 text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                      )
                    }
                    title={project.name}
                  >
                    {project.name}
                  </NavLink>
                ))}
              </>
            )}
          </nav>

          {/* Footer */}
          <div className="border-t border-border-default px-3 py-2">
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex flex-1 flex-col overflow-hidden bg-surface-content">
          {/* Workspace Header */}
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-border-default px-6">
            <h1 className="truncate text-sm font-semibold text-text-primary">{workspaceTitle}</h1>
            <AgentEntry />
          </header>

          {/* Page Content */}
          <div className="flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Status Bar */}
      <footer className="flex h-[28px] shrink-0 items-center border-t border-border-default bg-surface-panel px-4 text-xs text-text-muted">
        <div className="flex items-center gap-2">
          <span>当前项目: {currentProject?.name || '未选择'}</span>
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-status-success" />
            <span>{currentProject?.status || '未选择项目'}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
