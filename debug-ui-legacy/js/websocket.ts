/// <reference types="dom" />
// WebSocket 管理模块
// 处理 WebSocket 连接、消息接收、任务控制等功能

interface WebSocketMessage {
  type: string;
  message?: string;
  services?: ServiceStatus;
  taskId?: string;
  screenshot?: string;
  viewport?: Viewport;
  action?: string;
  result?: unknown;
  error?: string;
  sessions?: unknown;
}

interface ServiceStatus {
  playwright?: {
    isOpen: boolean;
    url?: string;
    title?: string;
    status: 'healthy' | 'unhealthy';
  };
  mcp?: MCPStatus;
}

interface MCPStatus {
  enabled: boolean;
  servers: Array<{
    name: string;
    running: boolean;
    toolsCount: number;
  }>;
}

import {
  appendLog,
  updateStatus,
  showSuccess,
  showWarning,
  showError,
  updateScreenshots,
  updateDecisions,
  updatePlaywrightStatus,
  updateServiceStatusUI,
} from './ui.js';
import { fetchHistory } from './config.js';
import type { Viewport } from './ui.js';

function updateMCPStatus(mcp: MCPStatus): void {
  const configDisplay = document.getElementById('configDisplay');
  if (!configDisplay) return;
  const mcpSection = configDisplay.querySelector('.mcp-status-section');
  if (!mcpSection) return;
  if (mcp.enabled && mcp.servers && mcp.servers.length > 0) {
    let html = '';
    mcp.servers.forEach((server) => {
      const indicatorClass = server.running ? 'healthy' : 'unhealthy';
      html += `<div class="service-status">
                <div class="service-indicator ${indicatorClass}"></div>
                <div class="flex-1">
                    <div class="service-name">${server.name}</div>
                    <div class="service-url">${server.toolsCount} tools</div>
                </div>
            </div>`;
    });
    mcpSection.innerHTML = html;
  } else {
    mcpSection.innerHTML = '<div class="text-muted text-xs">MCP 未启用</div>';
  }
}

// --- WebSocket 连接状态管理 ---
let ws: WebSocket | null = null;
let isManualClose = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const baseReconnectInterval = 1000;
const maxReconnectInterval = 30000;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let currentTaskId: string | null = null;
let isServiceReady = false;

// 允许的命令白名单
const ALLOWED_COMMANDS = [
  'pause',
  'resume',
  'step',
  'start',
  'stop',
  'cancel',
  'status',
  'ping',
  'config',
];

