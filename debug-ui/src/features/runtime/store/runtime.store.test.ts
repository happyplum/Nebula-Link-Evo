import { beforeEach, describe, expect, it } from 'vitest';
import { useRuntimeStore } from './runtime.store.js';

describe('runtime.store', () => {
  beforeEach(() => {
    useRuntimeStore.getState().reset();
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const s = useRuntimeStore.getState();
      expect(s.connectionStatus).toBe('disconnected');
      expect(s.reconnectAttempt).toBe(0);
      expect(s.playwrightStatus).toBe('unknown');
      expect(s.playwrightIsOpen).toBe(false);
      expect(s.playwrightUrl).toBeNull();
    });
  });

  describe('setConnectionStatus', () => {
    it.each(['connected', 'disconnected', 'connecting', 'reconnecting'] as const)(
      'sets status to %s',
      (status) => {
        useRuntimeStore.getState().setConnectionStatus(status);
        expect(useRuntimeStore.getState().connectionStatus).toBe(status);
      },
    );
  });

  describe('setReconnectAttempt', () => {
    it('sets the reconnect attempt count', () => {
      useRuntimeStore.getState().setReconnectAttempt(5);
      expect(useRuntimeStore.getState().reconnectAttempt).toBe(5);
    });
  });

  describe('incrementReconnectAttempt', () => {
    it('increments from 0 to 1', () => {
      useRuntimeStore.getState().incrementReconnectAttempt();
      expect(useRuntimeStore.getState().reconnectAttempt).toBe(1);
    });

    it('increments from existing value', () => {
      useRuntimeStore.getState().setReconnectAttempt(3);
      useRuntimeStore.getState().incrementReconnectAttempt();
      expect(useRuntimeStore.getState().reconnectAttempt).toBe(4);
    });
  });

  describe('resetReconnectAttempt', () => {
    it('resets to 0', () => {
      useRuntimeStore.getState().setReconnectAttempt(10);
      useRuntimeStore.getState().resetReconnectAttempt();
      expect(useRuntimeStore.getState().reconnectAttempt).toBe(0);
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

  describe('reset', () => {
    it('returns all state to initial values', () => {
      const store = useRuntimeStore.getState();
      store.setConnectionStatus('connecting');
      store.setReconnectAttempt(7);
      store.setPlaywrightStatus('ready');
      store.setPlaywrightIsOpen(true);
      store.setPlaywrightUrl('http://localhost:3001');

      useRuntimeStore.getState().reset();

      const s = useRuntimeStore.getState();
      expect(s.connectionStatus).toBe('disconnected');
      expect(s.reconnectAttempt).toBe(0);
      expect(s.playwrightStatus).toBe('unknown');
      expect(s.playwrightIsOpen).toBe(false);
      expect(s.playwrightUrl).toBeNull();
    });
  });
});
