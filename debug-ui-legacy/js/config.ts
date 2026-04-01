import { showSuccess, showWarning, showError, appendLog, addAICallLog, type AILog } from './ui.js';

// 配置和历史记录管理

// 类型定义
interface Config {
  mode: string;
  vision: {
    provider: string;
    model: string;
  };
  decision: {
    provider: string;
    model: string;
  };
}

interface Health {
  services: {
    playwright?: {
      status: string;
      url: string;
    };
  };
}

interface MCPServer {
  name: string;
  running: boolean;
  toolsCount: number;
}

interface MCPStatus {
  enabled: boolean;
  servers: MCPServer[];
}

interface APIKeyInfo {
  displayName?: string;
  provider: string;
  status: 'valid' | 'invalid';
  keyPreview: string;
  error?: string;
}

interface APIKeysResponse {
  keys: APIKeyInfo[];
}

interface AIProviderStatus {
  status: 'connected' | 'not_configured' | 'failed';
  provider?: string;
  model?: string;
  intro?: string;
  error?: string;
  responseTime?: number;
}

interface AITestResponse {
  vision?: AIProviderStatus;
  decision?: AIProviderStatus;
}

interface TaskRecord {
  taskId: string;
  instruction: string;
  status: 'completed' | 'failed' | 'running';
  startTime: string;
  stepCount: number;
}

interface TaskDetail {
  taskId: string;
  url: string;
  instruction: string;
  status: 'completed' | 'failed' | 'running';
  startTime: string;
  endTime?: string;
  result?: string;
  error?: string;
  steps?: TaskStep[];
}

