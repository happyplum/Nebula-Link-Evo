import { create } from 'zustand';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting';
export type ServiceStatus = 'unknown' | 'ready' | 'unhealthy';

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
  lastScreenshotDataUrl: string | null;
  executionMessages: ExecutionMessage[];

  setConnectionStatus: (status: ConnectionStatus) => void;
  setReconnectAttempt: (attempt: number) => void;
  incrementReconnectAttempt: () => void;
  resetReconnectAttempt: () => void;
  setPlaywrightStatus: (status: ServiceStatus) => void;
  setPlaywrightIsOpen: (isOpen: boolean) => void;
  setPlaywrightUrl: (url: string | null) => void;
  setSnapshotVersion: (version: number) => void;
  incrementSnapshotVersion: () => void;
  setLastScreenshotDataUrl: (url: string | null) => void;
  addExecutionMessage: (message: ExecutionMessage) => void;
  reset: () => void;
}

const initialState = {
  connectionStatus: 'disconnected' as ConnectionStatus,
  reconnectAttempt: 0,
  playwrightStatus: 'unknown' as ServiceStatus,
  playwrightIsOpen: false,
  playwrightUrl: null as string | null,
  snapshotVersion: 0,
  lastScreenshotDataUrl: null as string | null,
  executionMessages: [] as ExecutionMessage[],
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
  setLastScreenshotDataUrl: (url) => set({ lastScreenshotDataUrl: url }),
  addExecutionMessage: (message) =>
    set((s) => ({
      executionMessages: [...s.executionMessages, message].slice(-200),
    })),
  reset: () => set(initialState),
}));

// Selectors
export const selectConnectionStatus = (s: RuntimeState) => s.connectionStatus;
export const selectReconnectAttempt = (s: RuntimeState) => s.reconnectAttempt;
export const selectPlaywrightStatus = (s: RuntimeState) => s.playwrightStatus;
export const selectPlaywrightIsOpen = (s: RuntimeState) => s.playwrightIsOpen;
export const selectPlaywrightUrl = (s: RuntimeState) => s.playwrightUrl;
export const selectExecutionMessages = (s: RuntimeState) => s.executionMessages;
