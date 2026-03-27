// UI 更新和状态管理


interface Viewport {
  width: number;
  height: number;
}

interface AILog {
  type: string;
  modelType: string;
  provider: string;
  model: string;
  success: boolean;
  responseTime?: number;
  input?: string;
  output?: string;
  error?: string;
}

interface PlaywrightStatusDetail {
  status?: string;
  isOpen: boolean;
  url?: string;
}

interface ServiceStatusUI {
  playwright?: {
    status?: string;
    isOpen: boolean;
  };
}

// 通知系统
export function showNotification(
  type: 'error' | 'success' | 'warning',
  message: string,
  duration: number = 5000
): void {
  const container = document.getElementById('notificationContainer');
  if (!container) return;

  const notification = document.createElement('div');
  notification.className = `notification ${type}`;

  const icons: Record<string, string> = {
    error: '❌',
    success: '✅',
    warning: '⚠️',
  };

  notification.innerHTML = `
        <span class="notification-icon">${icons[type] || 'ℹ️'}</span>
        <span class="notification-message">${message}</span>
        <span class="notification-close" onclick="this.parentElement.remove()">×</span>
    `;

  container.appendChild(notification);

  if (duration > 0) {
    setTimeout(() => {
      notification.style.animation = 'fadeOut 0.3s ease-out forwards';
      setTimeout(() => notification.remove(), 300);
    }, duration);
  }
}

export function showError(message: string, duration: number = 5000): void {
  showNotification('error', message, duration);
  if (typeof (window as any).appendLog === 'function') {
    (window as any).appendLog('error', message);
  }
}

export function showSuccess(message: string, duration: number = 3000): void {
  showNotification('success', message, duration);
  if (typeof (window as any).appendLog === 'function') {
    (window as any).appendLog('success', message);
  }
}

export function showWarning(message: string, duration: number = 4000): void {
  showNotification('warning', message, duration);
  if (typeof (window as any).appendLog === 'function') {
    (window as any).appendLog('warning', message);
  }
}

// 辅助函数
export function updateStatus(connected: boolean, status: string, message: string): void {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const connectionStatusBadge = document.getElementById('connectionStatusBadge');
  const connectionStatusText = document.getElementById('connectionStatus');

  if (statusIndicator) {
    if (connected) {
      statusIndicator.classList.add('online');
      statusIndicator.classList.remove('offline');
    } else {
      statusIndicator.classList.add('offline');
      statusIndicator.classList.remove('online');
    }
  }

  if (statusText) {
    statusText.textContent = message || (connected ? '在线' : '离线');
  }

  if (connectionStatusBadge) {
    if (connected) {
      connectionStatusBadge.classList.add('online');
      connectionStatusBadge.classList.remove('offline');
    } else {
      connectionStatusBadge.classList.add('offline');
      connectionStatusBadge.classList.remove('online');
    }
  }

  if (connectionStatusText) {
    connectionStatusText.textContent = message || (connected ? '在线' : '离线');
  }
}

