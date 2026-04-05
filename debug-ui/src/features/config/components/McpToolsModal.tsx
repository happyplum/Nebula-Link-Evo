import { useState } from 'react';
import { useMcpTools } from '../api/config.queries.js';
import { useMcpCall } from '../api/config.mutations.js';
import { Modal } from '@/shared/ui/Modal.js';
import { LoadingSpinner } from '@/shared/ui/LoadingSpinner.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './McpToolsModal.module.css';

export interface McpToolsModalProps {
  serverName: string | null;
  onClose: () => void;
}

export function McpToolsModal({ serverName, onClose }: McpToolsModalProps) {
  const { data: mcpTools, isLoading, error } = useMcpTools();
  const mcpCall = useMcpCall();

  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [argsInput, setArgsInput] = useState<string>('{}');
  const [callResult, setCallResult] = useState<{
    success: boolean;
    data?: unknown;
    error?: string;
  } | null>(null);

  const serverTools =
    mcpTools?.tools.filter((tool) => serverName && tool.name.startsWith(`${serverName}.`)) || [];

  const handleExecute = async (fullToolName: string) => {
    if (!serverName) return;

    const actualToolName = fullToolName.substring(serverName.length + 1);

    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(argsInput);
    } catch {
      setCallResult({ success: false, error: 'JSON 参数格式错误' });
      return;
    }

    setCallResult(null);

    try {
      const result = await mcpCall.mutateAsync({
        server: serverName,
        tool: actualToolName,
        args: parsedArgs,
      });

      setCallResult({
        success: result.success,
        data: result.result,
        error: result.error,
      });
    } catch (err) {
      setCallResult({
        success: false,
        error: err instanceof Error ? err.message : '未知错误',
      });
    }
  };

  const handleToolSelect = (toolName: string) => {
    setSelectedTool(toolName === selectedTool ? null : toolName);
    setArgsInput('{}');
    setCallResult(null);
  };

  return (
    <Modal open={!!serverName} onClose={onClose} title={`${serverName} 工具`} maxWidth={800}>
      <div className={styles.container} data-testid={testIds.mcpToolsModal}>
        {isLoading ? (
          <div className={styles.centerContent}>
            <LoadingSpinner size="md" label="加载中..." />
          </div>
        ) : error ? (
          <div className={styles.error}>加载工具失败</div>
        ) : serverTools.length === 0 ? (
          <div className={styles.empty}>该服务器暂无可用工具。</div>
        ) : (
          <div className={styles.toolsList}>
            {serverTools.map((tool) => {
              const isSelected = selectedTool === tool.name;
              const actualToolName = tool.name.substring(serverName!.length + 1);

              return (
                <div
                  key={tool.name}
                  className={`${styles.toolCard} ${isSelected ? styles.selected : ''}`}
                >
                  <button
                    type="button"
                    className={styles.toolHeader}
                    onClick={() => handleToolSelect(tool.name)}
                  >
                    <div className={styles.toolTitleRow}>
                      <h3 className={styles.toolName}>{actualToolName}</h3>
                      <span className={styles.expandIcon}>{isSelected ? '▼' : '▶'}</span>
                    </div>
                    <p className={styles.toolDescription}>{tool.description || '无描述'}</p>
                  </button>

                  {isSelected && (
                    <div className={styles.toolDetails}>
                      <div className={styles.schemaSection}>
                        <h4 className={styles.sectionTitle}>输入参数</h4>
                        {tool.inputSchema?.properties &&
                        Object.keys(tool.inputSchema.properties).length > 0 ? (
                          <ul className={styles.schemaList}>
                            {Object.entries(tool.inputSchema.properties).map(
                              ([propName, propDetails]) => (
                                <li key={propName} className={styles.schemaItem}>
                                  <span className={styles.propName}>
                                    {propName}
                                    {tool.inputSchema?.required?.includes(propName) && (
                                      <span className={styles.required}>*</span>
                                    )}
                                  </span>
                                  <span className={styles.propType}>{propDetails.type}</span>
                                  {propDetails.description && (
                                    <span className={styles.propDesc}>
                                      - {propDetails.description}
                                    </span>
                                  )}
                                </li>
                              )
                            )}
                          </ul>
                        ) : (
                          <p className={styles.noSchema}>无输入参数。</p>
                        )}
                      </div>

                      <div className={styles.executeSection}>
                        <h4 className={styles.sectionTitle}>执行工具</h4>
                        <textarea
                          className={styles.argsInput}
                          value={argsInput}
                          onChange={(e) => setArgsInput(e.target.value)}
                          placeholder="输入 JSON 参数..."
                          rows={4}
                        />
                        <button
                          type="button"
                          className={styles.executeButton}
                          onClick={() => handleExecute(tool.name)}
                          disabled={mcpCall.isPending}
                        >
                          {mcpCall.isPending ? '执行中...' : '执行'}
                        </button>
                      </div>

                      {callResult && (
                        <div
                          className={`${styles.resultSection} ${callResult.success ? styles.resultSuccess : styles.resultError}`}
                        >
                          <h4 className={styles.sectionTitle}>执行结果</h4>
                          <pre className={styles.resultOutput}>
                            {callResult.success
                              ? JSON.stringify(callResult.data, null, 2)
                              : callResult.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