interface TaskStep {
  step: number;
  action: { type: string };
  message: string;
  timestamp: string;
  success: boolean;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema?: {
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

interface MCPToolsResponse {
  tools: MCPTool[];
}

interface MCPExecuteRequest {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

interface MCPExecuteResponse {
  success: boolean;
  result: unknown;
  error?: string;
}

declare global {
  interface Window {
    fetchConfig?: () => Promise<void>;
    fetchHistory?: () => Promise<void>;
    fetchMCPTools?: (serverName: string) => Promise<void>;
    toggleToolParams?: (index: number) => void;
    executeMCPTool?: (serverName: string, toolName: string, index: number) => Promise<void>;
    closeMCPToolsModal?: () => void;
    showTaskDetail?: (taskId: string) => Promise<void>;
    testConnectivity?: () => Promise<void>;
  }
}

// 函数定义
function getServiceUrl(port: number): string {
  const host = window.location.hostname || 'localhost';
  const protocol = window.location.protocol || 'http:';
  return `${protocol}//${host}:${port}`;
}

async function fetchConfig(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const [configRes, healthRes, mcpRes] = await Promise.all([
      fetch('/api/config', { signal: controller.signal }),
      fetch('/api/health', { signal: controller.signal }),
      fetch('/debug/api/mcp/status', { signal: controller.signal }),
    ]);
    clearTimeout(timeoutId);
    if (!configRes.ok) {
      throw new Error(`配置加载失败: HTTP ${configRes.status}`);
    }
    if (!healthRes.ok) {
      throw new Error(`健康检查失败: HTTP ${healthRes.status}`);
    }
    const config: Config = await configRes.json();
    const health: Health = await healthRes.json();
    let mcpStatus: MCPStatus = { enabled: false, servers: [] };
    try {
      mcpStatus = await mcpRes.json();
    } catch (e) {
      console.warn('Failed to load MCP status:', e);
    }
    renderConfig(config, health, mcpStatus);
    showSuccess('配置加载成功');
  } catch (e) {
    let errorMsg = '配置加载失败';
    const error = e as Error & { name?: string; message?: string };
    if (error.name === 'AbortError') {
      errorMsg = '配置加载超时，请检查服务状态';
    } else if (error.message) {
      errorMsg = error.message;
    }
    console.error('Failed to fetch config:', error);
    const configDisplay = document.getElementById('configDisplay');
    if (configDisplay) {
      configDisplay.innerHTML = `<div class="empty-state">${errorMsg}</div>`;
    }
    showError(errorMsg);
  }
}

function renderConfig(config: Config, health: Health, mcpStatus: MCPStatus): void {
  const display = document.getElementById('configDisplay');
  if (!display) return;
  if (!config || !config.vision || !config.decision) {
    display.innerHTML = '<div class="empty-state">配置数据格式错误</div>';
    console.error('Invalid config structure:', config);
    return;
  }
  let html = '<div class="text-12 leading-relaxed">';
  html += `<div class="config-item">
        <span class="config-label">模式</span>
        <span class="config-value">${config.mode ?? '-'}</span>
    </div>`;
  html += `<div class="mt-3 mb-1 text-xs font-semibold text-secondary uppercase">视觉模型</div>`;
  html += `<div class="py-2 border-b">
        <div class="config-item">
            <span class="config-label">提供商</span>
            <span class="config-value">${config.vision.provider ?? '-'}</span>
        </div>
        <div class="config-item">
            <span class="config-label">模型</span>
            <span class="config-value">${config.vision.model ?? '-'}</span>
        </div>
    </div>`;
  html += `<div class="mt-3 mb-1 text-xs font-semibold text-secondary uppercase">决策模型</div>`;
  html += `<div class="py-2 border-b">
        <div class="config-item">
            <span class="config-label">提供商</span>
            <span class="config-value">${config.decision.provider ?? '-'}</span>
        </div>
        <div class="config-item">
            <span class="config-label">模型</span>
            <span class="config-value">${config.decision.model ?? '-'}</span>
        </div>
    </div>`;

  html += `<div class="mt-3 mb-1 text-xs font-semibold text-secondary uppercase">MCP 服务</div>`;
  html += `<div class="py-2 border-b mcp-status-section">`;
  if (mcpStatus && mcpStatus.enabled) {
    const servers = mcpStatus.servers || [];
    if (servers.length > 0) {
      servers.forEach((server) => {
        const statusClass = server.running ? 'healthy' : 'unhealthy';
        const statusText = server.running ? '运行中' : '已停止';
        html += `<div class="service-status">
                    <div class="service-indicator ${statusClass}"></div>
                    <div class="flex-1">
                        <div class="service-name">${server.name}</div>
                        <div class="service-url">${statusText} · ${server.toolsCount} 工具</div>
                    </div>
                    <button onclick="fetchMCPTools('${server.name}')" class="text-12 px-2">查看工具</button>
                </div>`;
      });
    } else {
      html += `<div class="text-muted text-xs">无已启用的 MCP 服务器</div>`;
    }
  } else {
    html += `<div class="text-muted text-xs">MCP 未启用</div>`;
  }
  html += `</div>`;

  html += `<div class="mt-3 mb-1 text-xs font-semibold text-secondary uppercase">服务状态</div>`;
  html += `<div class="py-2 border-b">`;
  const services = health.services || {};
  if (services.playwright) {
    const status = services.playwright.status || 'unknown';
    const url = services.playwright.url || getServiceUrl(3001);
    html += `<div class="service-status">
            <div class="service-indicator ${status}" id="indicator-playwright"></div>
            <div class="flex-1">
                <div class="service-name">playwright</div>
                <div class="service-url">${url}</div>
            </div>
        </div>`;
  }
  html += `</div>`;

  html += `<div class="mt-3 mb-1 text-xs font-semibold text-secondary uppercase">连通性测试</div>`;
  html += `<div class="py-2 border-b">
        <div class="flex gap-2 mb-2">
            <button id="connectivity-test-btn" onclick="testConnectivity()" class="text-12 flex-1">测试连通性</button>
        </div>
        <div id="connectivity-status" class="text-xs text-muted">未测试</div>
    </div>`;

  html += `<div class="mt-3 mb-1 text-xs font-semibold text-secondary uppercase">API 密钥状态</div>`;
  html += `<div id="api-keys-container" class="py-2">
        <div class="text-muted text-xs">加载中...</div>
    </div>`;

  html += '</div>';
  display.innerHTML = html;

  loadAPIKeys();
}

async function loadAPIKeys(): Promise<void> {
  try {
    const response = await fetch('/debug/api/verify-keys');
    const data: APIKeysResponse = await response.json();

    const keysContainer = document.getElementById('api-keys-container');
    if (!keysContainer) return;

    keysContainer.innerHTML = '';

    if (!data.keys || data.keys.length === 0) {
      keysContainer.innerHTML = '<div class="text-muted text-xs">暂无 API 密钥</div>';
      return;
    }

    data.keys.forEach((key) => {
      const keyItem = document.createElement('div');
      keyItem.style.cssText =
        'display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; padding: 8px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-sm);';

      const header = document.createElement('div');
      header.style.cssText = 'display: flex; align-items: center; gap: 8px;';

      const providerSpan = document.createElement('span');
      providerSpan.style.cssText = 'color: var(--text-primary); font-size: 12px; font-weight: 500;';
      providerSpan.textContent = key.displayName || key.provider;

      const statusSpan = document.createElement('span');
      statusSpan.style.cssText = `font-size: 11px; padding: 2px 8px; border-radius: 12px; background: ${key.status === 'valid' ? 'var(--accent-success-subtle)' : 'var(--accent-error-subtle)'}; color: ${key.status === 'valid' ? 'var(--accent-success)' : 'var(--accent-error)'}; border: 1px solid ${key.status === 'valid' ? 'var(--accent-success)' : 'var(--accent-error)'};`;
      statusSpan.textContent = key.status === 'valid' ? '✓ 有效' : '✗ 无效';

      const previewSpan = document.createElement('span');
      previewSpan.style.cssText = 'color: var(--text-muted); font-size: 10px; margin-left: auto;';
      previewSpan.textContent = key.keyPreview;

      header.appendChild(providerSpan);
      header.appendChild(statusSpan);
      header.appendChild(previewSpan);
      keyItem.appendChild(header);

      if (key.error) {
        const errorSpan = document.createElement('div');
        errorSpan.style.cssText = 'color: var(--accent-error); font-size: 11px; padding-top: 4px;';
        errorSpan.textContent = key.error;
        keyItem.appendChild(errorSpan);
      }

      keysContainer.appendChild(keyItem);
    });
  } catch (err) {
    console.error('Failed to load API keys:', err);
    const keysContainer = document.getElementById('api-keys-container');
    if (keysContainer) {
      const error = err as Error & { message?: string };
      keysContainer.innerHTML =
        '<div class="text-error text-xs">加载失败: ' + (error.message || '未知错误') + '</div>';
    }
  }
}

// AI 连通性测试
async function testConnectivity(): Promise<void> {
  const btn = document.getElementById('connectivity-test-btn') as HTMLButtonElement;
  const statusDiv = document.getElementById('connectivity-status');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '测试中...';
  }
  if (statusDiv) {
    statusDiv.textContent = '测试中...';
    statusDiv.className = 'text-xs text-muted';
  }

  try {
    const response = await fetch('/api/chat/connectivity/test', {
      method: 'POST',
    });
    const data = await response.json();
    
    if (statusDiv) {
      if (data.ok) {
        statusDiv.textContent = `✓ 成功 (${data.latencyMs}ms) - ${data.message}`;
        statusDiv.className = 'text-xs text-success';
        if (window.chatManager) {
          window.chatManager.setConnectivityState(true);
        }
      } else {
        statusDiv.textContent = `✗ 失败 (${data.latencyMs}ms) - ${data.message}`;
        statusDiv.className = 'text-xs text-error';
        if (window.chatManager) {
          window.chatManager.setConnectivityState(false);
        }
      }
    }
  } catch (err) {
    const error = err as Error;
    if (statusDiv) {
      statusDiv.textContent = `✗ 错误 - ${error.message}`;
      statusDiv.className = 'text-xs text-error';
    }
    if (window.chatManager) {
      window.chatManager.setConnectivityState(false);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '重新测试';
    }
  }
}

async function testAI(): Promise<void> {
  const btn = document.getElementById('test-ai-btn');
  const resultDiv = document.getElementById('ai-test-result');
  const visionStatus = document.getElementById('vision-status');
  const visionTime = document.getElementById('vision-time');
  const visionIntro = document.getElementById('vision-intro');
  const decisionStatus = document.getElementById('decision-status');
  const decisionTime = document.getElementById('decision-time');
  const decisionIntro = document.getElementById('decision-intro');
  if (btn) btn.disabled = true;
  if (btn) btn.textContent = '测试中...';
  if (resultDiv) resultDiv.style.display = 'block';
  if (visionStatus) {
    visionStatus.textContent = '测试中...';
    visionStatus.style.color = 'var(--text-muted)';
  }
  if (visionTime) visionTime.textContent = '';
  if (visionIntro) visionIntro.textContent = '';
  if (decisionStatus) {
    decisionStatus.textContent = '测试中...';
    decisionStatus.style.color = 'var(--text-muted)';
  }
  if (decisionTime) decisionTime.textContent = '';
  if (decisionIntro) decisionIntro.textContent = '';
  appendLog('info', '开始测试 AI 连通性...');
  try {
    const response = await fetch('/debug/api/test-ai', {
      method: 'POST',
    });
    const data: AITestResponse = await response.json();
    if (data.vision && visionStatus) {
      const isConnected = data.vision.status === 'connected';
      visionStatus.textContent = isConnected
        ? '✓ 已连接'
        : '✗ ' + (data.vision.status === 'not_configured' ? '未配置' : '连接失败');
      visionStatus.style.color = isConnected ? 'var(--accent-success)' : 'var(--accent-error)';
      if (visionTime)
        visionTime.textContent = data.vision.responseTime ? `${data.vision.responseTime}ms` : '';
      if (visionIntro && data.vision.intro) visionIntro.textContent = data.vision.intro;
      if (visionIntro && data.vision.error) visionIntro.textContent = data.vision.error;
      if (typeof addAICallLog === 'function') {
        addAICallLog({
          type: 'test',
          modelType: 'vision',
          provider: data.vision.provider || '',
          model: data.vision.model || '',
          input: '连通性测试',
          output: data.vision.intro,
          responseTime: data.vision.responseTime,
          success: isConnected,
          error: data.vision.error,
        });
      }
    }
    if (data.decision && decisionStatus) {
      const isConnected = data.decision.status === 'connected';
      decisionStatus.textContent = isConnected
        ? '✓ 已连接'
        : '✗ ' + (data.decision.status === 'not_configured' ? '未配置' : '连接失败');
      decisionStatus.style.color = isConnected ? 'var(--accent-success)' : 'var(--accent-error)';
      if (decisionTime)
        decisionTime.textContent = data.decision.responseTime
          ? `${data.decision.responseTime}ms`
          : '';
      if (decisionIntro && data.decision.intro) decisionIntro.textContent = data.decision.intro;
      if (decisionIntro && data.decision.error) decisionIntro.textContent = data.decision.error;
      if (typeof addAICallLog === 'function') {
        addAICallLog({
          type: 'test',
          modelType: 'decision',
          provider: data.decision.provider || '',
          model: data.decision.model || '',
          input: '连通性测试',
          output: data.decision.intro,
          responseTime: data.decision.responseTime,
          success: isConnected,
          error: data.decision.error,
        });
      }
    }
    if (data.vision?.status === 'connected' && data.decision?.status === 'connected') {
      showSuccess('AI 连通性测试成功');
    } else {
      showWarning('AI 连通性测试部分失败');
    }
  } catch (err) {
    console.error('AI test failed:', err);
    const error = err as Error & { message?: string };
    if (visionStatus) {
      visionStatus.textContent = '✗ 错误';
      visionStatus.style.color = 'var(--accent-error)';
    }
    if (visionTime) visionTime.textContent = '';
    if (visionIntro) visionIntro.textContent = error.message || '未知错误';
    if (decisionStatus) {
      decisionStatus.textContent = '✗ 错误';
      decisionStatus.style.color = 'var(--accent-error)';
    }
    if (decisionTime) decisionTime.textContent = '';
    if (decisionIntro) decisionIntro.textContent = error.message || '未知错误';
    showError('AI 连通性测试失败: ' + (error.message || '未知错误'));
    if (typeof addAICallLog === 'function') {
      addAICallLog({
        type: 'test',
        modelType: 'vision',
        input: '连通性测试',
        error: error.message || '未知错误',
        success: false,
      });
      addAICallLog({
        type: 'test',
        modelType: 'decision',
        input: '连通性测试',
        error: error.message || '未知错误',
        success: false,
      });
    }
  } finally {
    if (btn) btn.disabled = false;
    if (btn) btn.textContent = '测试 AI 连通性';
  }
}

// History Fetching
export async function fetchHistory(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch('/debug/api/tasks', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`历史记录加载失败: HTTP ${res.status}`);
    }

