import { create } from 'zustand';

export interface UIState {
  sidebarOpen: boolean;
  activeTab: string;
  theme: 'light' | 'dark' | 'system';
  
  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  setActiveTab: (tabId: string) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  activeTab: 'overview',
  theme: 'dark', // Default to dark as per global.css

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  
  setSidebarOpen: (isOpen) => set({ sidebarOpen: isOpen }),
  
  setActiveTab: (tabId) => set({ activeTab: tabId }),
  
  setTheme: (theme) => set({ theme }),
}));
