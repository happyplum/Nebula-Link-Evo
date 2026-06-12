import { useState, useMemo } from 'react';
import { useMcpTools } from '../api/config.queries.js';
import { useMcpCall } from '../api/config.mutations.js';
import { Modal } from '@/shared/ui/Modal.js';
import { Accordion } from '@/shared/ui/Accordion.js';
import { LoadingSpinner } from '@/shared/ui/LoadingSpinner.js';
import { testIds } from '@/shared/testing/testids.js';
import type { McpToolInputProperty, McpTool } from '../types/index.js';
import styles from './McpToolsModal.module.css';

export interface McpToolsModalProps {
  serverName: string | null;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Recursive schema property renderer                                */
/* ------------------------------------------------------------------ */

function SchemaProp({
  name,
  prop,
  isRequired,
  defaultOpen = false,
}: {
  name: string;
  prop: McpToolInputProperty;
  isRequired: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasChildren =
    (prop.type === 'object' && prop.properties && Object.keys(prop.properties).length > 0) ||
    (prop.type === 'array' && prop.items);

  const nestedRequired = useMemo(() => {
    if (prop.type === 'object' && prop.required) return new Set(prop.required);
    if (prop.type === 'array' && prop.items?.required) return new Set(prop.items.required);
    return EMPTY_SET;
  }, [prop.type, prop.required, prop.items]);

  return (
    <li className={styles.schemaItem}>
      <div className={styles.propHeader}>
        {hasChildren ? (
          <button
            type="button"
            className={styles.propToggle}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '▼' : '▶'}
          </button>
        ) : (
          <span className={styles.propBullet}>•</span>
        )}

        <span className={styles.propName}>
          {name}
          {isRequired && <span className={styles.required}>*</span>}
        </span>

        {prop.type && (
          <span className={styles.propType}>{prop.type}</span>
        )}

        {prop.enum && (
          <span className={styles.propEnum}>
            {prop.enum.join(' | ')}
          </span>
        )}

        {prop.default !== undefined && (
          <span className={styles.propDefault}>
            = {JSON.stringify(prop.default)}
          </span>
        )}
      </div>

      {prop.description && (
        <div className={styles.propDesc}>{prop.description}</div>
      )}

      {open && prop.type === 'object' && prop.properties && (
        <ul className={`${styles.schemaList} ${styles.indent}`}>
          {Object.entries(prop.properties).map(([k, v]) => (
            <SchemaProp
              key={k}
              name={k}
              prop={v}
              isRequired={nestedRequired.has(k)}
            />
          ))}
        </ul>
      )}

      {open && prop.type === 'array' && prop.items && (
        <ul className={`${styles.schemaList} ${styles.indent}`}>
          <SchemaProp
            name="[items]"
            prop={prop.items}
            isRequired={false}
          />
        </ul>
      )}

      {open && prop.anyOf && (
        <div className={styles.propUnion}>
          <span className={styles.propUnionLabel}>anyOf:</span>
          {prop.anyOf.map((variant, i) => (
            <div key={i} className={styles.propUnionVariant}>
              <SchemaProp
                name={`variant ${i + 1}`}
                prop={variant}
                isRequired={false}
              />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

const EMPTY_SET = new Set<string>();

/* ------------------------------------------------------------------ */
/*  Main modal                                                        */
/* ------------------------------------------------------------------ */

export function McpToolsModal({ serverName, onClose }: McpToolsModalProps) {
  const { data: mcpTools, isLoading, error } = useMcpTools({ enabled: !!serverName });
  const mcpCall = useMcpCall();

  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [argsInput, setArgsInput] = useState<string>('{}');
  const [callResult, setCallResult] = useState<{
    success: boolean;
    data?: unknown;
    error?: string;
  } | null>(null);

  const serverTools = useMemo(
    () =>
      mcpTools?.tools.filter((t) => serverName && t.name.startsWith(`${serverName}.`)) ?? [],
    [mcpTools, serverName]
  );

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
    setSelectedTool((prev) => (prev === toolName ? null : toolName));
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
              const actualToolName = serverName ? tool.name.substring(serverName.length + 1) : '';
              const req = new Set(tool.inputSchema?.required ?? []);

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
                  </button>

                  {isSelected && (
                    <div className={styles.toolDetails}>
                      {(tool.description || '').trim() && (
                        <div className={styles.descriptionSection}>
                          <h4 className={styles.sectionTitle}>说明</h4>
                          <pre className={styles.descriptionContent}>{tool.description}</pre>
                        </div>
                      )}
                      <div className={styles.schemaSection}>
                        <h4 className={styles.sectionTitle}>输入参数</h4>
                        {tool.inputSchema?.properties &&
                        Object.keys(tool.inputSchema.properties).length > 0 ? (
                          <ul className={styles.schemaList}>
                            {Object.entries(tool.inputSchema.properties).map(
                              ([propName, propDetails]) => (
                                <SchemaProp
                                  key={propName}
                                  name={propName}
                                  prop={propDetails}
                                  isRequired={req.has(propName)}
                                  defaultOpen
                                />
                              )
                            )}
                          </ul>
                        ) : (
                          <p className={styles.noSchema}>无输入参数。</p>
                        )}
                      </div>

                      <RawSchemaToggle inputSchema={tool.inputSchema} />

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

/* ------------------------------------------------------------------ */
/*  Raw schema toggle – uses shared Accordion                         */
/* ------------------------------------------------------------------ */

function RawSchemaToggle({ inputSchema }: { inputSchema?: McpTool['inputSchema'] }) {
  const [show, setShow] = useState(false);
  if (!inputSchema || Object.keys(inputSchema).length === 0) return null;

  return (
    <Accordion
      open={show}
      onToggle={() => setShow((v) => !v)}
      title="原始 Schema"
      testId="raw-schema"
    >
      <pre className={styles.rawSchemaContent}>
        {JSON.stringify(inputSchema, null, 2)}
      </pre>
    </Accordion>
  );
}
