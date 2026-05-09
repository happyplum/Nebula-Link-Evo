import { create } from 'zustand';
import { ProjectConfig } from './configApi';

export interface ConfigState {
  localConfig: ProjectConfig | null;
  isDirty: boolean;
  
  // Actions
  setLocalConfig: (config: ProjectConfig | null) => void;
  updateLocalConfig: (updates: Partial<ProjectConfig>) => void;
  resetDirty: () => void;
}

export const useConfigStore = create<ConfigState>((set) => ({
  localConfig: null,
  isDirty: false,

  setLocalConfig: (config) => set({ localConfig: config, isDirty: false }),
  
  updateLocalConfig: (updates) => set((state) => ({
    localConfig: state.localConfig ? { ...state.localConfig, ...updates } : null,
    isDirty: true
  })),
  
  resetDirty: () => set({ isDirty: false }),
}));
