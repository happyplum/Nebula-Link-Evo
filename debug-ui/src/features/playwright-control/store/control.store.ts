import { create } from 'zustand';
import type { LocatorBundle } from '@nebula-link-evo/shared';

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectedElement {
  selector: string;
  tag: string;
  text?: string;
  attributes?: Record<string, string>;
  markerNumber?: number;
  bbox?: BBox;
  dataNebulaId?: string;
}

export interface DomElement {
  markerNumber?: number;
  tag: string;
  id?: string;
  text?: string;
  bbox?: BBox;
  isVisible?: boolean;
  isInteractable?: boolean;
  dataNebulaId?: string;
  locatorBundle?: LocatorBundle;
}

export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface CapturedCoordinates {
  x: number;
  y: number;
}

interface PlaywrightControlState {
  selectedElement: SelectedElement | null;
  consoleMessages: ConsoleMessage[];
  isExecutingAction: boolean;
  lastActionError: string | null;
  viewport: Viewport | null;
  browserOpen: boolean;
  browserUrl: string;
  markerToggle: boolean;
  snapshotId: string | null;
  domElements: DomElement[];
  elementPickerEnabled: boolean;
  highlightedElementId: string | null;
  capturedCoordinates: CapturedCoordinates | null;

  setSelectedElement: (element: SelectedElement | null) => void;
  clearSelectedElement: () => void;
  setConsoleMessages: (messages: ConsoleMessage[]) => void;
  addConsoleMessage: (message: ConsoleMessage) => void;
  setExecutingAction: (executing: boolean) => void;
  setActionError: (error: string | null) => void;
  setViewport: (viewport: Viewport | null) => void;
  setBrowserOpen: (open: boolean) => void;
  setBrowserUrl: (url: string) => void;
  setMarkerToggle: (v: boolean) => void;
  setSnapshotId: (id: string | null) => void;
  setDomElements: (els: DomElement[]) => void;
  setElementPickerEnabled: (v: boolean) => void;
  setHighlightedElementId: (id: string | null) => void;
  setCapturedCoordinates: (coords: CapturedCoordinates | null) => void;
  reset: () => void;
}

const persistedMarkerToggle = (() => {
  try {
    return localStorage.getItem('showMarkerNumbers') === 'true';
  } catch {
    return false;
  }
})();

const initialState = {
  selectedElement: null as SelectedElement | null,
  consoleMessages: [] as ConsoleMessage[],
  isExecutingAction: false,
  lastActionError: null as string | null,
  viewport: null as Viewport | null,
  browserOpen: false,
  browserUrl: '',
  markerToggle: persistedMarkerToggle,
  snapshotId: null as string | null,
  domElements: [] as DomElement[],
  elementPickerEnabled: false,
  highlightedElementId: null as string | null,
  capturedCoordinates: null as CapturedCoordinates | null,
};

export const useControlStore = create<PlaywrightControlState>()((set) => ({
  ...initialState,

  setSelectedElement: (element) => set({ selectedElement: element }),
  clearSelectedElement: () => set({ selectedElement: null }),
  setConsoleMessages: (messages) => set({ consoleMessages: messages }),
  addConsoleMessage: (message) =>
    set((state) => ({
      consoleMessages: [...state.consoleMessages, message].slice(-200),
    })),
  setExecutingAction: (executing) => set({ isExecutingAction: executing }),
  setActionError: (error) => set({ lastActionError: error }),
  setViewport: (viewport) => set({ viewport }),
  setBrowserOpen: (open) => set({ browserOpen: open }),
  setBrowserUrl: (url) => set({ browserUrl: url }),
  setMarkerToggle: (v) => {
    try {
      localStorage.setItem('showMarkerNumbers', String(v));
    } catch {
      /* storage unavailable */
    }
    set({ markerToggle: v });
  },
  setSnapshotId: (id) => set({ snapshotId: id }),
  setDomElements: (els) => set({ domElements: els }),
  setElementPickerEnabled: (v) => set({ elementPickerEnabled: v }),
  setHighlightedElementId: (id) => set({ highlightedElementId: id }),
  setCapturedCoordinates: (coords) => set({ capturedCoordinates: coords }),
  reset: () => set(initialState),
}));

// Selectors for optimized component subscriptions
export const selectSelectedElement = (s: PlaywrightControlState) => s.selectedElement;
export const selectConsoleMessages = (s: PlaywrightControlState) => s.consoleMessages;
export const selectIsExecutingAction = (s: PlaywrightControlState) => s.isExecutingAction;
export const selectLastActionError = (s: PlaywrightControlState) => s.lastActionError;
export const selectViewport = (s: PlaywrightControlState) => s.viewport;
export const selectBrowserOpen = (s: PlaywrightControlState) => s.browserOpen;
export const selectBrowserUrl = (s: PlaywrightControlState) => s.browserUrl;
export const selectMarkerToggle = (s: PlaywrightControlState) => s.markerToggle;
export const selectSnapshotId = (s: PlaywrightControlState) => s.snapshotId;
export const selectDomElements = (s: PlaywrightControlState) => s.domElements;
export const selectCapturedCoordinates = (s: PlaywrightControlState) => s.capturedCoordinates;
