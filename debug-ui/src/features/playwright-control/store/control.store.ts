import { create } from 'zustand';

export interface SelectedElement {
  selector: string;
  tag: string;
  text?: string;
  attributes?: Record<string, string>;
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

interface PlaywrightControlState {
  selectedElement: SelectedElement | null;
  consoleMessages: ConsoleMessage[];
  isExecutingAction: boolean;
  lastActionError: string | null;
  viewport: Viewport | null;

  setSelectedElement: (element: SelectedElement | null) => void;
  clearSelectedElement: () => void;
  setConsoleMessages: (messages: ConsoleMessage[]) => void;
  setExecutingAction: (executing: boolean) => void;
  setActionError: (error: string | null) => void;
  setViewport: (viewport: Viewport | null) => void;
  reset: () => void;
}

const initialState = {
  selectedElement: null as SelectedElement | null,
  consoleMessages: [] as ConsoleMessage[],
  isExecutingAction: false,
  lastActionError: null as string | null,
  viewport: null as Viewport | null,
};

export const useControlStore = create<PlaywrightControlState>()((set) => ({
  ...initialState,

  setSelectedElement: (element) => set({ selectedElement: element }),
  clearSelectedElement: () => set({ selectedElement: null }),
  setConsoleMessages: (messages) => set({ consoleMessages: messages }),
  setExecutingAction: (executing) => set({ isExecutingAction: executing }),
  setActionError: (error) => set({ lastActionError: error }),
  setViewport: (viewport) => set({ viewport }),
  reset: () => set(initialState),
}));

// Selectors for optimized component subscriptions
export const selectSelectedElement = (s: PlaywrightControlState) =>
  s.selectedElement;
export const selectConsoleMessages = (s: PlaywrightControlState) =>
  s.consoleMessages;
export const selectIsExecutingAction = (s: PlaywrightControlState) =>
  s.isExecutingAction;
export const selectLastActionError = (s: PlaywrightControlState) =>
  s.lastActionError;
export const selectViewport = (s: PlaywrightControlState) => s.viewport;
