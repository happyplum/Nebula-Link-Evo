import { Outlet, NavLink } from 'react-router-dom';
import styles from './layout.module.css';

export function Layout() {
  return (
    <div className={styles.layout}>
      <div className={styles.mainArea}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span role="img" aria-label="logo">🤖</span>
            <span className={styles.sidebarTitle}>AI E2E 测试工具</span>
          </div>
          
          <nav className={styles.sidebarNav}>
            <NavLink 
              to="/" 
              className={({ isActive }) => 
                `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
              }
            >
              🏠 首页
            </NavLink>
            {/* Placeholder for recent projects */}
            <div style={{ marginTop: '16px', padding: '0 12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
              最近项目
            </div>
            <NavLink 
              to="/project/demo-1" 
              className={({ isActive }) => 
                `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
              }
            >
              📁 Demo Project
            </NavLink>
          </nav>

          <div className={styles.sidebarFooter}>
            <a href="#/settings" className={styles.navLink}>
              ⚙️ 设置
            </a>
          </div>
        </aside>

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>

      <footer className={styles.statusBar}>
        <div className={styles.statusLeft}>
          <span>当前项目: 未选择</span>
          <div className={styles.statusBadge}>
            <div className={styles.statusDot}></div>
            <span>就绪</span>
          </div>
        </div>
        <div className={styles.statusRight}>
          <span>AI Provider: 🟢 Connected</span>
        </div>
      </footer>
    </div>
  );
}
