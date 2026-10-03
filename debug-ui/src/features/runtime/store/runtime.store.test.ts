import { beforeEach, describe, expect, it } from 'vitest';
import { useRuntimeStore } from './runtime.store.js';

describe('runtime.store', () => {
  beforeEach(() => {
    useRuntimeStore.getState().reset();
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const s = useRuntimeStore.getState();
      expect(s.playwrightStatus).toBe('unknown');
      expect(s.playwrightIsOpen).toBe(false);
      expect(s.playwrightUrl).toBeNull();
      expect(s.playwrightStatusHydrated).toBe(false);
      expect(s).not.toHaveProperty('setPlaywrightStatus');
      expect(s).not.toHaveProperty('setPlaywrightIsOpen');
      expect(s).not.toHaveProperty('setPlaywrightUrl');
    });
  });

  describe('setPlaywrightState', () => {
    it.each(['unknown', 'ready', 'unhealthy'] as const)(
      'updates all confirmed fields with status %s',
      (status) => {
        useRuntimeStore.getState().setPlaywrightState({
          status,
          isOpen: true,
          url: 'https://example.com',
        });

        const s = useRuntimeStore.getState();
        expect(s.playwrightStatus).toBe(status);
        expect(s.playwrightIsOpen).toBe(true);
        expect(s.playwrightUrl).toBe('https://example.com');
        expect(s.playwrightStatusHydrated).toBe(true);
      }
    );

    it('confirms closed state and clears the previous URL together', () => {
      useRuntimeStore
        .getState()
        .setPlaywrightState({ status: 'ready', isOpen: true, url: 'https://example.com' });
      useRuntimeStore
        .getState()
        .setPlaywrightState({ status: 'unknown', isOpen: false, url: null });
      const s = useRuntimeStore.getState();
      expect(s.playwrightStatus).toBe('unknown');
      expect(s.playwrightIsOpen).toBe(false);
      expect(s.playwrightUrl).toBeNull();
      expect(s.playwrightStatusHydrated).toBe(true);
    });
  });

  describe('reset', () => {
    it('returns all state to initial values', () => {
      useRuntimeStore
        .getState()
        .setPlaywrightState({ status: 'ready', isOpen: true, url: 'https://example.com' });

      useRuntimeStore.getState().reset();

      const s = useRuntimeStore.getState();
      expect(s.playwrightStatus).toBe('unknown');
      expect(s.playwrightIsOpen).toBe(false);
      expect(s.playwrightUrl).toBeNull();
      expect(s.playwrightStatusHydrated).toBe(false);
    });
  });
});
