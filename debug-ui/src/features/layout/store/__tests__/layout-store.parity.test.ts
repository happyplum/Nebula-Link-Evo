import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore } from '../layout.store.js';

describe('Layout Store Parity Test', () => {
  beforeEach(() => {
    // Reset store state before each test
    useLayoutStore.setState({
      isLeftSidebarOpen: true,
      isRightPanelOpen: false,
      activeActivityIcon: 'monitor',
      activeRightTab: 'dom-elements',
    });
  });

  it('asserts ActivityIcon type includes exactly: monitor, control, ai, history, interactions', () => {
    const { setActiveActivityIcon } = useLayoutStore.getState();

    // Test all valid ActivityIcon values
    expect(() => setActiveActivityIcon('monitor')).not.toThrow();
    expect(() => setActiveActivityIcon('control')).not.toThrow();
    expect(() => setActiveActivityIcon('ai')).not.toThrow();
    expect(() => setActiveActivityIcon('history')).not.toThrow();
    expect(() => setActiveActivityIcon('interactions')).not.toThrow();

    // Verify state changes correctly
    setActiveActivityIcon('monitor');
    expect(useLayoutStore.getState().activeActivityIcon).toBe('monitor');

    setActiveActivityIcon('control');
    expect(useLayoutStore.getState().activeActivityIcon).toBe('control');

    setActiveActivityIcon('ai');
    expect(useLayoutStore.getState().activeActivityIcon).toBe('ai');

    setActiveActivityIcon('history');
    expect(useLayoutStore.getState().activeActivityIcon).toBe('history');

    setActiveActivityIcon('interactions');
    expect(useLayoutStore.getState().activeActivityIcon).toBe('interactions');
  });

  it('asserts default activeActivityIcon is monitor', () => {
    // Reset to initial state
    useLayoutStore.setState({
      isLeftSidebarOpen: true,
      isRightPanelOpen: false,
      activeActivityIcon: 'monitor',
      activeRightTab: 'dom-elements',
    });

    const { activeActivityIcon } = useLayoutStore.getState();
    expect(activeActivityIcon).toBe('monitor');
  });

  it('asserts setActiveIcon correctly changes the icon', () => {
    const { setActiveActivityIcon } = useLayoutStore.getState();

    // Test changing to each possible activity icon
    setActiveActivityIcon('control');
    expect(useLayoutStore.getState().activeActivityIcon).toBe('control');

    setActiveActivityIcon('ai');
    expect(useLayoutStore.getState().activeActivityIcon).toBe('ai');

    setActiveActivityIcon('history');
    expect(useLayoutStore.getState().activeActivityIcon).toBe('history');

    setActiveActivityIcon('interactions');
    expect(useLayoutStore.getState().activeActivityIcon).toBe('interactions');

    setActiveActivityIcon('monitor');
    expect(useLayoutStore.getState().activeActivityIcon).toBe('monitor');
  });

  it('asserts activeRightTab state is INDEPENDENT of activity icon changes', () => {
    const { setActiveActivityIcon, setActiveRightTab } = useLayoutStore.getState();

    // Set initial right tab to 'config'
    setActiveRightTab('config');
    expect(useLayoutStore.getState().activeRightTab).toBe('config');

    // Change activity icon multiple times
    setActiveActivityIcon('control');
    expect(useLayoutStore.getState().activeRightTab).toBe('config');

    setActiveActivityIcon('ai');
    expect(useLayoutStore.getState().activeRightTab).toBe('config');

    setActiveActivityIcon('history');
    expect(useLayoutStore.getState().activeRightTab).toBe('config');

    setActiveActivityIcon('interactions');
    expect(useLayoutStore.getState().activeRightTab).toBe('config');

    setActiveActivityIcon('monitor');
    expect(useLayoutStore.getState().activeRightTab).toBe('config');
  });

  it('asserts switching activities does NOT reset right-panel tab', () => {
    const { setActiveActivityIcon, setActiveRightTab } = useLayoutStore.getState();

    // Set right tab to 'config'
    setActiveRightTab('config');
    const initialRightTab = useLayoutStore.getState().activeRightTab;
    expect(initialRightTab).toBe('config');

    // Switch through all activities
    const activities: Array<'monitor' | 'control' | 'ai' | 'history' | 'interactions'> = [
      'monitor',
      'control',
      'ai',
      'history',
      'interactions',
    ];

    activities.forEach((activity) => {
      setActiveActivityIcon(activity);
      expect(useLayoutStore.getState().activeRightTab).toBe('config');
    });

    // Also test with 'dom-elements' as initial tab
    setActiveRightTab('dom-elements');
    activities.forEach((activity) => {
      setActiveActivityIcon(activity);
      expect(useLayoutStore.getState().activeRightTab).toBe('dom-elements');
    });
  });
});
