import { createStore } from 'zustand';

export type AIStatus = 'idle' | 'running' | 'paused' | 'interrupted' | 'cancelled' | 'completed' | 'error';

export interface AIStatusState {
  status: AIStatus;
  currentTask: string | null;
  progress: number; // 0-100
  message: string | null;
  
  // Actions
  setStatus: (status: AIStatus) => void;
  setCurrentTask: (task: string | null) => void;
  setProgress: (progress: number) => void;
  setMessage: (message: string | null) => void;
  
  // Bulk update from SSE snapshot
  updateFromSnapshot: (snapshot: Partial<AIStatusState>) => void;
}

export const createAIStatusStore = () => createStore<AIStatusState>((set) => ({
  status: 'idle',
  currentTask: null,
  progress: 0,
  message: null,

  setStatus: (status) => set({ status }),

  setCurrentTask: (currentTask) => set({ currentTask }),

  setProgress: (progress) => set({ progress }),

  setMessage: (message) => set({ message }),

  updateFromSnapshot: (snapshot) => set((state) => ({
    ...state,
    ...snapshot
  })),
}));