function connectWebSocket(): void {
  // 清理之前的重连定时器
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // 重置手动关闭标志
  isManualClose = false;
  if (ws) {
    ws.close();
    ws = null;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const wsUrl = `${protocol}//${host}/ws/debug`;

  appendLog('info', `正在连接 WebSocket: ${wsUrl}...`);
  updateStatus(false, 'connecting', '连接中...');

  ws = new WebSocket(wsUrl);
  // 更新全局 ws 引用，供 chat.ts 使用
  (window as unknown as Record<string, unknown>).ws = ws;

  ws.onopen = () => {
    appendLog('success', 'WebSocket 连接成功');
    showSuccess('WebSocket 连接成功');
    reconnectAttempts = 0;
    isServiceReady = false;
    updateStatus(true, 'connecting', '等待服务就绪...');
  };

  ws.onmessage = handleWebSocketMessage;

  ws.onclose = () => {
    appendLog('warning', 'WebSocket 连接断开');
    showWarning('WebSocket 连接断开，正在尝试重连...');
    updateStatus(false, 'disconnected', '已断开');
    ws = null;
    currentTaskId = null;
    if (!isManualClose && reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      // 指数退避 + jitter
      let delay = Math.min(
        baseReconnectInterval * Math.pow(1.5, reconnectAttempts - 1),
        maxReconnectInterval
      );
      delay = delay * (0.8 + Math.random() * 0.4); // jitter ±20%
      delay = Math.round(delay);

      appendLog(
        'info',
        `尝试重连 (${reconnectAttempts}/${maxReconnectAttempts}) in ${(delay / 1000).toFixed(1)}s...`
      );
      reconnectTimer = setTimeout(connectWebSocket, delay);
    } else if (isManualClose) {
      appendLog('info', '主动关闭连接，不自动重连');
    } else {
      const errorMsg = '重连失败。可调用 cancelReconnect() 取消或刷新页面重试';
      appendLog('error', errorMsg);
      showError(errorMsg, 0);
    }
  };

  ws.onerror = (error: Event) => {
    console.error('WebSocket error:', error);
    const errorMsg = 'WebSocket 连接发生错误，请检查网络连接';
    appendLog('error', errorMsg);
    showError(errorMsg);
  };
}

function handleWebSocketMessage(event: MessageEvent): void {
  let data: WebSocketMessage;
  try {
    data = JSON.parse(event.data) as WebSocketMessage;
  } catch (e) {
    const rawPreview =
      typeof event.data === 'string'
        ? event.data.substring(0, 100)
        : String(event.data).substring(0, 100);
    const errorMsg = e instanceof Error ? e.message : '未知错误';
    const parseErrorMsg = `解析服务器消息失败: ${errorMsg} (数据: ${rawPreview}...)`;
    appendLog('error', parseErrorMsg);
    showError(parseErrorMsg);
    return;
  }

  // 验证消息基本结构
  if (!data || typeof data.type !== 'string') {
    appendLog('warning', `收到无效消息: ${JSON.stringify(data).substring(0, 100)}`);
    return;
  }

  switch (data.type) {
    case 'connected':
      appendLog('info', `服务器: ${data.message || '连接确认'}`);
      break;
    case 'service_status':
      if (data.services) {
        handleServiceStatus(data.services);
      }
      break;
    case 'task_started':
      if (data.taskId) {
        currentTaskId = data.taskId;
        appendLog('info', `任务开始: ${data.taskId}`);
        showSuccess(`任务开始: ${data.taskId}`);
      }
      break;
    case 'step_completed':
      appendLog('success', `步骤完成`);
      if (data.screenshot) {
        updateScreenshots(data.screenshot, data.viewport);
      }
      if (data.action) {
        updateDecisions(data.action);
      }
      break;
    case 'task_completed':
      appendLog('success', `任务完成: ${JSON.stringify(data.result)}`);
      showSuccess('任务执行完成');
      currentTaskId = null;
      fetchHistory();
      break;
    case 'task_failed': {
      const errorMsg = data.error || '任务执行失败';
      appendLog('error', `任务失败: ${errorMsg}`);
      showError(`任务失败: ${errorMsg}`);
      currentTaskId = null;
      fetchHistory();
      break;
    }
    case 'task_cancelled':
      appendLog('warning', '任务已取消');
      showWarning('任务已取消');
      currentTaskId = null;
      break;
    case 'task_paused':
      appendLog('warning', '任务已暂停');
      showWarning('任务已暂停');
      break;
    case 'task_resumed':
      appendLog('info', '任务已继续');
      showSuccess('任务已继续');
      break;
    case 'ack':
      break;
    case 'ping':
      // ✅ Respond to server heartbeat
      sendWsMessage('pong');
      break;
    case 'chat_stream_start':
    case 'chat_stream_token':
    case 'chat_stream_thinking':
    case 'chat_stream_tool_call':
    case 'chat_stream_end':
    case 'chat_stream_error':
    case 'session.snapshot':
    case 'message.created':
    case 'assistant.started':
    case 'assistant.delta':
    case 'assistant.completed':
    case 'assistant.thinking':
    case 'assistant.tool_call':
    case 'assistant.tool_result':
    case 'run.error':
      if (window.chatManager) {
        window.chatManager.handleStream(data);
      }
      break;
    case 'chat_session_update':
      if (window.chatManager) {
        window.chatManager.sessions = (data.sessions || []) as unknown[];
        window.chatManager.renderSessionList();
      }
      break;
    case 'error': {
      const serverErrorMsg = data.message || '服务器发生未知错误';
      appendLog('error', `服务器错误: ${serverErrorMsg}`);
      showError(`服务器错误: ${serverErrorMsg}`);
      break;
    }
    default:
      break;
  }
}

function handleServiceStatus(services: ServiceStatus): void {
  if (!services) return;

  if (!isServiceReady) {
    isServiceReady = true;
    updateStatus(true, 'ready', '服务就绪');
  }

  if (typeof updatePlaywrightStatus === 'function' && services.playwright !== undefined) {
    updatePlaywrightStatus(services.playwright);
  }
  if (typeof updateServiceStatusUI === 'function') {
    updateServiceStatusUI(services);
  }
  if (services.mcp && typeof updateMCPStatus === 'function') {
    updateMCPStatus(services.mcp);
  }
}

function sendWsMessage(type: string, data: Record<string, unknown> = {}): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    const errorMsg = 'WebSocket 未连接，无法发送指令';
    appendLog('error', errorMsg);
    showError(errorMsg);
    return;
  }
  try {
    ws.send(JSON.stringify({ type, ...data }));
  } catch (e) {
    const sendErrorMsg = '发送指令失败';
    appendLog('error', sendErrorMsg);
    showError(sendErrorMsg);
  }
}

