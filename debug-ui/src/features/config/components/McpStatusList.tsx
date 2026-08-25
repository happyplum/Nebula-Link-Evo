import { useMcpStatus } from '../api/config.queries.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { LoadingSpinner } from '@/shared/ui/LoadingSpinner.js';
import { testIds } from '@/shared/testing/testids.js';
import type { McpServerState } from '../types/index.js';
import styles from './McpStatusList.module.css';

export interface McpStatusListProps {
  onSelectServer?: (serverName: string) => void;
}

/** Map MCP server state to StatusIndicator props. */
function getServerDisplay(state: McpServerState): {
  status: 'online' | 'offline' | 'loading' | 'error';
  label: string;
} {
  switch (state) {
    case 'running':
      return { status: 'online', label: '运行中' };
    case 'starting':
      return { status: 'loading', label: '启动中' };
    case 'reconnecting':
      return { status: 'loading', label: '重连中' };
    case 'failed':
      return { status: 'error', label: '失败' };
    case 'shutting_down':
      return { status: 'loading', label: '关闭中' };
    case 'stopped':
    default:
      return { status: 'offline', label: '已停止' };
  }
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
          {mcpStatus.servers.map((server) => {
            const display = getServerDisplay(server.state);
            return (
              <li key={server.name} className={styles.listItem} data-testid={testIds.mcpServerItem}>
                <div className={styles.serverInfo}>
                  <StatusIndicator status={display.status} label={display.label} size="sm" />
                  <div className={styles.serverMeta}>
                    <span className={styles.serverName}>
                      {server.name}
                      {server.source === 'built-in' && (
                        <span className={styles.builtInBadge}>内置</span>
                      )}
                    </span>
                    <span className={styles.serverStatus}>
                      {display.label} · {server.toolsCount} 工具
                    </span>
                  </div>
                </div>

                {server.state === 'running' && server.toolsCount > 0 && onSelectServer && (
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
            );
          })}
        </ul>
      )}
    </div>
  );
}
