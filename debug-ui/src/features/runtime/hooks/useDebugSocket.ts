import { useCallback, useEffect, useRef } from 'react';
import { useControlStore } from '@/features/playwright-control/store/control.store.js';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';
import { queryClient } from '@/shared/query/query-client.js';
import { queryKeys } from '@/shared/query/query-keys.js';

interface ServiceStatusPayload {
  playwright?: {
    isOpen: boolean;
    url?: string;
    status?: 'healthy' | 'unhealthy';
    viewport?: { width: number; height: number };
  };
  mcp?: unknown;
}

interface ParsedMessage {
  type: string;
  [key: string]: unknown;
}

const BASE_RECONNECT_INTERVAL = 1000;
const MAX_RECONNECT_INTERVAL = 30000;
const MAX_RECONNECT_ATTEMPTS = 5;

const sharedHandlers = new Set<(data: unknown) => void>();

let sharedWs: WebSocket | null = null;
let sharedReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let sharedReconnectAttempt = 0;
let sharedManualClose = false;
let sharedConsumerCount = 0;

export interface UseDebugSocketReturn {
  sendMessage: (type: string, data?: Record<string, unknown>) => void;
  pauseTask: () => void;
  resumeTask: () => void;
  singleStep: () => void;
  disconnect: () => void;
  reconnect: () => void;
  onMessage: (handler: (data: unknown) => void) => () => void;
}

function buildWsUrl(): string {
  const protocol = globalThis.location?.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = globalThis.location?.host ?? 'localhost:3000';
  return `${protocol}//${host}/ws/debug`;
}

function computeBackoff(attempt: number): number {
  const base = Math.min(
    BASE_RECONNECT_INTERVAL * Math.pow(1.5, attempt - 1),
    MAX_RECONNECT_INTERVAL
  );
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

function clearSharedReconnectTimer() {
  if (sharedReconnectTimer !== null) {
    clearTimeout(sharedReconnectTimer);
    sharedReconnectTimer = null;
  }
}

function syncPlaywrightState(payload: ServiceStatusPayload['playwright']) {
  if (!payload) {
    return;
  }

  const runtime = useRuntimeStore.getState();
  const control = useControlStore.getState();

  runtime.setPlaywrightIsOpen(payload.isOpen);
  control.setBrowserOpen(payload.isOpen);

  if (payload.url !== undefined) {
    runtime.setPlaywrightUrl(payload.url);
    control.setBrowserUrl(payload.url ?? '');
  }

  if (payload.status !== undefined) {
    runtime.setPlaywrightStatus(payload.status === 'healthy' ? 'ready' : 'unhealthy');
  }

  if (payload.viewport) {
    control.setViewport(payload.viewport);
  }
}

function dispatchToStores(msg: ParsedMessage): void {
  if (msg.type === 'service_status' && msg.services) {
    const services = msg.services as ServiceStatusPayload;
    syncPlaywrightState(services.playwright);

    if (services.mcp) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcp.status });
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcp.tools });
    }
    return;
  }

  const runtime = useRuntimeStore.getState();

  switch (msg.type) {
    case 'connected':
      runtime.addExecutionMessage({
        type: 'info',
        text: `服务器: ${msg.message || '连接确认'}`,
        timestamp: Date.now(),
      });
      break;
    case 'task_created': {
      const task = msg.task as Record<string, unknown> | undefined;
      runtime.addExecutionMessage({
        type: 'info',
        text: `任务创建: ${task?.id ?? ''}`,
        timestamp: Date.now(),
      });
      break;
    }
    case 'task_started':
      runtime.addExecutionMessage({
        type: 'info',
        text: `任务开始: ${msg.taskId ?? ''}`,
        timestamp: Date.now(),
      });
      break;
    case 'task_status':
      runtime.addExecutionMessage({
        type: 'info',
        text: `任务状态: ${msg.status ?? ''}`,
        timestamp: Date.now(),
      });
      break;
    case 'step_completed':
      runtime.addExecutionMessage({ type: 'success', text: '步骤完成', timestamp: Date.now() });
      break;
    case 'task_completed':
      runtime.addExecutionMessage({ type: 'success', text: '任务执行完成', timestamp: Date.now() });
      break;
    case 'task_failed': {
      const errorMsg = typeof msg.error === 'string' ? msg.error : '任务执行失败';
      runtime.addExecutionMessage({
        type: 'error',
        text: `任务失败: ${errorMsg}`,
        timestamp: Date.now(),
      });
      break;
    }
    case 'task_cancelled':
      runtime.addExecutionMessage({ type: 'warning', text: '任务已取消', timestamp: Date.now() });
      break;
    case 'task_paused':
      runtime.addExecutionMessage({ type: 'warning', text: '任务已暂停', timestamp: Date.now() });
      break;
    case 'task_resumed':
      runtime.addExecutionMessage({ type: 'info', text: '任务已继续', timestamp: Date.now() });
      break;
    case 'action_added': {
      const action = msg.action as Record<string, unknown> | undefined;
      runtime.addExecutionMessage({
        type: 'info',
        text: `操作记录: ${action?.type ?? ''}`,
        timestamp: Date.now(),
      });
      break;
    }
    case 'manual_action_started': {
      const action = msg.action as Record<string, unknown> | undefined;
      runtime.addExecutionMessage({
        type: 'info',
        text: `手动操作: ${action?.type ?? ''}`,
        timestamp: Date.now(),
      });
      break;
    }
    case 'error': {
      const serverErrorMsg = typeof msg.message === 'string' ? msg.message : '服务器发生未知错误';
      runtime.addExecutionMessage({
        type: 'error',
        text: `服务器错误: ${serverErrorMsg}`,
        timestamp: Date.now(),
      });
      break;
    }
    default:
      break;
  }
}