// --- 按钮事件处理 ---
function refreshStatus(): void {
  reconnectAttempts = 0;
  // 标记为主动关闭，避免触发自动重连
  if (ws && ws.readyState === WebSocket.OPEN) {
    isManualClose = true;
  }
  connectWebSocket();
}

function disconnect(): void {
  if (ws) {
    isManualClose = true;
    ws.close();
    ws = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  currentTaskId = null;
  updateStatus(false, 'disconnected', '已断开');
}

function cancelReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  appendLog('info', '已取消重连');
  updateStatus(false, 'disconnected', '已断开（已取消重连）');
}

function pauseTask(): void {
  if (!currentTaskId) {
    appendLog('warning', '无运行中的任务');
    return;
  }
  sendWsMessage('pause', { taskId: currentTaskId });
}

function resumeTask(): void {
  if (!currentTaskId) {
    appendLog('warning', '无运行中的任务');
    return;
  }
  sendWsMessage('resume', { taskId: currentTaskId });
}

function singleStep(): void {
  if (!currentTaskId) {
    appendLog('warning', '无运行中的任务');
    return;
  }
  sendWsMessage('step', { taskId: currentTaskId });
}

function sendCommand(): void {
  const input = document.getElementById('customCommand') as HTMLInputElement;
  const cmdStr = input.value.trim();
  if (!cmdStr) return;

  const firstSpace = cmdStr.indexOf(' ');
  const command = firstSpace > 0 ? cmdStr.substring(0, firstSpace) : cmdStr;
  const rest = firstSpace > 0 ? cmdStr.substring(firstSpace + 1) : '';

  // 处理特殊命令
  if (command === 'pause') {
    pauseTask();
  } else if (command === 'resume') {
    resumeTask();
  } else if (command === 'step') {
    singleStep();
  } else {
    // 验证命令是否在白名单中
    if (!ALLOWED_COMMANDS.includes(command)) {
      appendLog('warning', `未知命令: ${command}。允许的命令: ${ALLOWED_COMMANDS.join(', ')}`);
      return;
    }
    // 通用命令：尝试 JSON 解析，失败则作为 data 字段
    let payload: Record<string, unknown> = {};
    if (rest) {
      try {
        payload = JSON.parse(rest);
      } catch {
        payload = { data: rest };
      }
    }
    sendWsMessage(command, payload);
  }

  input.value = '';
}

function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

// 导出到全局（用于初始化）
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).isConnected = isConnected;
  (window as unknown as Record<string, unknown>).connectWebSocket = connectWebSocket;
  (window as unknown as Record<string, unknown>).refreshStatus = refreshStatus;
  (window as unknown as Record<string, unknown>).disconnect = disconnect;
  (window as unknown as Record<string, unknown>).cancelReconnect = cancelReconnect;
  (window as unknown as Record<string, unknown>).pauseTask = pauseTask;
  (window as unknown as Record<string, unknown>).resumeTask = resumeTask;
  (window as unknown as Record<string, unknown>).singleStep = singleStep;
  (window as unknown as Record<string, unknown>).sendCommand = sendCommand;
  // 初始设置全局 ws 引用
  (window as unknown as Record<string, unknown>).ws = ws;
}

export {};
