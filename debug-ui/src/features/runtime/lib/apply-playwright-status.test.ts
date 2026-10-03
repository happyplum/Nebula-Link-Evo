import type { DebugPlaywrightState } from '@nebula-link-evo/shared/types/debug-events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useControlStore } from '@/features/playwright-control/store/control.store.js';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';

import { applyPlaywrightStatus } from './apply-playwright-status.js';

describe('applyPlaywrightStatus', () => {
  beforeEach(() => {
    useRuntimeStore.getState().reset();
    useControlStore.getState().reset();
  });

  it('hydrates runtime when url is null without duplicating browser state in control', () => {
    const state: DebugPlaywrightState = {
      isOpen: false,
      url: null,
      title: null,
      status: 'unknown',
      reason: 'close',
      viewport: null,
    };

    applyPlaywrightStatus(state);

    expect(useRuntimeStore.getState().playwrightStatus).toBe('unknown');
    expect(useRuntimeStore.getState().playwrightIsOpen).toBe(false);
    expect(useRuntimeStore.getState().playwrightStatusHydrated).toBe(true);
    expect(useRuntimeStore.getState().playwrightUrl).toBeNull();
    expect(useControlStore.getState()).not.toHaveProperty('browserOpen');
    expect(useControlStore.getState()).not.toHaveProperty('browserUrl');
  });

  it('publishes browser state and hydration in one runtime update, retaining control viewport', () => {
    const updates = vi.fn();
    const unsubscribe = useRuntimeStore.subscribe(updates);
    const state: DebugPlaywrightState = {
      isOpen: true,
      url: 'https://nebula.example/debug',
      title: 'Nebula',
      status: 'ready',
      reason: 'navigate',
      viewport: { width: 1440, height: 900 },
    };

    applyPlaywrightStatus(state);
    unsubscribe();

    expect(useRuntimeStore.getState().playwrightStatus).toBe('ready');
    expect(useRuntimeStore.getState().playwrightIsOpen).toBe(true);
    expect(useRuntimeStore.getState().playwrightStatusHydrated).toBe(true);
    expect(useRuntimeStore.getState().playwrightUrl).toBe('https://nebula.example/debug');
    expect(updates).toHaveBeenCalledTimes(1);
    expect(updates.mock.calls[0]?.[0]).toMatchObject({
      playwrightStatus: 'ready',
      playwrightIsOpen: true,
      playwrightStatusHydrated: true,
      playwrightUrl: 'https://nebula.example/debug',
    });
    expect(useControlStore.getState().viewport).toEqual({ width: 1440, height: 900 });
  });

  it('preserves unspecified viewport and clears an explicitly null viewport', () => {
    useControlStore.getState().setViewport({ width: 800, height: 600 });
    const state: DebugPlaywrightState = { isOpen: true, url: null, title: null, status: 'ready' };
    applyPlaywrightStatus(state);
    expect(useControlStore.getState().viewport).toEqual({ width: 800, height: 600 });
    applyPlaywrightStatus({ ...state, viewport: null });
    expect(useControlStore.getState().viewport).toBeNull();
  });
});