function notifyHandlers(data: unknown) {
  for (const handler of sharedHandlers) {
    handler(data);
  }
}

function handleSocketMessage(event: MessageEvent) {
  let parsed: ParsedMessage;
  try {
    parsed = JSON.parse(event.data as string) as ParsedMessage;
  } catch {
    return;
  }

  if (!parsed || typeof parsed.type !== 'string') {
    return;
  }

  dispatchToStores(parsed);
  notifyHandlers(parsed);
}

function connectSharedSocket() {
  clearSharedReconnectTimer();

  if (sharedConsumerCount <= 0) {
    return;
  }

  if (
    sharedWs &&
    (sharedWs.readyState === WebSocket.OPEN || sharedWs.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  sharedManualClose = false;
  useRuntimeStore.getState().setConnectionStatus('connecting');
  useRuntimeStore
    .getState()
    .addExecutionMessage({ type: 'info', text: '正在连接 WebSocket...', timestamp: Date.now() });

  const ws = new WebSocket(buildWsUrl());
  sharedWs = ws;

  ws.onopen = () => {
    if (sharedWs !== ws) {
      return;
    }

    useRuntimeStore.getState().setConnectionStatus('connected');
    useRuntimeStore.getState().resetReconnectAttempt();
    sharedReconnectAttempt = 0;
    useRuntimeStore
      .getState()
      .addExecutionMessage({ type: 'success', text: 'WebSocket 连接成功', timestamp: Date.now() });
  };

  ws.onmessage = handleSocketMessage;

  ws.onclose = () => {
    if (sharedWs === ws) {
      sharedWs = null;
    }

    useRuntimeStore.getState().setConnectionStatus('disconnected');
    useRuntimeStore
      .getState()
      .addExecutionMessage({ type: 'warning', text: 'WebSocket 连接断开', timestamp: Date.now() });

    if (sharedManualClose || sharedConsumerCount <= 0) {
      return;
    }

    sharedReconnectAttempt += 1;
    if (sharedReconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
      useRuntimeStore
        .getState()
        .addExecutionMessage({ type: 'error', text: '重连失败，已放弃', timestamp: Date.now() });
      return;
    }

    useRuntimeStore.getState().setConnectionStatus('reconnecting');
    useRuntimeStore.getState().setReconnectAttempt(sharedReconnectAttempt);
    useRuntimeStore.getState().addExecutionMessage({
      type: 'warning',
      text: `正在重连 (${sharedReconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})...`,
      timestamp: Date.now(),
    });

    sharedReconnectTimer = setTimeout(() => {
      if (!sharedManualClose && sharedConsumerCount > 0) {
        connectSharedSocket();
      }
    }, computeBackoff(sharedReconnectAttempt));
  };

  ws.onerror = () => {
    useRuntimeStore
      .getState()
      .addExecutionMessage({ type: 'error', text: 'WebSocket 连接错误', timestamp: Date.now() });
  };
}

function closeSharedSocket(manualClose: boolean) {
  sharedManualClose = manualClose;
  clearSharedReconnectTimer();

  if (sharedWs) {
    sharedWs.close();
    sharedWs = null;
  }

  useRuntimeStore.getState().setConnectionStatus('disconnected');
  useRuntimeStore.getState().resetReconnectAttempt();
  sharedReconnectAttempt = 0;
}

export function useDebugSocket(): UseDebugSocketReturn {
  const mountedRef = useRef(true);

  const sendMessage = useCallback((type: string, data?: Record<string, unknown>) => {
    const whitelist = [
      'pause',
      'resume',
      'step',
      'start',
      'stop',
      'cancel',
      'status',
      'ping',
      'config',
      'command',
    ];
    if (!whitelist.includes(type)) {
      console.warn(`WebSocket command '${type}' is not in whitelist.`);
      return;
    }
    const ws = sharedWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, ...data }));
  }, []);

  const pauseTask = useCallback(() => sendMessage('pause'), [sendMessage]);
  const resumeTask = useCallback(() => sendMessage('resume'), [sendMessage]);
  const singleStep = useCallback(() => sendMessage('step'), [sendMessage]);

  const disconnect = useCallback(() => {
    closeSharedSocket(true);
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    sharedManualClose = false;
    connectSharedSocket();
  }, [disconnect]);

  const onMessage = useCallback((handler: (data: unknown) => void) => {
    sharedHandlers.add(handler);
    return () => {
      sharedHandlers.delete(handler);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    sharedConsumerCount += 1;
    connectSharedSocket();

    return () => {
      mountedRef.current = false;
      sharedConsumerCount = Math.max(0, sharedConsumerCount - 1);
      if (sharedConsumerCount === 0) {
        closeSharedSocket(true);
      }
    };
  }, []);

  return { sendMessage, pauseTask, resumeTask, singleStep, disconnect, reconnect, onMessage };
}
