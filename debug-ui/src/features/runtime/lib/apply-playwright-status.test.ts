import type { DebugPlaywrightState } from '@nebula-link-evo/shared/types/debug-events';

import { beforeEach, describe, expect, it } from 'vitest';

import { useControlStore } from '@/features/playwright-control/store/control.store.js';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';

import { applyPlaywrightStatus } from './apply-playwright-status.js';

describe('applyPlaywrightStatus', () => {
  beforeEach(() => {
    useRuntimeStore.getState().reset();
    useControlStore.getState().reset();
  });

  it('hydrates runtime and control stores when url is null', () => {
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
    expect(useControlStore.getState().browserOpen).toBe(false);
    expect(useControlStore.getState().browserUrl).toBe('');
  });

  it('sets all mirrored fields when the browser state is fully populated', () => {
    const state: DebugPlaywrightState = {
      isOpen: true,
      url: 'https://nebula.example/debug',
      title: 'Nebula',
      status: 'ready',
      reason: 'navigate',
      viewport: { width: 1440, height: 900 },
    };

    applyPlaywrightStatus(state);

    expect(useRuntimeStore.getState().playwrightStatus).toBe('ready');
    expect(useRuntimeStore.getState().playwrightIsOpen).toBe(true);
    expect(useRuntimeStore.getState().playwrightStatusHydrated).toBe(true);
    expect(useRuntimeStore.getState().playwrightUrl).toBe('https://nebula.example/debug');
    expect(useControlStore.getState().browserOpen).toBe(true);
    expect(useControlStore.getState().browserUrl).toBe('https://nebula.example/debug');
  });
});
