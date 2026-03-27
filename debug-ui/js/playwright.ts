/// <reference types="dom" />
// Playwright 控制功能

interface PlaywrightStatus {
  isOpen: boolean;
  currentUrl: string;
  lastScreenshot: string | null;
}

interface APIResponse<T = Record<string, unknown>> {
  success: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

interface ScreenshotResponse extends APIResponse {
  screenshot?: string;
  viewport?: { width: number; height: number };
}

interface StatusResponse extends APIResponse {
  isOpen?: boolean;
  url?: string;
}

interface ClickRequest {
  x: number;
  y: number;
}

interface NavigateRequest {
  url: string;
}

interface ScrollRequest {
  x: number;
  y: number;
}

interface ActionRequest {
  selector: string;
  action: string;
  param?: string;
}

interface DOMElement {
  tag: string;
  id?: string;
  class?: string;
  text?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  isVisible?: boolean;
  isInteractable?: boolean;
}

// Element info from Vision Marker Injector
interface ElementInfo {
  'data-nebula-id': string;
  tagName: string;
  bbox: { x: number; y: number; width: number; height: number };
  isInteractable: boolean;
  isVisible: boolean;
  text?: string;
  locatorBundle?: Record<string, unknown>;
}

interface DOMSnapshotResponse {
  snapshot_id: string;
  annotated_screenshot_base64: string;
  elements_map: [number, ElementInfo][];
  simplified_dom: unknown;
  version: string;
}

interface DOMResponse extends APIResponse {
  dom?: DOMSnapshotResponse | {
    elements?: DOMElement[];
  };
}


interface ActionParamPlaceholders {
  [key: string]: string;
}

declare global {
  interface Window {
    updateScreenshots?: (screenshot: string, viewport?: { width: number; height: number }) => void;
    renderElementsMap?: (elementsMap: [number, ElementInfo][]) => void;
    initPlaywrightControl?: () => Promise<void>;
    playwrightOpen?: () => Promise<void>;
    playwrightClose?: () => Promise<void>;
    playwrightNavigate?: () => Promise<void>;
    playwrightScreenshot?: () => Promise<void>;
    playwrightDownloadScreenshot?: () => Promise<void>;
    playwrightReconnectStream?: () => Promise<void>;
    playwrightClick?: () => Promise<void>;
    updateActionParam?: () => void;
    playwrightElementAction?: () => Promise<void>;
    playwrightScroll?: () => Promise<void>;
    playwrightClearLogs?: () => void;
    fetchDOM?: () => Promise<void>;
    fetchAnnotatedDOM?: () => Promise<void>;
    switchSelectorMode?: () => void;
    showImagePreview?: (src: string) => void;
    closeImagePreview?: (event?: Event) => void;
    toggleMarkerOverlay?: (checked: boolean) => void;
    initMarkerCheckbox?: () => void;
    liveView?: {
      stopPolling: () => void;
      startPolling: () => void;
      highlightElement: (bbox: { x: number; y: number; width: number; height: number }, element: { selector: string; tag: string; id?: string }) => void;
      setShowMarkerNumbers: (show: boolean) => void;
      updateElementsMap: (elementsMap: [number, ElementInfo][]) => void;
    };
  }
}

let playwrightStatus: PlaywrightStatus = {
  isOpen: false,
  currentUrl: '-',
  lastScreenshot: null,
};

const actionParamPlaceholders: ActionParamPlaceholders = {
  click: '',
  type: '输入文本',
  value: '设置值',
  focus: '',
  blur: '',
  hover: '',
  dispatch: '事件名 (如: change, input)',
};

async function initPlaywrightControl(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 100));

  try {
    const urlInput = document.getElementById('playwright-navigate-url') as HTMLInputElement;
    if (urlInput) {
      urlInput.addEventListener('keypress', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          playwrightNavigate();
        }
      });
    }

    const markerInput = document.getElementById('playwright-marker-id') as HTMLInputElement;
    if (markerInput) {
      markerInput.addEventListener('input', () => {
        const markerId = parseInt(markerInput.value, 10);
        if (markerId > 0 && cachedElementsMap.length > 0) {
          highlightElementByMarker(markerId);
        }
      });
    }

    window.addEventListener('playwrightStatusChanged', (e) => {
      playwrightStatus.isOpen = (e as CustomEvent).detail.isOpen;
      updatePlaywrightUI();
    });

    const statusResponse = await fetch('/debug/api/playwright/status');
    const statusData = (await statusResponse.json()) as StatusResponse;
    if (statusData.success) {
      playwrightStatus.isOpen = statusData.isOpen ?? false;
      playwrightStatus.currentUrl = statusData.url ?? '-';
    }

    updatePlaywrightUI();
    playwrightLog('info', 'Playwright 控制已初始化');
  } catch (error) {
    console.error('[Playwright] 初始化失败:', error);
    playwrightLog('error', '初始化失败: ' + (error as Error).message);
  }
}