    const data = await res.json();
    renderHistory(data.tasks || []);
  } catch (e) {
    let errorMsg = '历史记录加载失败';
    const error = e as Error & { name?: string; message?: string };
    if (error.name === 'AbortError') {
      errorMsg = '历史记录加载超时，请检查服务状态';
    } else if (error.message) {
      errorMsg = error.message;
    }
    console.error('Failed to fetch history:', error);
    const taskList = document.getElementById('taskList');
    if (taskList) {
      taskList.innerHTML = `<div class="empty-state">${errorMsg}</div>`;
    }
    showError(errorMsg);
  }
}

function renderHistory(tasks: TaskRecord[]): void {
  const display = document.getElementById('taskList');
  if (!display) return;

  if (!tasks || tasks.length === 0) {
    display.innerHTML =
      '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">暂无任务记录</div></div>';
    return;
  }

  let html = '';
  tasks.forEach((task) => {
    const statusClass = task.status;
    const statusText =
      task.status === 'completed' ? '完成' : task.status === 'failed' ? '失败' : '运行中';
    const time = new Date(task.startTime).toLocaleString();
    html += `<div class="task-item ${statusClass}" onclick="showTaskDetail('${task.taskId}')">
            <div class="task-title">${task.instruction.substring(0, 50)}${task.instruction.length > 50 ? '...' : ''}</div>
            <div class="task-meta">
                <span>${statusText}</span>
                <span>•</span>
                <span>${time}</span>
                <span>•</span>
                <span>${task.stepCount} 步</span>
            </div>
        </div>`;
  });
  display.innerHTML = html;
}

