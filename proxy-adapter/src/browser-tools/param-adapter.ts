/**
 * 参数适配层
 *
 * 将 MCP 工具参数转换为 BrowserClient 方法所需的参数格式。
 * 静默忽略不支持的字段（如 waitUntil、timeout、options）。
 */

/**
 * 适配 browser_navigate 参数
 * 静默忽略 waitUntil/timeout
 */
export function adaptNavigateParams(params: Record<string, unknown>): {
  url: string;
} {
  if (typeof params.url !== 'string' || !params.url) {
    throw new Error('browser_navigate: url is required and must be a non-empty string');
  }
  return { url: params.url };
}

/**
 * 适配 browser_screenshot 参数
 * 静默忽略 type
 */
export function adaptScreenshotParams(params: Record<string, unknown>): {
  fullPage?: boolean;
} {
  return {
    fullPage: params.fullPage === true,
  };
}

/**
 * 适配 page_type 参数
 * 静默忽略 clear/delay/force
 */
export function adaptTypeParams(params: Record<string, unknown>): {
  selector: string;
  text: string;
} {
  if (typeof params.selector !== 'string' || !params.selector) {
    throw new Error('page_type: selector is required and must be a non-empty string');
  }
  if (typeof params.text !== 'string') {
    throw new Error('page_type: text is required and must be a string');
  }
  return { selector: params.selector, text: params.text };
}

/**
 * 适配 page_click_selector 参数
 * 静默忽略 options 中的不支持字段
 */
export function adaptClickSelectorParams(params: Record<string, unknown>): {
  selector: string;
} {
  if (typeof params.selector !== 'string' || !params.selector) {
    throw new Error('page_click_selector: selector is required and must be a non-empty string');
  }
  return { selector: params.selector };
}

/**
 * 适配 page_element_action 参数
 * 直接透传
 */
export function adaptElementActionParams(params: Record<string, unknown>): {
  selector: string;
  action: string;
  param?: string;
} {
  if (typeof params.selector !== 'string' || !params.selector) {
    throw new Error('page_element_action: selector is required and must be a non-empty string');
  }
  if (typeof params.action !== 'string' || !params.action) {
    throw new Error('page_element_action: action is required and must be a non-empty string');
  }
  return {
    selector: params.selector,
    action: params.action,
    param: typeof params.param === 'string' ? params.param : undefined,
  };
}

/**
 * 适配 execute_by_marker 参数
 * 转换字段名: snapshot_id → snapshotId, nebula_id → nebulaId
 */
export function adaptMarkerParams(params: Record<string, unknown>): {
  snapshotId: string;
  nebulaId: number;
  action: string;
  param?: string;
} {
  const snapshotId = (params.snapshot_id as string) || (params.snapshotId as string);
  if (typeof snapshotId !== 'string' || !snapshotId) {
    throw new Error('execute_by_marker: snapshot_id is required and must be a non-empty string');
  }

  const rawNebulaId = params.nebula_id ?? params.nebulaId;
  if (typeof rawNebulaId !== 'number') {
    throw new Error('execute_by_marker: nebula_id is required and must be a number');
  }

  if (typeof params.action !== 'string' || !params.action) {
    throw new Error('execute_by_marker: action is required and must be a non-empty string');
  }

  return {
    snapshotId,
    nebulaId: rawNebulaId,
    action: params.action,
    param: typeof params.param === 'string' ? params.param : undefined,
  };
}