function updatePlaywrightUI(): void {
  // 更新监控面板
  const monitorIndicator = document.getElementById('playwright-status-indicator');
  const monitorStatusText = document.getElementById('playwright-status-text');
  const monitorScreenshotBtn = document.getElementById('playwright-screenshot-btn');

  if (monitorIndicator) {
    if (playwrightStatus.isOpen) {
      monitorIndicator.classList.add('healthy');
      monitorIndicator.classList.remove('unhealthy');
    } else {
      monitorIndicator.classList.add('unhealthy');
      monitorIndicator.classList.remove('healthy');
    }
  }

  if (monitorStatusText) {
    monitorStatusText.textContent = playwrightStatus.isOpen ? '已连接' : '未连接';
  }

  if (monitorScreenshotBtn) {
    monitorScreenshotBtn.disabled = !playwrightStatus.isOpen;
  }

  // 更新控制面板
  const controlIndicator = document.getElementById('control-status-indicator');
  const controlStatusText = document.getElementById('control-status-text');
  const controlUrlDisplay = document.getElementById('control-current-url');

  if (controlIndicator) {
    if (playwrightStatus.isOpen) {
      controlIndicator.classList.add('healthy');
      controlIndicator.classList.remove('unhealthy');
    } else {
      controlIndicator.classList.add('unhealthy');
      controlIndicator.classList.remove('healthy');
    }
  }

  if (controlStatusText) {
    controlStatusText.textContent = playwrightStatus.isOpen ? '已连接' : '未连接';
  }

  if (controlUrlDisplay) {
    controlUrlDisplay.textContent = playwrightStatus.currentUrl;
  }

  // 控制面板按钮
  const controlIds = [
    'control-open-btn',
    'control-close-btn',
    'control-navigate-btn',
    'control-screenshot-btn',
    'control-download-btn',
    'control-click-btn',
    'control-action-btn',
    'control-scroll-btn',
  ];
  const openBtn = document.getElementById('control-open-btn') as HTMLButtonElement;
  const closeBtn = document.getElementById('control-close-btn') as HTMLButtonElement;
  const navigateBtn = document.getElementById('control-navigate-btn') as HTMLButtonElement;
  const screenshotBtn = document.getElementById('control-screenshot-btn') as HTMLButtonElement;
  const downloadBtn = document.getElementById('control-download-btn') as HTMLButtonElement;
  const clickBtn = document.getElementById('control-click-btn') as HTMLButtonElement;
  const actionBtn = document.getElementById('control-action-btn') as HTMLButtonElement;
  const scrollBtn = document.getElementById('control-scroll-btn') as HTMLButtonElement;
  if (openBtn) openBtn.disabled = playwrightStatus.isOpen;
  if (closeBtn) closeBtn.disabled = !playwrightStatus.isOpen;
  if (navigateBtn) navigateBtn.disabled = !playwrightStatus.isOpen;
  if (screenshotBtn) screenshotBtn.disabled = !playwrightStatus.isOpen;
  if (downloadBtn) downloadBtn.disabled = !playwrightStatus.isOpen;
  if (clickBtn) clickBtn.disabled = !playwrightStatus.isOpen;
  if (actionBtn) actionBtn.disabled = !playwrightStatus.isOpen;
  if (scrollBtn) scrollBtn.disabled = !playwrightStatus.isOpen;
}