export function appendLog(type: string, message: string): void {
  const logDisplay = document.getElementById('logDisplay');
  if (!logDisplay) return;

  const emptyState = logDisplay.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${type}: ${message}`;
  logDisplay.appendChild(entry);
  entry.scrollIntoView();
}

export function updateScreenshots(screenshot: string, viewport?: Viewport): void {
  if (typeof (window as any).liveView !== 'undefined') {
    (window as any).liveView.updateFrame(screenshot, viewport);
  }
}

export function updateDecisions(decision: unknown): void {
  const display = document.getElementById('decisionDisplay');
  if (!display) return;
  if (decision) {
    const content =
      typeof decision === 'object' ? JSON.stringify(decision, null, 2) : String(decision);
    display.innerHTML = `<div class="log-entry"><span class="log-message" style="color: var(--accent-success);">${content}</span></div>`;
  } else {
    display.innerHTML = `<div class="empty-state">暂无决策</div>`;
  }
}

// 折叠面板切换
function toggleAccordion(header: HTMLElement): void {
  const content = header.nextElementSibling as HTMLElement;
  const isExpanded = header.classList.contains('expanded');

  document.querySelectorAll('.accordion-header.expanded').forEach((h: Element) => {
    h.classList.remove('expanded');
    if (h.nextElementSibling) {
      h.nextElementSibling.classList.remove('expanded');
    }
  });

  if (!isExpanded) {
    header.classList.add('expanded');
    if (content) {
      content.classList.add('expanded');
    }
  }

  header.style.transform = isExpanded ? 'scale(0.98)' : 'scale(1.02)';
  setTimeout(() => {
    header.style.transform = '';
  }, 150);
}

// 右侧面板选项卡
function initRightPanelTabs(): void {
  const tabs = document.querySelectorAll('.right-panel-tab[data-right-tab]');
  tabs.forEach((tab: Element) => {
    tab.addEventListener('click', () => {
      const tabName = (tab as HTMLElement).dataset.rightTab;
      tabs.forEach((t: Element) => {
        t.classList.remove('active');
      });
      tab.classList.add('active');
      document.querySelectorAll('.right-panel-tab-page').forEach((p: Element) => {
        p.classList.remove('active');
      });
      const page = document.getElementById(`right-${tabName}`);
      if (page) {
        page.classList.add('active');
      }
    });
  });
}

// 历史面板选项卡
function initHistoryPanelTabs(): void {
  const tabs = document.querySelectorAll('.sidebar-tab[data-history-tab]');
  tabs.forEach((tab: Element) => {
    tab.addEventListener('click', () => {
      const tabName = (tab as HTMLElement).dataset.historyTab;
      tabs.forEach((t: Element) => {
        t.classList.remove('active');
      });
      tab.classList.add('active');
      document.querySelectorAll('.sidebar-tab-page').forEach((p: Element) => {
        p.classList.remove('active');
      });
      const page = document.getElementById(`history-${tabName}`);
      if (page) {
        page.classList.add('active');
      }
    });
  });
}

// Sidebar 切换
function switchSidebar(panelName: string): void {
  document.querySelectorAll('.activity-item[data-panel]').forEach((item: Element) => {
    item.classList.remove('active');
    if ((item as HTMLElement).dataset.panel === panelName) {
      item.classList.add('active');
    }
  });
  document.querySelectorAll('.sidebar-panel').forEach((panel: Element) => {
    panel.classList.remove('active');
  });
  const targetPanel = document.getElementById(`sidebar-${panelName}`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }

  // Switch main content
  document.querySelectorAll('.main-content-page').forEach((page: Element) => {
    page.classList.remove('active');
  });
  const targetMain = document.getElementById(`main-${panelName}`);
  if (targetMain) {
    targetMain.classList.add('active');
  } else {
    const defaultMain = document.getElementById('main-monitor');
    if (defaultMain) defaultMain.classList.add('active');
  }

  if (panelName === 'interactions' && typeof (window as any).fetchInteractions === 'function') {
    (window as any).fetchInteractions();
  }
}

// 活动栏初始化
function initActivityBar(): void {}

// 更新服务状态 UI
export function updateServiceStatusUI(services: ServiceStatusUI): void {
  if (!services) return;
  if (services.playwright) {
    const sidebarIndicator = document.getElementById('playwright-status-indicator');
    const sidebarText = document.getElementById('playwright-status-text');
    if (sidebarIndicator) {
      sidebarIndicator.classList.remove('online', 'offline');
      sidebarIndicator.classList.add(
        services.playwright.status === 'healthy' ? 'online' : 'offline'
      );
    }
    if (sidebarText) {
      sidebarText.textContent = services.playwright.isOpen ? '已连接' : '未连接';
    }

    const configIndicator = document.getElementById('indicator-playwright');
    if (configIndicator) {
      configIndicator.classList.remove('healthy', 'unhealthy', 'unknown');
      configIndicator.classList.add(services.playwright.status || 'unknown');
    }

    window.dispatchEvent(
      new CustomEvent('playwrightStatusChanged', {
        detail: { isOpen: services.playwright.isOpen },
      })
    );
  }
}

export function updatePlaywrightStatus(status: PlaywrightStatusDetail): void {
  if (!status) return;
  const indicator = document.getElementById('playwright-status-indicator');
  const text = document.getElementById('playwright-status-text');
  const controlIndicator = document.getElementById('control-status-indicator');
  const controlText = document.getElementById('control-status-text');
  const controlUrl = document.getElementById('control-current-url');
  const screenshotUrl = document.getElementById('screenshot-url');
  if (indicator) {
    indicator.classList.remove('online', 'offline');
    indicator.classList.add(status.status === 'healthy' ? 'online' : 'offline');
  }
  if (text) {
    text.textContent = status.isOpen ? '已连接' : '未连接';
  }
  if (controlIndicator) {
    controlIndicator.classList.remove('online', 'offline');
    controlIndicator.classList.add(status.isOpen ? 'online' : 'offline');
  }
  if (controlText) {
    controlText.textContent = status.isOpen ? '已连接' : '未连接';
  }
  if (controlUrl) {
    controlUrl.textContent = status.url || '-';
  }
  if (screenshotUrl) {
    screenshotUrl.textContent = status.url || '-';
  }
  const openBtn = document.getElementById('control-open-btn') as HTMLButtonElement;
  const closeBtn = document.getElementById('control-close-btn') as HTMLButtonElement;
  const navigateBtn = document.getElementById('control-navigate-btn') as HTMLButtonElement;
  const screenshotBtn = document.getElementById('control-screenshot-btn') as HTMLButtonElement;
  const downloadBtn = document.getElementById('control-download-btn') as HTMLButtonElement;
  const clickBtn = document.getElementById('control-click-btn') as HTMLButtonElement;
  const typeBtn = document.getElementById('control-type-btn') as HTMLButtonElement;
  const scrollBtn = document.getElementById('control-scroll-btn') as HTMLButtonElement;
  if (openBtn) openBtn.disabled = status.isOpen;
  if (closeBtn) closeBtn.disabled = !status.isOpen;
  if (navigateBtn) navigateBtn.disabled = !status.isOpen;
  if (screenshotBtn) screenshotBtn.disabled = !status.isOpen;
  if (downloadBtn) downloadBtn.disabled = !status.isOpen;
  if (clickBtn) clickBtn.disabled = !status.isOpen;
  if (typeBtn) typeBtn.disabled = !status.isOpen;
  if (scrollBtn) scrollBtn.disabled = !status.isOpen;
  const screenshotBtn2 = document.getElementById('playwright-screenshot-btn') as HTMLButtonElement;
  const fetchAnnotatedDomBtn = document.getElementById('fetch-annotated-dom-btn') as HTMLButtonElement;
  if (screenshotBtn2) screenshotBtn2.disabled = !status.isOpen;
  if (fetchAnnotatedDomBtn) fetchAnnotatedDomBtn.disabled = !status.isOpen;
  window.dispatchEvent(
    new CustomEvent('playwrightStatusChanged', {
      detail: { isOpen: status.isOpen },
    })
  );
}

function initScreenshotClickHandler(): void {}

function showClickMarker(container: HTMLElement, x: number, y: number): void {}

let elementPickerActive = false;

function toggleElementPicker(): void {
  const checkbox = document.getElementById('element-picker-mode') as HTMLInputElement;
  elementPickerActive = checkbox && checkbox.checked;
  if (typeof (window as any).liveView !== 'undefined') {
    (window as any).liveView.setPickerMode(elementPickerActive);
  }
  if (elementPickerActive) {
    showSuccess('元素选择模式已开启,在画面上移动查看坐标');
    const modeSelect = document.getElementById('selector-mode') as HTMLSelectElement;
    const markerModeInput = document.getElementById('marker-mode-input') as HTMLElement;
    const cssModeInput = document.getElementById('css-mode-input') as HTMLElement;
    if (modeSelect) {
      modeSelect.value = 'css';
    }
    if (markerModeInput && cssModeInput) {
      markerModeInput.style.display = 'none';
      cssModeInput.style.display = 'block';
    }
  }
}

// AI Log Management
let aiLogs: AILog[] = [];

export function addAICallLog(log: AILog): void {
  aiLogs.unshift(log);
  if (aiLogs.length > 50) aiLogs.pop();
  renderAILogs();
}

function renderAILogs(): void {
  const container = document.getElementById('fullLogDisplay');
  if (!container) return;

  if (aiLogs.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无日志</div>';
    return;
  }

  let html = '<div class="ai-logs-container">';
  aiLogs.forEach((log: AILog, index: number) => {
    const statusClass = log.success ? 'success' : 'error';
    const time = new Date().toLocaleTimeString();

    html += `
            <div class="ai-log-item ${statusClass}" onclick="window.showAILogModal(${index})">
                <div class="ai-log-header">
                    <span class="ai-log-type">${log.type}</span>
                    <span class="model-badge ${log.modelType}">${log.modelType}</span>
                    <span class="ai-log-status ${statusClass}">${log.success ? '成功' : '失败'}</span>
                    <span class="ai-log-time">${time}</span>
                </div>
                <div class="ai-log-preview">${escapeHtml(log.input || '')}</div>
                <div class="ai-log-duration">${log.responseTime ? log.responseTime + 'ms' : ''}</div>
            </div>
        `;
  });
  html += '</div>';
  container.innerHTML = html;
}

function showAILogModal(index: number): void {
  const log = aiLogs[index];
  if (!log) return;

  const modal = document.getElementById('ai-log-modal') as HTMLElement;
  const body = document.getElementById('modal-body') as HTMLElement;
  if (!modal || !body) return;

  const content = `
        <div class="space-y-4">
            <div class="grid grid-cols-2 gap-4 text-xs">
                <div><span class="text-muted">类型:</span> ${log.type}</div>
                <div><span class="text-muted">模型类型:</span> ${log.modelType}</div>
                <div><span class="text-muted">提供商:</span> ${log.provider}</div>
                <div><span class="text-muted">模型名称:</span> ${log.model}</div>
                <div><span class="text-muted">状态:</span> <span class="${log.success ? 'text-success' : 'text-error'}">${log.success ? '成功' : '失败'}</span></div>
                <div><span class="text-muted">耗时:</span> ${log.responseTime ? log.responseTime + 'ms' : '-'}</div>
            </div>

            <div>
                <div class="text-xs font-semibold mb-1">输入</div>
                <pre class="bg-secondary p-2 rounded text-xs overflow-auto max-h-40">${escapeHtml(log.input || '')}</pre>
            </div>

            <div>
                <div class="text-xs font-semibold mb-1">输出</div>
                <pre class="bg-secondary p-2 rounded text-xs overflow-auto max-h-60">${escapeHtml(log.output || log.error || '')}</pre>
            </div>

            <div class="flex justify-end pt-4 border-t border-border">
                <button onclick="window.continueChatFromLog(${index})" class="primary">
                    💬 继续对话
                </button>
            </div>
        </div>
    `;

  body.innerHTML = content;
  modal.style.display = 'flex';
}

function closeAILogModal(): void {
  const modal = document.getElementById('ai-log-modal') as HTMLElement;
  if (modal) modal.style.display = 'none';
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function continueChatFromLog(index: number): Promise<void> {
  const log = aiLogs[index];
  if (!log) return;

  closeAILogModal();

  // Switch to AI panel
  switchSidebar('ai');

  // Create new session
  const title = `Continued from log ${new Date().toLocaleTimeString()}`;
  try {
    const res = await fetch('/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title,
        provider: log.provider,
        model: log.model,
      }),
    });
    const data = (await res.json()) as { success: boolean; session?: { id: string } };

    if (data.success && data.session) {
      const sessionId = data.session.id;

      // Add context messages
      // We add the input as user message and output as assistant message
      const messages = [
        { role: 'user', content: log.input },
        { role: 'assistant', content: log.output || log.error },
      ];

      await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      if ((window as any).chatManager) {
        await (window as any).chatManager.loadSessions();
        (window as any).chatManager.switchSession(sessionId);
      }

      showSuccess('已从日志创建会话');
    }
  } catch (e) {
    console.error('Failed to continue chat:', e);
    showError('无法从日志创建会话');
  }
}

// Expose functions globally
if (typeof window !== 'undefined') {
  window.addAICallLog = addAICallLog;
  window.showAILogModal = showAILogModal;
  window.closeAILogModal = closeAILogModal;
  window.continueChatFromLog = continueChatFromLog;
  // 导出 HTML onclick 需要的函数
  window.toggleAccordion = toggleAccordion;
  window.switchSidebar = switchSidebar;
  // 导出 main.ts 初始化依赖函数
  window.initRightPanelTabs = initRightPanelTabs;
  window.initHistoryPanelTabs = initHistoryPanelTabs;
  window.initActivityBar = initActivityBar;
  // 导出 HTML onchange 需要的函数
  (window as any).toggleElementPicker = toggleElementPicker;
}

// 声明全局 Window 接口扩展
declare global {
  interface Window {
    addAICallLog: typeof addAICallLog;
    showAILogModal: typeof showAILogModal;
    closeAILogModal: typeof closeAILogModal;
    continueChatFromLog: typeof continueChatFromLog;
    toggleAccordion: typeof toggleAccordion;
    switchSidebar: typeof switchSidebar;
  }
}

export {};
