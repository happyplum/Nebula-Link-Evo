import type { DebugPlaywrightState } from '@nebula-link-evo/shared/types/debug-events';

import { useControlStore } from '@/features/playwright-control/store/control.store.js';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';

export function applyPlaywrightStatus(state: DebugPlaywrightState): void {
  useRuntimeStore.getState().setPlaywrightState(state);
  if (state.viewport !== undefined) {
    useControlStore.getState().setViewport(state.viewport);
  }
}