async function playwrightOpen(): Promise<void> {
  try {
    playwrightLog('info', '正在打开浏览器...');

    const response = await fetch('/debug/api/playwright/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const data = (await response.json()) as APIResponse;

    if (data.success) {
      playwrightStatus.isOpen = true;
      updatePlaywrightUI();
      playwrightLog('success', data.message ?? '打开成功');
    } else {
      playwrightLog('error', '打开失败: ' + (data.error ?? '未知错误'));
    }
  } catch (err) {
    playwrightLog('error', '打开浏览器失败: ' + (err as Error).message);
  }
}

async function playwrightClose(): Promise<void> {
  try {
    playwrightLog('info', '正在关闭浏览器...');

    const response = await fetch('/debug/api/playwright/close', {
      method: 'POST',
    });

    const data = (await response.json()) as APIResponse;

    if (data.success) {
      playwrightStatus.isOpen = false;
      playwrightStatus.currentUrl = '-';
      playwrightStatus.lastScreenshot = null;
      updatePlaywrightUI();
      const previewDiv = document.getElementById('playwright-screenshot-preview');
      if (previewDiv) previewDiv.style.display = 'none';
      playwrightLog('success', data.message ?? '关闭成功');
    } else {
      playwrightLog('error', '关闭失败: ' + (data.error ?? '未知错误'));
    }
  } catch (err) {
    playwrightLog('error', '关闭浏览器失败: ' + (err as Error).message);
  }
}

async function playwrightNavigate(): Promise<void> {
  const urlInput = document.getElementById('playwright-navigate-url') as HTMLInputElement;
  const url = urlInput.value.trim();

  if (!url) {
    playwrightLog('error', '请输入要导航的 URL');
    return;
  }

  let fullUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    fullUrl = 'https://' + url;
  }

  try {
    playwrightLog('info', `正在导航到: ${fullUrl}...`);

    const body: NavigateRequest = { url: fullUrl };
    const response = await fetch('/debug/api/playwright/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as APIResponse;

    if (data.success) {
      playwrightStatus.currentUrl = fullUrl;
      const urlDisplay = document.getElementById('playwright-current-url');
      if (urlDisplay) urlDisplay.textContent = fullUrl;
      const controlUrlDisplay = document.getElementById('control-current-url');
      if (controlUrlDisplay) controlUrlDisplay.textContent = fullUrl;
      playwrightLog('success', data.message ?? '导航成功');
      urlInput.value = '';
    } else {
      playwrightLog('error', '导航失败: ' + (data.error ?? '未知错误'));
    }
  } catch (err) {
    playwrightLog('error', '导航失败: ' + (err as Error).message);
  }
}

async function playwrightScreenshot(): Promise<void> {
  try {
    playwrightLog('info', '正在获取截图...');

    const response = await fetch('/debug/api/playwright/screenshot');
    const data = (await response.json()) as ScreenshotResponse;

    if (data.success) {
      playwrightStatus.lastScreenshot = data.screenshot ?? null;
      if (data.screenshot && data.viewport) {
        if (typeof window.updateScreenshots === 'function') {
          window.updateScreenshots(data.screenshot, data.viewport);
        }
      }
      playwrightLog('success', '截图已更新');
    } else {
      playwrightLog('error', '截图失败: ' + (data.error ?? '未知错误'));
    }
  } catch (err) {
    playwrightLog('error', '截图失败: ' + (err as Error).message);
  }
}

async function playwrightDownloadScreenshot(): Promise<void> {
  try {
    playwrightLog('info', '正在下载截图...');

    const response = await fetch('/debug/api/playwright/screenshot');
    const data = (await response.json()) as ScreenshotResponse;

    console.log('[Screenshot] API response:', {
      success: data.success,
      hasScreenshot: !!data.screenshot,
      screenshotLength: data.screenshot?.length,
      error: data.error,
    });

    if (data.success && data.screenshot) {
      const link = document.createElement('a');
      link.href = `data:image/png;base64,${data.screenshot}`;
      link.download = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      playwrightLog('success', '截图已下载');
    } else {
      playwrightLog('error', '截图失败: ' + (data.error ?? '未知错误'));
    }
  } catch (err) {
    console.error('[Screenshot] Error:', err);
    playwrightLog('error', '下载截图失败: ' + (err as Error).message);
  }
}

async function playwrightReconnectStream(): Promise<void> {
  try {
    playwrightLog('info', '正在重新连接视频流...');
    if (typeof window.liveView !== 'undefined') {
      window.liveView.stopPolling();
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      window.liveView.startPolling();
      playwrightLog('success', '视频流已重新连接');
    } else {
      playwrightLog('error', 'LiveView 模块未加载');
    }
  } catch (err) {
    playwrightLog('error', '重新连接视频流失败: ' + (err as Error).message);
  }
}

async function playwrightClick(): Promise<void> {
  const xInput = document.getElementById('playwright-click-x') as HTMLInputElement;
  const yInput = document.getElementById('playwright-click-y') as HTMLInputElement;

  const x = parseInt(xInput.value, 10);
  const y = parseInt(yInput.value, 10);

  if (isNaN(x) || isNaN(y)) {
    playwrightLog('error', '请输入有效的坐标');
    return;
  }

  try {
    playwrightLog('info', `正在点击坐标 (${x}, ${y})...`);

    const body: ClickRequest = { x, y };
    const response = await fetch('/debug/api/playwright/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as APIResponse;

    if (data.success) {
      playwrightLog('success', data.message ?? '点击成功');
    } else {
      playwrightLog('error', '点击失败: ' + (data.error ?? '未知错误'));
    }
  } catch (err) {
    playwrightLog('error', '点击失败: ' + (err as Error).message);
  }
}

function updateActionParam(): void {
  const actionType = (document.getElementById('playwright-action-type') as HTMLSelectElement).value;
  const paramInput = document.getElementById('playwright-action-param') as HTMLInputElement;
  const placeholder = actionParamPlaceholders[actionType];
  if (placeholder) {
    paramInput.style.display = 'block';
    paramInput.placeholder = placeholder;
  } else {
    paramInput.style.display = 'none';
  }
}

async function playwrightElementAction(): Promise<void> {
  const modeSelect = document.getElementById('selector-mode') as HTMLSelectElement;
  const actionTypeSelect = document.getElementById('playwright-action-type') as HTMLSelectElement;
  const paramInput = document.getElementById('playwright-action-param') as HTMLInputElement;
  const action = actionTypeSelect.value;
  const param = paramInput.value;
  const mode = modeSelect?.value || 'css';

  const actionNames: Record<string, string> = {
    click: '点击',
    type: '输入文本',
    value: '设置值',
    focus: '聚焦',
    blur: '失焦',
    hover: '悬停',
    dispatch: '派发事件',
  };

  if (mode === 'marker') {
    const markerInput = document.getElementById('playwright-marker-id') as HTMLInputElement;
    const snapshotIdInput = document.getElementById('current-snapshot-id') as HTMLInputElement;
    const markerId = parseInt(markerInput?.value || '0', 10);
    const snapshotId = snapshotIdInput?.value;

    if (!markerId || markerId <= 0) {
      playwrightLog('error', '请输入有效的元素序号');
      return;
    }
    if (!snapshotId) {
      playwrightLog('error', '请先获取 DOM');
      return;
    }
    const needsParam = ['type', 'value', 'dispatch'].includes(action);
    if (needsParam && !param) {
      playwrightLog('error', '请输入参数值');
      return;
    }

    try {
      playwrightLog('info', `正在对元素 #${markerId} 执行 ${actionNames[action]}...`);
      const response = await fetch('/debug/api/playwright/execute-by-marker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot_id: snapshotId,
          nebula_id: markerId,
          action: action,
          param: param
        }),
      });
      const data = (await response.json()) as APIResponse;
      if (data.success) {
        playwrightLog('success', `已对元素 #${markerId} 执行 ${actionNames[action]}`);
        if (needsParam) paramInput.value = '';
      } else {
        playwrightLog('error', '操作失败: ' + (data.error ?? '未知错误'));
      }
    } catch (err) {
      playwrightLog('error', '操作失败: ' + (err as Error).message);
    }
  } else {
    const selectorInput = document.getElementById('playwright-action-selector') as HTMLInputElement;
    const selector = selectorInput.value.trim();

    if (!selector) {
      playwrightLog('error', '请输入 CSS 选择器');
      return;
    }

    const needsParam = ['type', 'value', 'dispatch'].includes(action);
    if (needsParam && !param) {
      playwrightLog('error', '请输入参数值');
      return;
    }

    try {
      playwrightLog('info', `正在对 ${selector} 执行 ${actionNames[action]}...`);
      const body: ActionRequest = { selector, action, param };
      const response = await fetch('/debug/api/playwright/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as APIResponse;
      if (data.success) {
        playwrightLog('success', data.message ?? '操作成功');
        if (needsParam) paramInput.value = '';
      } else {
        playwrightLog('error', '操作失败: ' + (data.error ?? '未知错误'));
      }
    } catch (err) {
      playwrightLog('error', '操作失败: ' + (err as Error).message);
    }
  }
}

