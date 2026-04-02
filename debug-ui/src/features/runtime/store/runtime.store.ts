import { create } from 'zustand';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting';
export type ServiceStatus = 'unknown' | 'ready' | 'unhealthy';

interface RuntimeState {
  connectionStatus: ConnectionStatus;
  reconnectAttempt: number;
  playwrightStatus: ServiceStatus;
  playwrightIsOpen: boolean;
  playwrightUrl: string | null;

  setConnectionStatus: (status: ConnectionStatus) => void;
  setReconnectAttempt: (attempt: number) => void;
  incrementReconnectAttempt: () => void;
  resetReconnectAttempt: () => void;
  setPlaywrightStatus: (status: ServiceStatus) => void;
  setPlaywrightIsOpen: (isOpen: boolean) => void;
  setPlaywrightUrl: (url: string | null) => void;
  reset: () => void;
}

const initialState = {
  connectionStatus: 'disconnected' as ConnectionStatus,
  reconnectAttempt: 0,
  playwrightStatus: 'unknown' as ServiceStatus,
  playwrightIsOpen: false,
  playwrightUrl: null as string | null,
};

export const useRuntimeStore = create<RuntimeState>()((set) => ({
  ...initialState,

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setReconnectAttempt: (attempt) => set({ reconnectAttempt: attempt }),
  incrementReconnectAttempt: () =>
    set((s) => ({ reconnectAttempt: s.reconnectAttempt + 1 })),
  resetReconnectAttempt: () => set({ reconnectAttempt: 0 }),
  setPlaywrightStatus: (status) => set({ playwrightStatus: status }),
  setPlaywrightIsOpen: (isOpen) => set({ playwrightIsOpen: isOpen }),
  setPlaywrightUrl: (url) => set({ playwrightUrl: url }),
  reset: () => set(initialState),
}));

// Selectors
export const selectConnectionStatus = (s: RuntimeState) => s.connectionStatus;
export const selectReconnectAttempt = (s: RuntimeState) => s.reconnectAttempt;
export const selectPlaywrightStatus = (s: RuntimeState) => s.playwrightStatus;
export const selectPlaywrightIsOpen = (s: RuntimeState) => s.playwrightIsOpen;
export const selectPlaywrightUrl = (s: RuntimeState) => s.playwrightUrl;
