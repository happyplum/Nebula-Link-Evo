import { Outlet, NavLink, useParams } from 'react-router-dom';
import { useProjects, useProject } from '../features/project/store/projectApi';
import styles from './layout.module.css';

export function Layout() {
  const { data: projects } = useProjects();
  const { projectId } = useParams<{ projectId: string }>();
  const { data: currentProject } = useProject(projectId || '');
  
  // Get up to 5 most recent projects
  const recentProjects = projects 
    ? [...projects].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 5)
    : [];

  return (
    <div className={styles.layout}>
      <div className={styles.mainArea}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.logoIcon}>AI</span>
            <span className={styles.sidebarTitle}>AI E2E 测试工具</span>
          </div>
          
          <nav className={styles.sidebarNav}>
            <NavLink
              to="/"
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
              }
            >
              首页
            </NavLink>
            
            {recentProjects.length > 0 && (
              <>
                <div style={{ marginTop: '16px', padding: '0 12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  最近项目
                </div>
                {recentProjects.map(project => (
                  <NavLink 
                    key={project.id}
                    to={`/project/${project.id}`} 
                    className={({ isActive }) => 
                      `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                    }
                    title={project.name}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {project.name}
                    </span>
                  </NavLink>
                ))}
              </>
            )}
          </nav>

          <div className={styles.sidebarFooter}>
            <a href="#/settings" className={styles.navLink}>
              设置
            </a>
          </div>
        </aside>

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>

      <footer className={styles.statusBar}>
        <div className={styles.statusLeft}>
          <span>当前项目: {currentProject?.name || '未选择'}</span>
          <div className={styles.statusBadge}>
            <div className={styles.statusDot}></div>
            <span>就绪</span>
          </div>
        </div>
        <div className={styles.statusRight}>
          <span>AI Provider: Connected</span>
        </div>
      </footer>
    </div>
  );
}
