import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from './layout.store.js';

describe('layout.store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useLayoutStore.setState({
      isLeftSidebarOpen: true,
      isRightPanelOpen: false,
      activeActivityIcon: 'monitor',
      activeRightTab: 'dom-elements',
    });
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const s = useLayoutStore.getState();
      expect(s.isLeftSidebarOpen).toBe(true);
      expect(s.isRightPanelOpen).toBe(false);
      expect(s.activeActivityIcon).toBe('monitor');
      expect(s.activeRightTab).toBe('dom-elements');
    });
  });

  describe('toggleLeftSidebar', () => {
    it('toggles from open to closed', () => {
      useLayoutStore.getState().toggleLeftSidebar();
      expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false);
    });

    it('toggles from closed to open', () => {
      useLayoutStore.setState({ isLeftSidebarOpen: false });
      useLayoutStore.getState().toggleLeftSidebar();
      expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true);
    });
  });

  describe('setLeftSidebarOpen', () => {
    it('sets to open', () => {
      useLayoutStore.setState({ isLeftSidebarOpen: false });
      useLayoutStore.getState().setLeftSidebarOpen(true);
      expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true);
    });

    it('sets to closed', () => {
      useLayoutStore.getState().setLeftSidebarOpen(false);
      expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false);
    });
  });

  describe('toggleRightPanel', () => {
    it('toggles from closed to open', () => {
      useLayoutStore.getState().toggleRightPanel();
      expect(useLayoutStore.getState().isRightPanelOpen).toBe(true);
    });

    it('toggles from open to closed', () => {
      useLayoutStore.setState({ isRightPanelOpen: true });
      useLayoutStore.getState().toggleRightPanel();
      expect(useLayoutStore.getState().isRightPanelOpen).toBe(false);
    });
  });

  describe('setRightPanelOpen', () => {
    it('sets to open', () => {
      useLayoutStore.getState().setRightPanelOpen(true);
      expect(useLayoutStore.getState().isRightPanelOpen).toBe(true);
    });

    it('sets to closed', () => {
      useLayoutStore.setState({ isRightPanelOpen: true });
      useLayoutStore.getState().setRightPanelOpen(false);
      expect(useLayoutStore.getState().isRightPanelOpen).toBe(false);
    });
  });

  describe('setActiveActivityIcon', () => {
    it('changes the active activity icon', () => {
      useLayoutStore.getState().setActiveActivityIcon('ai');
      expect(useLayoutStore.getState().activeActivityIcon).toBe('ai');
    });

    it('switches to history icon', () => {
      useLayoutStore.getState().setActiveActivityIcon('history');
      expect(useLayoutStore.getState().activeActivityIcon).toBe('history');
    });
  });

  describe('setActiveRightTab', () => {
    it('changes the active right panel tab', () => {
      useLayoutStore.getState().setActiveRightTab('config');
      expect(useLayoutStore.getState().activeRightTab).toBe('config');
    });

    it('switches back to dom-elements tab', () => {
      useLayoutStore.getState().setActiveRightTab('config');
      useLayoutStore.getState().setActiveRightTab('dom-elements');
      expect(useLayoutStore.getState().activeRightTab).toBe('dom-elements');
    });
  });
});