async function playwrightScroll(): Promise<void> {
  const xInput = document.getElementById('playwright-scroll-x') as HTMLInputElement;
  const yInput = document.getElementById('playwright-scroll-y') as HTMLInputElement;

  const x = parseInt(xInput.value, 10) || 0;
  const y = parseInt(yInput.value, 10) || 0;

  try {
    playwrightLog('info', `正在滚动页面 (${x}, ${y})...`);

    const body: ScrollRequest = { x, y };
    const response = await fetch('/debug/api/playwright/scroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as APIResponse;

    if (data.success) {
      playwrightLog('success', data.message ?? '滚动成功');
    } else {
      playwrightLog('error', '滚动失败: ' + (data.error ?? '未知错误'));
    }
  } catch (err) {
    playwrightLog('error', '滚动失败: ' + (err as Error).message);
  }
}

function playwrightLog(level: string, message: string): void {
  const logsContainer = document.getElementById('playwright-logs-container');

  if (!logsContainer) {
    console.error('[Playwright] logs-container not found');
    return;
  }

  const emptyState = logsContainer.querySelector('div[style*="等待操作"]');
  if (emptyState) {
    emptyState.remove();
  }

  const entry = document.createElement('div');
  entry.style.cssText =
    'padding: 4px 0; border-bottom: 1px solid var(--border-color); display: flex; gap: 8px; font-size: 11px;';

  const timestamp = new Date().toLocaleTimeString();
  const levelColor =
    level === 'info'
      ? 'var(--accent-info)'
      : level === 'success'
        ? 'var(--accent-success)'
        : level === 'warning'
          ? 'var(--accent-warning)'
          : 'var(--accent-error)';

  entry.innerHTML = `<span class="text-muted flex-shrink-0">[${timestamp}]</span> <span class="font-medium flex-shrink-0" style="color: ${levelColor};">${level}</span> <span class="text-secondary">${message}</span>`;

  logsContainer.appendChild(entry);
  logsContainer.scrollTop = logsContainer.scrollHeight;

  while (logsContainer.children.length > 50) {
    logsContainer.removeChild(logsContainer.firstChild as HTMLElement);
  }
}

function playwrightClearLogs(): void {
  const logsContainer = document.getElementById('playwright-logs-container');

  if (!logsContainer) {
    console.error('[Playwright] logs-container not found');
    return;
  }

  logsContainer.innerHTML = '<div class="text-secondary py-0-5">等待操作...</div>';
  playwrightLog('info', '日志已清除');
}

async function fetchDOM(): Promise<void> {
  if (!playwrightStatus.isOpen) {
    playwrightLog('error', '请先打开浏览器');
    return;
  }
  try {
    playwrightLog('info', '正在获取 DOM...');
    const response = await fetch('/debug/api/dom');
    const data = (await response.json()) as DOMResponse;

    console.log(
      '[Frontend] DOM API response:',
      JSON.stringify({
        success: data.success,
        hasDom: !!data.dom,
        domKeys: data.dom ? Object.keys(data.dom) : [],
        hasAnnotatedScreenshot: !!(data.dom && 'annotated_screenshot_base64' in data.dom && data.dom.annotated_screenshot_base64),
        elementsMapLength: data.dom && 'elements_map' in data.dom ? (data.dom as DOMSnapshotResponse).elements_map?.length : 0,
        hasOldFormat: data.dom && 'elements' in data.dom,
        version: data.dom && 'version' in data.dom ? (data.dom as DOMSnapshotResponse).version : undefined,
      })
    );

    if (data.success && data.dom) {
      if ('annotated_screenshot_base64' in data.dom && 'elements_map' in data.dom) {
        const snapshot = data.dom as DOMSnapshotResponse;
        
        // Save snapshot_id for marker-based interactions
        const snapshotIdInput = document.getElementById('current-snapshot-id') as HTMLInputElement;
        if (snapshotIdInput && snapshot.snapshot_id) {
          snapshotIdInput.value = snapshot.snapshot_id;
        }
        
        if (snapshot.annotated_screenshot_base64) {
          if (typeof window.updateScreenshots === 'function') {
            window.updateScreenshots(snapshot.annotated_screenshot_base64);
          }
          playwrightLog('success', '已加载带标记的截图');
        }
        
        if (snapshot.elements_map) {
          let elementsCount = 0;
          let elementsMapArray: [number, ElementInfo][] = [];
          
          if (Array.isArray(snapshot.elements_map)) {
            elementsMapArray = snapshot.elements_map;
            elementsCount = snapshot.elements_map.length;
          } else if (typeof snapshot.elements_map === 'object') {
            const record = snapshot.elements_map as Record<string, any>;
            elementsMapArray = Object.entries(record).map(([id, info], index) => [
              index + 1,
              {
                'data-nebula-id': id,
                tagName: info.tag,
                bbox: info.bbox,
                isInteractable: true,
                isVisible: true,
                text: info.text,
                locatorBundle: info.locator_bundle,
              }
            ]) as [number, ElementInfo][];
            elementsCount = elementsMapArray.length;
          }
          
          if (elementsMapArray.length > 0 && typeof window.renderElementsMap === 'function') {
            window.renderElementsMap(elementsMapArray);
          }
          playwrightLog('success', `获取到 ${elementsCount} 个元素`);
        }
      } else {
        console.warn('[Frontend] DOM data missing or invalid:', data.dom);
        playwrightLog('error', '获取 DOM 失败: 返回的数据格式不正确');
      }
    } else {
      playwrightLog('error', '获取 DOM 失败: ' + (data.error ?? '未知错误'));
    }
  } catch (err) {
    console.error('[Frontend] Error fetching DOM:', err);
    playwrightLog('error', '获取 DOM 失败: ' + (err as Error).message);
  }
}
let cachedElementsMap: [number, ElementInfo][] = [];

function renderElementsMap(elementsMap: [number, ElementInfo][]): void {
  cachedElementsMap = elementsMap;
  if (window.liveView?.updateElementsMap) {
    window.liveView.updateElementsMap(elementsMap);
  }
  const display = document.getElementById('elementsMapDisplay');
  if (!display) {
    console.warn('[playwright] elementsMapDisplay element not found');
    return;
  }
  if (!elementsMap || elementsMap.length === 0) {
    display.innerHTML = '<div class="empty-state">暂无元素数据</div>';
    return;
  }
  
  let html = '<table class="elements-map-table">';
  html += '<thead>';
  html += '<tr>';
  html += '<th class="text-12">#</th>';
  html += '<th class="text-12">Tag</th>';
  html += '<th class="text-12">ID</th>';
  html += '<th class="text-12">Text</th>';
  html += '<th class="text-12">BBox</th>';
  html += '<th class="text-12">Visible</th>';
  html += '</tr>';
  html += '</thead>';
  html += '<tbody>';
  
  elementsMap.forEach(([markerNumber, elementInfo]) => {
    const id = elementInfo['data-nebula-id'];
    const tag = elementInfo.tagName;
    const text = elementInfo.text ? elementInfo.text.substring(0, 20) : '';
    const bbox = elementInfo.bbox;
    const bboxStr = `(${bbox.x}, ${bbox.y})`;
    const visible = elementInfo.isVisible ? '✓' : '✗';
    const interactable = elementInfo.isInteractable ? '✓' : '✗';
    
    html += '<tr class="elements-map-row" data-marker="' + markerNumber + '" data-element-id="' + id + '" data-bbox=\'' + JSON.stringify(bbox) + '\'>';
    html += '<td class="text-12 font-mono">' + markerNumber + '</td>';
    html += '<td class="text-12"><code>' + tag + '</code></td>';
    html += '<td class="text-12 text-muted font-mono">' + id + '</td>';
    html += '<td class="text-12 text-muted">' + text + '</td>';
    html += '<td class="text-12 text-muted font-mono">' + bboxStr + '</td>';
    html += '<td class="text-12">' + visible + ' ' + interactable + '</td>';
    html += '</tr>';
  });
  
  html += '</tbody>';
  html += '</table>';
  display.innerHTML = html;
  
  display.querySelectorAll('.elements-map-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const marker = parseInt((e.currentTarget as HTMLElement).dataset.marker || '0');
      highlightElementByMarker(marker);
    });
  });
}

