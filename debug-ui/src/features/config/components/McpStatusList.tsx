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
        <LoadingSpinner size="md" label="Loading MCP status..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.container} ${styles.error}`} data-testid={testIds.mcpStatusList}>
        <p>Failed to load MCP status</p>
      </div>
    );
  }

  if (!mcpStatus) {
    return (
      <div className={styles.container} data-testid={testIds.mcpStatusList}>
        <p className={styles.empty}>No MCP data available</p>
      </div>
    );
  }

  if (!mcpStatus.enabled) {
    return (
      <div className={styles.container} data-testid={testIds.mcpStatusList}>
        <div className={styles.header}>
          <h2 className={styles.title}>MCP Servers</h2>
          <StatusIndicator status="offline" label="Disabled" />
        </div>
        <p className={styles.empty}>Model Context Protocol is disabled in configuration.</p>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid={testIds.mcpStatusList}>
      <div className={styles.header}>
        <h2 className={styles.title}>MCP Servers</h2>
        <StatusIndicator status="online" label="Enabled" />
      </div>
      
      {mcpStatus.servers.length === 0 ? (
        <p className={styles.empty}>No MCP servers configured or discovered.</p>
      ) : (
        <ul className={styles.list}>
          {mcpStatus.servers.map((server) => (
            <li key={server.name} className={styles.listItem}>
              <div className={styles.serverInfo}>
                <StatusIndicator 
                  status={server.running ? 'online' : 'error'} 
                  size="sm"
                />
                <span className={styles.serverName}>{server.name}</span>
              </div>
              
              <div className={styles.serverActions}>
                <span className={styles.toolsCount}>
                  {server.toolsCount} {server.toolsCount === 1 ? 'tool' : 'tools'}
                </span>
                {server.running && server.toolsCount > 0 && onSelectServer && (
                  <button 
                    type="button"
                    className={styles.viewButton}
                    onClick={() => onSelectServer(server.name)}
                  >
                    View Tools
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
