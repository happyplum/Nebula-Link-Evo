import type { DebugPlaywrightState } from '@nebula-link-evo/shared/types/debug-events';
import { fetchBrowserStatus } from '@/features/playwright-control/api/control.adapters.js';
import { applyPlaywrightStatus } from './apply-playwright-status.js';

/** Confirm REST browser state at the DTO boundary before publishing it to every panel. */
export async function refreshBrowserStatus(): Promise<DebugPlaywrightState> {
  const response = await fetchBrowserStatus();
  if (!response.success || typeof response.isOpen !== 'boolean') {
    throw new Error(response.error ?? '无法确认浏览器状态');
  }
  const state: DebugPlaywrightState = {
    isOpen: response.isOpen,
    url: response.url ?? null,
    title: null,
    status: response.isOpen ? 'ready' : 'unknown',
  };
  applyPlaywrightStatus(state);
  return state;
}