// Global function for onclick handler in HTML
declare global {
  interface Window {
    highlightElementByMarker?: (markerNumber: number) => void;
  }
}

(window as any).highlightElementByMarker = highlightElementByMarker;

function highlightElementByMarker(markerNumber: number): void {
  const display = document.getElementById('elementsMapDisplay');
  if (!display) return;
  
  const row = display.querySelector(`tr[data-marker="${markerNumber}"]`) as HTMLElement;
  if (!row) return;
  
  const elementId = row.dataset.elementId;
  const bboxStr = row.dataset.bbox;
  
  console.log('[Playwright] Highlighting element:', { markerNumber, elementId, bboxStr });
  
  display.querySelectorAll('.elements-map-row').forEach(r => {
    r.classList.remove('selected');
  });
  row.classList.add('selected');
  
  if (bboxStr && window.liveView) {
    try {
      const bbox = JSON.parse(bboxStr);
      window.liveView.highlightElement(bbox, {
        selector: `#${elementId}`,
        tag: row.querySelector('td:nth-child(2) code')?.textContent || '',
        id: elementId,
      });
    } catch (e) {
      console.warn('[Playwright] Failed to parse bbox:', e);
    }
  }
  
  const markerInput = document.getElementById('playwright-marker-id') as HTMLInputElement;
  const modeSelect = document.getElementById('selector-mode') as HTMLSelectElement;
  const markerModeInput = document.getElementById('marker-mode-input') as HTMLElement;
  const cssModeInput = document.getElementById('css-mode-input') as HTMLElement;
  
  if (markerInput) {
    markerInput.value = markerNumber.toString();
  }
  if (modeSelect) {
    modeSelect.value = 'marker';
  }
  if (markerModeInput && cssModeInput) {
    markerModeInput.style.display = 'block';
    cssModeInput.style.display = 'none';
  }
  
  playwrightLog('info', `已选择元素 #${markerNumber}: ${elementId}`);
}

