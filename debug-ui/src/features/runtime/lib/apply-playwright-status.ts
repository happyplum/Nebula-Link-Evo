import type { DebugPlaywrightState } from '@nebula-link-evo/shared/types/debug-events';

import { useControlStore } from '@/features/playwright-control/store/control.store.js';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';

export function applyPlaywrightStatus(state: DebugPlaywrightState): void {
  useRuntimeStore.getState().setPlaywrightStatus(state.status);
  useRuntimeStore.getState().setPlaywrightIsOpen(state.isOpen);
  useRuntimeStore.getState().setPlaywrightStatusHydrated(true);
  useRuntimeStore.getState().setPlaywrightUrl(state.url);

  useControlStore.getState().setBrowserOpen(state.isOpen);
  useControlStore.getState().setBrowserUrl(state.url ?? '');
  useControlStore.getState().setViewport(state.viewport ?? null);
}
