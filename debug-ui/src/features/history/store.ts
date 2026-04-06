import { create } from 'zustand';
import type { InteractionFilters } from './types/index.js';

export type ExecutionTab = 'tasks' | 'interactions';

interface ExecutionState {
  activeTab: ExecutionTab;
  selectedTaskId: string | null;
  interactionFilters: InteractionFilters;
  statsOverlayOpen: boolean;

  setActiveTab: (tab: ExecutionTab) => void;
  setSelectedTaskId: (id: string | null) => void;
  setInteractionFilters: (patch: Partial<InteractionFilters>) => void;
  resetInteractionFilters: () => void;
  setStatsOverlayOpen: (open: boolean) => void;
}

const DEFAULT_FILTERS: InteractionFilters = {
  limit: 50,
  offset: 0,
};

export const useExecutionStore = create<ExecutionState>()((set) => ({
  activeTab: 'tasks',
  selectedTaskId: null,
  interactionFilters: { ...DEFAULT_FILTERS },
  statsOverlayOpen: false,

  setActiveTab: (tab) => set({ activeTab: tab, selectedTaskId: null }),
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  setInteractionFilters: (patch) =>
    set((s) => ({
      interactionFilters: { ...s.interactionFilters, ...patch, offset: 0 },
    })),
  resetInteractionFilters: () => set({ interactionFilters: { ...DEFAULT_FILTERS } }),
  setStatsOverlayOpen: (open) => set({ statsOverlayOpen: open }),
}));
