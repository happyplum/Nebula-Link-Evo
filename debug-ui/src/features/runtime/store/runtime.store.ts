import { create } from 'zustand';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting';
export type ServiceStatus = 'unknown' | 'ready' | 'unhealthy';
export type LiveviewTransport = 'webrtc' | 'mjpeg';

export interface ExecutionMessage {
  type: 'info' | 'success' | 'warning' | 'error';
  text: string;
  timestamp: number;
}

interface RuntimeState {
  connectionStatus: ConnectionStatus;
  reconnectAttempt: number;
  playwrightStatus: ServiceStatus;
  playwrightIsOpen: boolean;
  playwrightUrl: string | null;
  snapshotVersion: number;
  liveviewRefreshKey: number;
  lastScreenshotDataUrl: string | null;
  executionMessages: ExecutionMessage[];
  liveviewTransport: LiveviewTransport;
  debugEnabled: boolean;

  setConnectionStatus: (status: ConnectionStatus) => void;
  setReconnectAttempt: (attempt: number) => void;
  incrementReconnectAttempt: () => void;
  resetReconnectAttempt: () => void;
  setPlaywrightStatus: (status: ServiceStatus) => void;
  setPlaywrightIsOpen: (isOpen: boolean) => void;
  setPlaywrightUrl: (url: string | null) => void;
  setSnapshotVersion: (version: number) => void;
  incrementSnapshotVersion: () => void;
  incrementLiveviewRefreshKey: () => void;
  setLastScreenshotDataUrl: (url: string | null) => void;
  addExecutionMessage: (message: ExecutionMessage) => void;
  setLiveviewTransport: (mode: LiveviewTransport) => void;
  toggleDebug: () => void;
  reset: () => void;
}

const persistedTransport = (() => {
  try {
    const v = localStorage.getItem('liveviewTransport');
    return v === 'mjpeg' || v === 'webrtc' ? v : 'webrtc';
  } catch {
    return 'webrtc' as const;
  }
})();

const persistedDebugEnabled = import.meta.env.DEV
  ? (() => {
      try {
        return localStorage.getItem('nle-debug-enabled') === 'true';
      } catch {
        return false;
      }
    })()
  : false;

const initialState = {
  connectionStatus: 'disconnected' as ConnectionStatus,
  reconnectAttempt: 0,
  playwrightStatus: 'unknown' as ServiceStatus,
  playwrightIsOpen: false,
  playwrightUrl: null as string | null,
  snapshotVersion: 0,
  liveviewRefreshKey: 0,
  lastScreenshotDataUrl: null as string | null,
  executionMessages: [] as ExecutionMessage[],
  liveviewTransport: persistedTransport as LiveviewTransport,
  debugEnabled: persistedDebugEnabled,
};

export const useRuntimeStore = create<RuntimeState>()((set) => ({
  ...initialState,
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setReconnectAttempt: (attempt) => set({ reconnectAttempt: attempt }),
  incrementReconnectAttempt: () => set((s) => ({ reconnectAttempt: s.reconnectAttempt + 1 })),
  resetReconnectAttempt: () => set({ reconnectAttempt: 0 }),
  setPlaywrightStatus: (status) => set({ playwrightStatus: status }),
  setPlaywrightIsOpen: (isOpen) => set({ playwrightIsOpen: isOpen }),
  setPlaywrightUrl: (url) => set({ playwrightUrl: url }),
  setSnapshotVersion: (version) => set({ snapshotVersion: version }),
  incrementSnapshotVersion: () => set((s) => ({ snapshotVersion: s.snapshotVersion + 1 })),
  incrementLiveviewRefreshKey: () => set((s) => ({ liveviewRefreshKey: s.liveviewRefreshKey + 1 })),
  setLastScreenshotDataUrl: (url) => set({ lastScreenshotDataUrl: url }),
  addExecutionMessage: (message) =>
    set((s) => ({ executionMessages: [...s.executionMessages, message].slice(-200) })),
  setLiveviewTransport: (mode) => {
    try {
      localStorage.setItem('liveviewTransport', mode);
    } catch {
      /* storage unavailable */
    }
    set({ liveviewTransport: mode });
  },
  toggleDebug: () => {
    const current = useRuntimeStore.getState().debugEnabled;
    const enabled = !current;
    set({ debugEnabled: enabled });

    if (import.meta.env.DEV) {
      try {
        localStorage.setItem('nle-debug-enabled', String(enabled));
      } catch {
        /* storage unavailable */
      }
    }
  },
  reset: () => set(initialState),
}));

// Selectors
export const selectConnectionStatus = (s: RuntimeState) => s.connectionStatus;
export const selectReconnectAttempt = (s: RuntimeState) => s.reconnectAttempt;
export const selectPlaywrightStatus = (s: RuntimeState) => s.playwrightStatus;
export const selectPlaywrightIsOpen = (s: RuntimeState) => s.playwrightIsOpen;
export const selectPlaywrightUrl = (s: RuntimeState) => s.playwrightUrl;
export const selectExecutionMessages = (s: RuntimeState) => s.executionMessages;
export const selectLiveviewTransport = (s: RuntimeState) => s.liveviewTransport;
export const selectLiveviewRefreshKey = (s: RuntimeState) => s.liveviewRefreshKey;
export const selectDebugEnabled = (s: RuntimeState) => s.debugEnabled;