async function fetchMCPTools(serverName: string): Promise<void> {
  try {
    appendLog('info', `获取 MCP 工具列表: ${serverName}...`);
    const res = await fetch('/debug/api/mcp/tools');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data: MCPToolsResponse = await res.json();
    const tools = data.tools || [];
    const serverTools = tools.filter((t) => t.name.startsWith(serverName + '.'));
    showMCPToolsModal(serverName, serverTools);
  } catch (e) {
    console.error('Failed to fetch MCP tools:', e);
    const error = e as Error & { message?: string };
    showError('获取 MCP 工具失败: ' + (error.message || '未知错误'));
  }
}

function showMCPToolsModal(serverName: string, tools: MCPTool[]): void {
  const existingModal = document.getElementById('mcp-tools-modal');
  if (existingModal) {
    existingModal.remove();
  }
  const modal = document.createElement('div');
  modal.id = 'mcp-tools-modal';
  modal.className = 'modal-overlay';
  modal.style.cssText =
    'display: flex; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 1000; align-items: center; justify-content: center;';
  let toolsHtml = '';
  if (tools.length > 0) {
    tools.forEach((tool, index) => {
      const shortName = tool.name.replace(serverName + '.', '');
      const schema = tool.inputSchema || {};
      const props = schema.properties || {};
      const required = schema.required || [];
      let paramsHtml = '';
      if (Object.keys(props).length > 0) {
        paramsHtml =
          '<div style="margin-top: 8px; padding: 8px; background: var(--bg-primary); border-radius: 4px; font-size: 11px;">';
        paramsHtml += '<div style="color: var(--text-secondary); margin-bottom: 4px;">参数:</div>';
        Object.entries(props).forEach(([key, val]) => {
          const isRequired = required.includes(key);
          const type = val.type || 'any';
          const desc = val.description || '';
          paramsHtml += `<div style="margin: 4px 0;">
                        <span style="color: var(--accent);">${key}</span>
                        ${isRequired ? '<span style="color: var(--accent-error);">*</span>' : ''}
                        <span style="color: var(--text-muted);">(${type})</span>
                        ${desc ? `<span style="color: var(--text-muted);"> - ${desc}</span>` : ''}
                    </div>`;
        });
        paramsHtml += '</div>';
      }
      toolsHtml += `<div class="mcp-tool-item" data-tool-index="${index}" style="padding: 12px; margin: 8px 0; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleToolParams(${index})">
                    <div>
                        <div style="font-weight: 500; color: var(--text-primary);">${shortName}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${tool.description || '无描述'}</div>
                    </div>
                    <span class="expand-icon" style="color: var(--text-muted);">▼</span>
                </div>
                <div class="tool-params" style="display: none; margin-top: 8px;">
                    ${paramsHtml}
                    <div style="margin-top: 8px;">
                        <textarea id="mcp-args-${index}" rows="3" style="width: 100%; font-size: 11px; padding: 6px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); resize: vertical;" placeholder="JSON 参数...">{}</textarea>
                    </div>
                    <div style="margin-top: 8px; display: flex; gap: 8px;">
                        <button onclick="executeMCPTool('${serverName}', '${shortName}', ${index})" class="text-12" style="flex: 1; padding: 6px;">执行</button>
                    </div>
                </div>
            </div>`;
    });
  } else {
    toolsHtml = '<div class="text-muted text-xs">该服务器暂无可用工具</div>';
  }
  modal.innerHTML = `<div class="modal-container" style="max-width: 600px; max-height: 85vh; overflow-y: auto;">
        <div class="modal-header">
            <h3>MCP 工具 - ${serverName}</h3>
            <button class="modal-close" onclick="closeMCPToolsModal()">×</button>
        </div>
        <div class="modal-body" id="mcp-tools-body">
            ${toolsHtml}
        </div>
        <div id="mcp-result-area" style="display: none; padding: 12px; border-top: 1px solid var(--border-color);">
            <div style="font-weight: 500; margin-bottom: 8px;">执行结果:</div>
            <pre id="mcp-result-content" style="max-height: 200px; overflow: auto; font-size: 11px; padding: 8px; background: var(--bg-primary); border-radius: 4px; white-space: pre-wrap; word-break: break-all;"></pre>
        </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeMCPToolsModal();
    }
  });
}

function toggleToolParams(index: number): void {
  const item = document.querySelector(`.mcp-tool-item[data-tool-index="${index}"]`);
  if (!item) return;
  const params = item.querySelector('.tool-params');
  const icon = item.querySelector('.expand-icon');
  if (params && icon) {
    if (params.style.display === 'none') {
      params.style.display = 'block';
      icon.textContent = '▲';
    } else {
      params.style.display = 'none';
      icon.textContent = '▼';
    }
  }
}

async function executeMCPTool(serverName: string, toolName: string, index: number): Promise<void> {
  const argsInput = document.getElementById(`mcp-args-${index}`);
  let args: Record<string, unknown> = {};
  if (argsInput && argsInput instanceof HTMLTextAreaElement && argsInput.value.trim()) {
    try {
      args = JSON.parse(argsInput.value);
    } catch (e) {
      showError('参数格式错误，请输入有效的 JSON');
      return;
    }
  }
  const resultArea = document.getElementById('mcp-result-area');
  const resultContent = document.getElementById('mcp-result-content');
  if (resultArea) resultArea.style.display = 'block';
  if (resultContent) resultContent.textContent = '执行中...';
  try {
    appendLog('info', `调用 MCP 工具: ${serverName}.${toolName}`);
    const res = await fetch('/debug/api/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: serverName, tool: toolName, args }),
    });
    const data: MCPExecuteResponse = await res.json();
    if (data.success) {
      const resultText =
        typeof data.result === 'object'
          ? JSON.stringify(data.result, null, 2)
          : String(data.result);
      if (resultContent) resultContent.textContent = resultText.substring(0, 5000);
      appendLog('success', `MCP 调用成功`);
      showSuccess('MCP 工具调用成功');
    } else {
      if (resultContent) resultContent.textContent = '错误: ' + data.error;
      appendLog('error', `MCP 调用失败: ${data.error}`);
      showError('MCP 工具调用失败: ' + data.error);
    }
  } catch (e) {
    console.error('MCP call failed:', e);
    const error = e as Error & { message?: string };
    if (resultContent) resultContent.textContent = '错误: ' + (error.message || '未知错误');
    showError('MCP 调用失败: ' + (error.message || '未知错误'));
  }
}

function closeMCPToolsModal(): void {
  const modal = document.getElementById('mcp-tools-modal');
  if (modal) {
    modal.remove();
  }
}

function updateMCPStatus(mcpStatus: MCPStatus): void {
  if (!mcpStatus) return;
  const configDisplay = document.getElementById('configDisplay');
  if (!configDisplay) return;
  const mcpSection = configDisplay.querySelector('.mcp-status-section');
  if (mcpSection) {
    let html = '';
    if (mcpStatus.enabled) {
      const servers = mcpStatus.servers || [];
      if (servers.length > 0) {
        servers.forEach((server) => {
          const statusClass = server.running ? 'healthy' : 'unhealthy';
          const statusText = server.running ? '运行中' : '已停止';
          html += `<div class="service-status">
                        <div class="service-indicator ${statusClass}"></div>
                        <div class="flex-1">
                            <div class="service-name">${server.name}</div>
                            <div class="service-url">${statusText} · ${server.toolsCount} 工具</div>
                        </div>
                        <button onclick="fetchMCPTools('${server.name}')" class="text-12 px-2">查看工具</button>
                    </div>`;
        });
      } else {
        html = '<div class="text-muted text-xs">无已启用的 MCP 服务器</div>';
      }
    } else {
      html = '<div class="text-muted text-xs">MCP 未启用</div>';
    }
    mcpSection.innerHTML = html;
  }
}

async function showTaskDetail(taskId: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`/debug/api/tasks/${taskId}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`任务详情加载失败: HTTP ${res.status}`);
    }

    const task: TaskDetail = await res.json();
    renderTaskDetail(task);
  } catch (e) {
    let errorMsg = '获取任务详情失败';
    const error = e as Error & { name?: string; message?: string };
    if (error.name === 'AbortError') {
      errorMsg = '任务详情加载超时，请检查服务状态';
    } else if (error.message) {
      errorMsg = error.message;
    }
    console.error('Failed to fetch task detail:', error);
    showError(errorMsg);
  }
}

