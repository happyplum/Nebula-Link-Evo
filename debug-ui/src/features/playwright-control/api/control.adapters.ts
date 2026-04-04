/**
 * API adapter functions for Playwright control domain.
 * All browser control goes through proxy-adapter REST API endpoints.
 */
import { apiClient } from '@/shared/api/client.js';
import {
  DEBUG_DOM,
  DEBUG_PLAYWRIGHT_ACTION,
  DEBUG_PLAYWRIGHT_CLOSE,
  DEBUG_PLAYWRIGHT_NAVIGATE,
  DEBUG_PLAYWRIGHT_OPEN,
  DEBUG_PLAYWRIGHT_SCREENSHOT,
  DEBUG_PLAYWRIGHT_STATUS,
} from '@/shared/api/endpoints.js';

export interface ActionResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface StatusResponse {
  success: boolean;
  isOpen?: boolean;
  url?: string;
  error?: string;
}

export interface ScreenshotResponse {
  success: boolean;
  screenshot?: string;
  viewport?: { width: number; height: number };
  error?: string;
}

export interface ElementsResponse {
  success: boolean;
  elements?: Array<{
    tag: string;
    id?: string;
    class?: string;
    text?: string;
    bbox?: { x: number; y: number; width: number; height: number };
    isVisible?: boolean;
    isInteractable?: boolean;
  }>;
  error?: string;
}

export interface EvaluateResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface DomSnapshotElementInfo {
  tag: string;
  bbox: { x: number; y: number; width: number; height: number };
  isVisible?: boolean;
  isInteractable?: boolean;
  text?: string;
  'data-nebula-id'?: string;
  locatorBundle?: Record<string, string>;
}

export interface DomSnapshotResponse {
  success: boolean;
  dom?: {
    annotated_screenshot_base64?: string;
    elements_map?:
      | [number, DomSnapshotElementInfo][]
      | Record<string, DomSnapshotElementInfo>;
    snapshot_id?: string;
  };
  error?: string;
}

export interface ConsoleResponse {
  success: boolean;
  messages?: Array<{ type: string; text: string; timestamp: number }>;
  error?: string;
}

/** Execute a browser action (click, type, scroll, navigate, etc.) */
export async function executeAction(
  action: string,
  args?: Record<string, unknown>,
): Promise<ActionResponse> {
  return apiClient.post<ActionResponse>(DEBUG_PLAYWRIGHT_ACTION, {
    action,
    ...args,
  });
}

/** Run JavaScript expression in the browser context */
export async function evaluateExpression(
  expression: string,
): Promise<EvaluateResponse> {
  return apiClient.post<EvaluateResponse>('/debug/api/playwright/evaluate', {
    expression,
  });
}

/** Take a screenshot, optionally scoped to a selector */
export async function takeScreenshot(
  selector?: string,
): Promise<ScreenshotResponse> {
  const params = selector ? { selector } : undefined;
  return apiClient.get<ScreenshotResponse>(DEBUG_PLAYWRIGHT_SCREENSHOT, params);
}

/** Get DOM elements matching a CSS selector */
export async function getElements(
  selector: string,
): Promise<ElementsResponse> {
  return apiClient.get<ElementsResponse>('/debug/api/playwright/elements', {
    selector,
  });
}

/** Get accumulated console messages from the browser */
export async function getConsoleMessages(): Promise<ConsoleResponse> {
  return apiClient.get<ConsoleResponse>('/debug/api/playwright/console');
}

/** Fetch current browser status (open/closed, current URL) */
export async function fetchBrowserStatus(): Promise<StatusResponse> {
  return apiClient.get<StatusResponse>(DEBUG_PLAYWRIGHT_STATUS);
}

/** Open the browser instance */
export async function openBrowser(): Promise<ActionResponse> {
  return apiClient.post<ActionResponse>(DEBUG_PLAYWRIGHT_OPEN);
}

/** Close the browser instance */
export async function closeBrowser(): Promise<ActionResponse> {
  return apiClient.post<ActionResponse>(DEBUG_PLAYWRIGHT_CLOSE);
}

/** Navigate the browser to a URL */
export async function navigateToUrl(url: string): Promise<ActionResponse> {
  return apiClient.post<ActionResponse>(DEBUG_PLAYWRIGHT_NAVIGATE, { url });
}

/** Fetch DOM snapshot with annotated screenshot and elements map */
export async function fetchDomSnapshot(): Promise<DomSnapshotResponse> {
  return apiClient.get<DomSnapshotResponse>(DEBUG_DOM);
}