function switchSelectorMode(): void {
  const modeSelect = document.getElementById('selector-mode') as HTMLSelectElement;
  const markerModeInput = document.getElementById('marker-mode-input') as HTMLElement;
  const cssModeInput = document.getElementById('css-mode-input') as HTMLElement;
  
  if (!modeSelect || !markerModeInput || !cssModeInput) return;
  
  if (modeSelect.value === 'marker') {
    markerModeInput.style.display = 'block';
    cssModeInput.style.display = 'none';
  } else {
    markerModeInput.style.display = 'none';
    cssModeInput.style.display = 'block';
  }
}


async function fetchAnnotatedDOM(): Promise<void> {
  try {
    playwrightLog('info', '正在获取 Annotated DOM 截图...');
    const response = await fetch('/debug/api/dom?version=2.0');
    const data = (await response.json()) as any;

    if (data.success && data.dom) {
      const dom = data.dom;
      document.getElementById('annotated-snapshot-id')!.textContent = `ID: ${dom.snapshot_id || '-'}`;
      document.getElementById('annotated-version')!.textContent = `Ver: ${dom.version || '-'}`;

      if (dom.annotated_screenshot_base64) {
        try {
          // Decode base64 to binary string
          const binaryString = atob(dom.annotated_screenshot_base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          let url: string;
          if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
            // Decompress using DecompressionStream
            const ds = new DecompressionStream('gzip');
            const writer = ds.writable.getWriter();
            writer.write(bytes);
            writer.close();

            const reader = ds.readable.getReader();
            const chunks: Uint8Array[] = [];
            let totalLength = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
                totalLength += value.length;
              }
            }

            // Combine chunks
            const decompressed = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              decompressed.set(chunk, offset);
              offset += chunk.length;
            }

            // Create Blob and Object URL
            const blob = new Blob([decompressed], { type: 'image/jpeg' }); // Assuming JPEG or PNG
            url = URL.createObjectURL(blob);
          } else {
            // Not gzipped, assume it's a direct base64 image
            url = `data:image/jpeg;base64,${dom.annotated_screenshot_base64}`;
          }

          const img = document.getElementById('annotated-screenshot-img') as HTMLImageElement;
          const placeholder = document.getElementById('annotated-screenshot-placeholder');
          if (img && placeholder) {
            img.src = url;
            img.style.display = 'block';
            placeholder.style.display = 'none';
          }
          playwrightLog('success', '成功获取并解压 Annotated 截图');
        } catch (e) {
          console.error('[Frontend] Decompression failed:', e);
          playwrightLog('error', '解压截图失败: ' + (e as Error).message);
        }
      } else {
        playwrightLog('warning', '返回的数据中没有 annotated_screenshot_base64');
      }
    } else {
      playwrightLog('error', '获取 Annotated DOM 失败: ' + (data.error ?? '未知错误'));
    }
  } catch (err) {
    console.error('[Frontend] Error fetching Annotated DOM:', err);
    playwrightLog('error', '获取 Annotated DOM 失败: ' + (err as Error).message);
  }
}