function renderTaskDetail(task: TaskDetail): void {
  const display = document.getElementById('logDisplay');
  if (!display) return;

  const emptyState = display.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  let html = `<div class="mb-4 p-3 bg-dark border-dark rounded">
        <div class="text-cyan text-sm mb-3">任务详情</div>
        <div class="text-12 leading-relaxed">
            <div><span class="text-muted">ID:</span> ${task.taskId}</div>
            <div><span class="text-muted">URL:</span> ${task.url}</div>
            <div><span class="text-muted">指令:</span> ${task.instruction}</div>
            <div><span class="text-muted">状态:</span> <span class="${task.status}">${task.status}</span></div>
            <div><span class="text-muted">开始时间:</span> ${new Date(task.startTime).toLocaleString()}</div>
            ${task.endTime ? `<div><span class="text-muted">结束时间:</span> ${new Date(task.endTime).toLocaleString()}</div>` : ''}
            ${task.result ? `<div><span class="text-muted">结果:</span> ${task.result}</div>` : ''}
            ${task.error ? `<div><span class="text-muted">错误:</span> <span class="error">${task.error}</span></div>` : ''}
        </div>
    </div>`;

  if (task.steps && task.steps.length > 0) {
    html += `<div class="mt-3">
            <div class="text-cyan text-sm mb-3">执行步骤</div>`;
    task.steps.forEach((step) => {
      html += `<div class="step-item ${step.success ? 'success' : 'failed'}">
                <div><span class="text-muted">步骤 ${step.step}:</span> ${step.action.type}</div>
                <div class="text-muted text-xs">${step.message}</div>
                <div class="text-muted text-xs">${new Date(step.timestamp).toLocaleTimeString()}</div>
            </div>`;
    });
    html += `</div>`;
  }

  display.innerHTML = html;
}

if (typeof window !== 'undefined') {
  window.fetchConfig = fetchConfig;
  window.fetchHistory = fetchHistory;
  window.fetchMCPTools = fetchMCPTools;
  window.toggleToolParams = toggleToolParams;
  window.executeMCPTool = executeMCPTool;
  window.closeMCPToolsModal = closeMCPToolsModal;
  window.showTaskDetail = showTaskDetail;
  window.testConnectivity = testConnectivity;
}
