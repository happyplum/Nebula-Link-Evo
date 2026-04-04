import { useMcpStatus } from '../api/config.queries.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { LoadingSpinner } from '@/shared/ui/LoadingSpinner.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './McpStatusList.module.css';

export interface McpStatusListProps {
  onSelectServer?: (serverName: string) => void;
}

export function McpStatusList({ onSelectServer }: McpStatusListProps) {
  const { data: mcpStatus, isLoading, error } = useMcpStatus();

  if (isLoading) {
    return (
      <div className={styles.container} data-testid={testIds.mcpStatusList}>
        <LoadingSpinner size="md" label="加载中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.container} ${styles.error}`} data-testid={testIds.mcpStatusList}>
        <p>加载 MCP 状态失败</p>
      </div>
    );
  }

  if (!mcpStatus) {
    return (
      <div className={styles.container} data-testid={testIds.mcpStatusList}>
        <p className={styles.empty}>无 MCP 数据</p>
      </div>
    );
  }

  if (!mcpStatus.enabled) {
    return (
      <div className={styles.container} data-testid={testIds.mcpStatusList}>
        <div className={styles.header}>
          <h2 className={styles.title}>MCP 服务</h2>
          <StatusIndicator status="offline" label="已禁用" />
        </div>
        <p className={styles.empty}>MCP 未在配置中启用。</p>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid={testIds.mcpStatusList}>
      <div className={styles.header}>
        <h2 className={styles.title}>MCP 服务</h2>
        <StatusIndicator status="online" label="已启用" />
      </div>
      
      {mcpStatus.servers.length === 0 ? (
        <p className={styles.empty}>无已启用的 MCP 服务器。</p>
      ) : (
        <ul className={styles.list}>
          {mcpStatus.servers.map((server) => (
            <li
              key={server.name}
              className={styles.listItem}
              data-testid={testIds.mcpServerItem}
            >
              <div className={styles.serverInfo}>
                <StatusIndicator
                  status={server.running ? 'online' : 'error'}
                  size="sm"
                />
                <div className={styles.serverMeta}>
                  <span className={styles.serverName}>{server.name}</span>
                  <span className={styles.serverStatus}>
                    {server.running ? '运行中' : '已停止'} · {server.toolsCount} 工具
                  </span>
                </div>
              </div>
              
              {server.running && server.toolsCount > 0 && onSelectServer && (
                <button
                  type="button"
                  className={styles.viewButton}
                  data-testid={testIds.mcpServerViewBtn}
                  onClick={() => onSelectServer(server.name)}
                >
                  查看工具
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
