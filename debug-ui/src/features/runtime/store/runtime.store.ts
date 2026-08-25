import { create } from 'zustand';

export type ServiceStatus = 'unknown' | 'ready' | 'unhealthy';
export type LiveviewTransport = 'webrtc' | 'mjpeg';

interface RuntimeState {
  playwrightStatus: ServiceStatus;
  playwrightIsOpen: boolean;
  /** true once the first health poll completes — distinguishes "unprobed" from "confirmed closed". */
  playwrightStatusHydrated: boolean;
  playwrightUrl: string | null;
  snapshotVersion: number;
  liveviewRefreshKey: number;
  lastScreenshotDataUrl: string | null;
  liveviewTransport: LiveviewTransport;

  setPlaywrightStatus: (status: ServiceStatus) => void;
  setPlaywrightIsOpen: (isOpen: boolean) => void;
  setPlaywrightStatusHydrated: (hydrated: boolean) => void;
  setPlaywrightUrl: (url: string | null) => void;
  setPlaywrightState: (state: {
    status: ServiceStatus;
    isOpen: boolean;
    url: string | null;
  }) => void;
  incrementSnapshotVersion: () => void;
  incrementLiveviewRefreshKey: () => void;
  setLastScreenshotDataUrl: (url: string | null) => void;
  setLiveviewTransport: (mode: LiveviewTransport) => void;
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

const initialState = {
  playwrightStatus: 'unknown' as ServiceStatus,
  playwrightIsOpen: false,
  playwrightStatusHydrated: false,
  playwrightUrl: null as string | null,
  snapshotVersion: 0,
  liveviewRefreshKey: 0,
  lastScreenshotDataUrl: null as string | null,
  liveviewTransport: persistedTransport as LiveviewTransport,
};

export const useRuntimeStore = create<RuntimeState>()((set) => ({
  ...initialState,
  setPlaywrightStatus: (status) => set({ playwrightStatus: status }),
  setPlaywrightIsOpen: (isOpen) => set({ playwrightIsOpen: isOpen }),
  setPlaywrightStatusHydrated: (hydrated) => set({ playwrightStatusHydrated: hydrated }),
  setPlaywrightUrl: (url) => set({ playwrightUrl: url }),
  setPlaywrightState: (state) =>
    set({
      playwrightStatus: state.status,
      playwrightIsOpen: state.isOpen,
      playwrightUrl: state.url,
    }),
  incrementSnapshotVersion: () => set((s) => ({ snapshotVersion: s.snapshotVersion + 1 })),
  incrementLiveviewRefreshKey: () => set((s) => ({ liveviewRefreshKey: s.liveviewRefreshKey + 1 })),
  setLastScreenshotDataUrl: (url) => set({ lastScreenshotDataUrl: url }),
  setLiveviewTransport: (mode) => {
    try {
      localStorage.setItem('liveviewTransport', mode);
    } catch {
      /* storage unavailable */
    }
    set({ liveviewTransport: mode });
  },
  reset: () => set(initialState),
}));

// Selectors
export const selectPlaywrightStatus = (s: RuntimeState) => s.playwrightStatus;
export const selectPlaywrightIsOpen = (s: RuntimeState) => s.playwrightIsOpen;
export const selectPlaywrightUrl = (s: RuntimeState) => s.playwrightUrl;
export const selectLiveviewTransport = (s: RuntimeState) => s.liveviewTransport;
export const selectLiveviewRefreshKey = (s: RuntimeState) => s.liveviewRefreshKey;
export const selectPlaywrightStatusHydrated = (s: RuntimeState) => s.playwrightStatusHydrated;
