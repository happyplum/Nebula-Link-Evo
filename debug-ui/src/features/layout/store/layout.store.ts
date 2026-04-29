import { create } from 'zustand';

export type ActivityIcon = 'monitor' | 'control' | 'ai' | 'history' | 'interactions';
export type RightPanelTab = 'dom-elements' | 'config';

interface LayoutState {
  isLeftSidebarOpen: boolean;
  isRightPanelOpen: boolean;
  activeActivityIcon: ActivityIcon;
  activeRightTab: RightPanelTab;

  toggleLeftSidebar: () => void;
  setLeftSidebarOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  setActiveActivityIcon: (icon: ActivityIcon) => void;
  setActiveRightTab: (tab: RightPanelTab) => void;
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  isLeftSidebarOpen: true,
  isRightPanelOpen: false,
  activeActivityIcon: 'monitor',
  activeRightTab: 'dom-elements',

  toggleLeftSidebar: () => set((s) => ({ isLeftSidebarOpen: !s.isLeftSidebarOpen })),
  setLeftSidebarOpen: (open) => set({ isLeftSidebarOpen: open }),
  toggleRightPanel: () => set((s) => ({ isRightPanelOpen: !s.isRightPanelOpen })),
  setRightPanelOpen: (open) => set({ isRightPanelOpen: open }),
  setActiveActivityIcon: (icon) => set({ activeActivityIcon: icon }),
  setActiveRightTab: (tab) => set({ activeRightTab: tab }),
}));

// Selectors for optimized component subscriptions
export const selectLeftSidebarOpen = (s: LayoutState) => s.isLeftSidebarOpen;
export const selectRightPanelOpen = (s: LayoutState) => s.isRightPanelOpen;
export const selectActiveActivityIcon = (s: LayoutState) => s.activeActivityIcon;
export const selectActiveRightTab = (s: LayoutState) => s.activeRightTab;