function showImagePreview(src: string): void {
  const modal = document.getElementById('image-preview-modal');
  const img = document.getElementById('image-preview-img') as HTMLImageElement;
  if (modal && img) {
    img.src = src;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
}

function closeImagePreview(event?: Event): void {
  const modal = document.getElementById('image-preview-modal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

function toggleMarkerOverlay(checked: boolean): void {
  if (typeof window.liveView !== 'undefined') {
    (window.liveView as any).setShowMarkerNumbers(checked);
  }
  localStorage.setItem('showMarkerNumbers', String(checked));
}

function initMarkerCheckbox(): void {
  const checkbox = document.getElementById('show-marker-numbers') as HTMLInputElement;
  if (checkbox) {
    const saved = localStorage.getItem('showMarkerNumbers');
    checkbox.checked = saved === 'true';
    toggleMarkerOverlay(checkbox.checked);
  }
}

if (typeof window !== 'undefined') {
  window.initPlaywrightControl = initPlaywrightControl;
  window.playwrightOpen = playwrightOpen;
  window.playwrightClose = playwrightClose;
  window.playwrightNavigate = playwrightNavigate;
  window.playwrightScreenshot = playwrightScreenshot;
  window.playwrightDownloadScreenshot = playwrightDownloadScreenshot;
  window.playwrightReconnectStream = playwrightReconnectStream;
  window.playwrightClick = playwrightClick;
  window.updateActionParam = updateActionParam;
  window.playwrightElementAction = playwrightElementAction;
  window.playwrightScroll = playwrightScroll;
  window.playwrightClearLogs = playwrightClearLogs;
  window.fetchDOM = fetchDOM;
  window.fetchAnnotatedDOM = fetchAnnotatedDOM;
  window.renderElementsMap = renderElementsMap;
  window.switchSelectorMode = switchSelectorMode;
  window.showImagePreview = showImagePreview;
  window.closeImagePreview = closeImagePreview;
  window.toggleMarkerOverlay = toggleMarkerOverlay;
  window.initMarkerCheckbox = initMarkerCheckbox;
}

export {};
