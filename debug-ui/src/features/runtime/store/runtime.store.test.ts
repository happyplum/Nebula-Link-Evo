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
    });
  });

  describe('setPlaywrightStatus', () => {
    it.each(['unknown', 'ready', 'unhealthy'] as const)(
      'sets status to %s',
      (status) => {
        useRuntimeStore.getState().setPlaywrightStatus(status);
        expect(useRuntimeStore.getState().playwrightStatus).toBe(status);
      },
    );
  });

  describe('setPlaywrightIsOpen', () => {
    it('sets to open', () => {
      useRuntimeStore.getState().setPlaywrightIsOpen(true);
      expect(useRuntimeStore.getState().playwrightIsOpen).toBe(true);
    });

    it('sets to closed', () => {
      useRuntimeStore.getState().setPlaywrightIsOpen(true);
      useRuntimeStore.getState().setPlaywrightIsOpen(false);
      expect(useRuntimeStore.getState().playwrightIsOpen).toBe(false);
    });
  });

  describe('setPlaywrightUrl', () => {
    it('sets a url', () => {
      useRuntimeStore.getState().setPlaywrightUrl('http://localhost:3001');
      expect(useRuntimeStore.getState().playwrightUrl).toBe('http://localhost:3001');
    });

    it('clears url with null', () => {
      useRuntimeStore.getState().setPlaywrightUrl('http://localhost:3001');
      useRuntimeStore.getState().setPlaywrightUrl(null);
      expect(useRuntimeStore.getState().playwrightUrl).toBeNull();
    });
  });

  describe('setPlaywrightState', () => {
    it('updates status, open state, and url atomically', () => {
      useRuntimeStore.getState().setPlaywrightState({
        status: 'ready',
        isOpen: true,
        url: 'https://example.com',
      });

      const s = useRuntimeStore.getState();
      expect(s.playwrightStatus).toBe('ready');
      expect(s.playwrightIsOpen).toBe(true);
      expect(s.playwrightUrl).toBe('https://example.com');
    });
  });

  describe('reset', () => {
    it('returns all state to initial values', () => {
      const store = useRuntimeStore.getState();
      store.setPlaywrightStatus('ready');
      store.setPlaywrightIsOpen(true);
      store.setPlaywrightUrl('http://localhost:3001');

      useRuntimeStore.getState().reset();

      const s = useRuntimeStore.getState();
      expect(s.playwrightStatus).toBe('unknown');
      expect(s.playwrightIsOpen).toBe(false);
      expect(s.playwrightUrl).toBeNull();
    });
  });
});
