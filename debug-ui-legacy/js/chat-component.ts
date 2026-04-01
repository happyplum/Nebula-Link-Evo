interface ChatManagerApi {
  switchSession: (sessionId: string) => Promise<void> | void;
  createSession: () => Promise<void> | void;
  deleteCurrentSession: () => Promise<void> | void;
  toggleCoT: (enabled: boolean) => void;
  sendMessage: () => void;
  captureScreenshot: () => Promise<void> | void;
  clearScreenshot: () => void;
  setStatusFilter: (filter: string) => void;
  readonly isStreaming: boolean;
}

declare global {
  interface Window {
    chatComponent?: {
      show: () => void;
      hide: () => void;
      syncChatPageFromSidebar: () => void;
    };
  }
}

const CHAT_PAGE_CONTAINER_ID = 'chat-page-container';
const MAIN_LAYOUT_SELECTORS = ['.activity-bar', '.sidebar', 'main', '#rightPanel'];

const sidebarSyncSource = {
  sessionStatusFilter: 'session-status-filter',
  sessionSelect: 'session-select',
  cotToggle: 'cot-toggle',
  controlBar: 'chat-control-bar',
  interruptBtn: 'interrupt-btn',
  pauseBtn: 'pause-btn',
  resumeBtn: 'resume-btn',
  cancelBtn: 'cancel-btn',
  pausingFeedback: 'pausing-feedback',
  messages: 'chat-messages',
  screenshotPreview: 'screenshot-preview',
  input: 'chat-input',
  modelSelector: 'chat-model-selector',
} as const;

const chatPageIds = {
  root: 'chat-page-sidebar-ai',
  sessionStatusFilter: 'chat-page-session-status-filter',
  sessionSelect: 'chat-page-session-select',
  cotToggle: 'chat-page-cot-toggle',
  createButton: 'chat-page-create-session-btn',
  deleteButton: 'chat-page-delete-session-btn',
  controlBar: 'chat-page-chat-control-bar',
  interruptBtn: 'chat-page-interrupt-btn',
  pauseBtn: 'chat-page-pause-btn',
  resumeBtn: 'chat-page-resume-btn',
  cancelBtn: 'chat-page-cancel-btn',
  pausingFeedback: 'chat-page-pausing-feedback',
  panesContainer: 'chat-page-chat-panes-container',
  messages: 'chat-page-chat-messages',
  screenshotPreview: 'chat-page-screenshot-preview',
  modelSelector: 'chat-page-chat-model-selector',
  input: 'chat-page-chat-input',
  screenshotButton: 'chat-page-screenshot-btn',
  sendButton: 'chat-page-send-btn',
} as const;

let chatPageContainer: HTMLElement | null = null;
let hiddenLayoutElements: HTMLElement[] = [];
let sidebarObserver: MutationObserver | null = null;
let eventCleanupCallbacks: Array<() => void> = [];
let lastSyncTime = 0;
const SYNC_THROTTLE_MS = 200;

function hideMainLayout(): void {
  hiddenLayoutElements = [];

  for (const selector of MAIN_LAYOUT_SELECTORS) {
    const element = document.querySelector(selector) as HTMLElement | null;
    if (!element) {
      continue;
    }

    element.dataset.chatComponentPrevDisplay = element.style.display || '';
    element.style.display = 'none';
    hiddenLayoutElements.push(element);
  }
}

function showMainLayout(): void {
  hiddenLayoutElements.forEach((element) => {
    element.style.display = element.dataset.chatComponentPrevDisplay || '';
    delete element.dataset.chatComponentPrevDisplay;
  });
  hiddenLayoutElements = [];
}

function getChatManager(): ChatManagerApi | null {
  return (window as Window & { chatManager?: ChatManagerApi }).chatManager || null;
}

function invokeChatManagerMethod(chatManager: ChatManagerApi, method: string): void {
  const target = (chatManager as unknown as Record<string, unknown>)[method];
  if (typeof target === 'function') {
    (target as () => void).call(chatManager);
  }
}

function copySelectState(sourceId: string, targetId: string): void {
  const source = document.getElementById(sourceId) as HTMLSelectElement | null;
  const target = document.getElementById(targetId) as HTMLSelectElement | null;
  if (!source || !target) {
    return;
  }

  target.innerHTML = source.innerHTML;
  target.value = source.value;
}

function copyInputValue(sourceId: string, targetId: string): void {
  const source = document.getElementById(sourceId) as HTMLTextAreaElement | HTMLInputElement | null;
  const target = document.getElementById(targetId) as HTMLTextAreaElement | HTMLInputElement | null;
  if (!source || !target) {
    return;
  }

  target.value = source.value;
}

function copyCheckboxState(sourceId: string, targetId: string): void {
  const source = document.getElementById(sourceId) as HTMLInputElement | null;
  const target = document.getElementById(targetId) as HTMLInputElement | null;
  if (!source || !target) {
    return;
  }

  target.checked = source.checked;
}

function copyElementVisibilityAndContent(sourceId: string, targetId: string): void {
  const source = document.getElementById(sourceId) as HTMLElement | null;
  const target = document.getElementById(targetId) as HTMLElement | null;
  if (!source || !target) {
    return;
  }

  target.innerHTML = source.innerHTML;
  target.style.display = source.style.display;
  target.className = source.className;
}

/**
 * Incremental message sync: only append new messages and update the
 * streaming tail — avoids full innerHTML replacement during streaming.
 */
function incrementalMessageSync(sourceId: string, targetId: string): void {
  const source = document.getElementById(sourceId) as HTMLElement | null;
  const target = document.getElementById(targetId) as HTMLElement | null;
  if (!source || !target) {
    return;
  }

  target.style.display = source.style.display;
  target.className = source.className;

  const sourceChildren = source.children;
  const targetChildren = target.children;

  // Append new message nodes that target doesn't have yet
  for (let i = targetChildren.length; i < sourceChildren.length; i++) {
    const clone = sourceChildren[i]!.cloneNode(true) as HTMLElement;
    target.appendChild(clone);
  }

  // Update the last message's content (the one being streamed)
  if (sourceChildren.length > 0) {
    const lastIdx = sourceChildren.length - 1;
    const sourceMsg = sourceChildren[lastIdx] as HTMLElement;
    const targetMsg = targetChildren[lastIdx] as HTMLElement;
    if (sourceMsg && targetMsg && sourceMsg.dataset.id === targetMsg.dataset.id) {
      // Update only the mutable parts — msg-content and thinking-content
      const sourceContent = sourceMsg.querySelector('.msg-content');
      const targetContent = targetMsg.querySelector('.msg-content');
      if (sourceContent && targetContent) {
        targetContent.innerHTML = sourceContent.innerHTML;
      }
      const sourceThinking = sourceMsg.querySelector('.thinking-content');
      const targetThinking = targetMsg.querySelector('.thinking-content');
      if (sourceThinking && targetThinking) {
        targetThinking.innerHTML = sourceThinking.innerHTML;
      }
      const sourceThinkingDisplay = sourceMsg.querySelector('.thinking-block');
      const targetThinkingBlock = targetMsg.querySelector('.thinking-block');
      if (sourceThinkingDisplay && targetThinkingBlock) {
        targetThinkingBlock.className = sourceThinkingDisplay.className;
      }
    }
  }
}

/** If target (chat page) was near bottom before sync, scroll it to bottom. */
function syncScrollPosition(_sourceId: string, targetId: string): void {
  const target = document.getElementById(targetId);
  if (!target) return;
  const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 60;
  if (nearBottom) {
    target.scrollTop = target.scrollHeight;
  }
}

function copyButtonState(sourceId: string, targetId: string): void {
  const source = document.getElementById(sourceId) as HTMLButtonElement | null;
  const target = document.getElementById(targetId) as HTMLButtonElement | null;
  if (!source || !target) {
    return;
  }

  target.disabled = source.disabled;
}

function syncChatPageFromSidebar(): void {
  if (!chatPageContainer) {
    return;
  }

  copySelectState(sidebarSyncSource.sessionStatusFilter, chatPageIds.sessionStatusFilter);
  copySelectState(sidebarSyncSource.sessionSelect, chatPageIds.sessionSelect);
  copySelectState(sidebarSyncSource.modelSelector, chatPageIds.modelSelector);
  copyInputValue(sidebarSyncSource.input, chatPageIds.input);
  copyCheckboxState(sidebarSyncSource.cotToggle, chatPageIds.cotToggle);

  const chatMgr = getChatManager();
  if (chatMgr?.isStreaming) {
    // Incremental sync during streaming — avoids full innerHTML reflow
    incrementalMessageSync(sidebarSyncSource.messages, chatPageIds.messages);
    // Keep chat page scrolled to bottom when user was near bottom
    syncScrollPosition(sidebarSyncSource.messages, chatPageIds.messages);
  } else {
    copyElementVisibilityAndContent(sidebarSyncSource.messages, chatPageIds.messages);
    copyElementVisibilityAndContent(sidebarSyncSource.screenshotPreview, chatPageIds.screenshotPreview);
  }

  const sourceControlBar = document.getElementById(sidebarSyncSource.controlBar) as HTMLElement | null;
  const targetControlBar = document.getElementById(chatPageIds.controlBar) as HTMLElement | null;
  if (sourceControlBar && targetControlBar) {
    targetControlBar.style.display = sourceControlBar.style.display;
  }

  const sourceFeedback = document.getElementById(sidebarSyncSource.pausingFeedback) as HTMLElement | null;
  const targetFeedback = document.getElementById(chatPageIds.pausingFeedback) as HTMLElement | null;
  if (sourceFeedback && targetFeedback) {
    targetFeedback.className = sourceFeedback.className;
  }

  copyButtonState(sidebarSyncSource.interruptBtn, chatPageIds.interruptBtn);
  copyButtonState(sidebarSyncSource.pauseBtn, chatPageIds.pauseBtn);
  copyButtonState(sidebarSyncSource.resumeBtn, chatPageIds.resumeBtn);
  copyButtonState(sidebarSyncSource.cancelBtn, chatPageIds.cancelBtn);
}

function observeSidebarUpdates(): void {
  if (sidebarObserver) {
    sidebarObserver.disconnect();
  }

  const sidebarPanel = document.getElementById('sidebar-ai');
  if (!sidebarPanel) {
    return;
  }

  sidebarObserver = new MutationObserver(() => {
    const chatMgr = getChatManager();
    const now = Date.now();
    if (chatMgr?.isStreaming && (now - lastSyncTime) < SYNC_THROTTLE_MS) {
      return; // Throttle during streaming
    }
    lastSyncTime = now;
    syncChatPageFromSidebar();
  });

  sidebarObserver.observe(sidebarPanel, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function stopSidebarObserver(): void {
  if (sidebarObserver) {
    sidebarObserver.disconnect();
    sidebarObserver = null;
  }
}

function createChatPageHTML(): string {
  return `
    <div class="sidebar-panel active" id="${chatPageIds.root}" style="display: flex; flex-direction: column; height: 100%; width: 100%;">
      <div class="sidebar-content p-0 flex flex-col h-full" style="padding: 0; display: flex; flex-direction: column; height: 100%; overflow: hidden;">
        <div class="flex-between p-2 border-b bg-tertiary shrink-0">
          <div class="flex gap-2 flex-1 min-w-0 items-center">
            <select id="${chatPageIds.sessionStatusFilter}" class="text-12 w-20 bg-secondary border rounded px-1 py-1 shrink-0" title="按状态筛选">
              <option value="">全部</option>
              <option value="idle">⏸️空闲</option>
              <option value="running">▶️运行</option>
              <option value="paused">⏸️暂停</option>
              <option value="blocked">🚫阻塞</option>
              <option value="completed">✅完成</option>
            </select>
            <select id="${chatPageIds.sessionSelect}" class="text-12 flex-1 min-w-0 text-ellipsis bg-secondary border rounded px-2 py-1">
              <option value="">选择会话...</option>
            </select>
          </div>
          <div class="flex gap-1 ml-2 items-center">
            <label class="flex items-center gap-1 text-xs cursor-pointer select-none" title="显示思考过程">
              <input type="checkbox" id="${chatPageIds.cotToggle}" class="w-3 h-3">
              <span>CoT</span>
            </label>
            <div class="w-px h-4 bg-border mx-1"></div>
            <button id="${chatPageIds.createButton}" class="px-2 py-1 text-12" title="新建会话">➕</button>
            <button id="${chatPageIds.deleteButton}" class="px-2 py-1 text-12 text-error" title="删除会话">🗑️</button>
          </div>
        </div>

        <div class="flex gap-2 p-2 border-b bg-tertiary shrink-0" id="${chatPageIds.controlBar}" style="display: none;">
          <button id="${chatPageIds.interruptBtn}" type="button" class="flex-1 px-2 py-1 text-12 bg-error text-white rounded disabled:opacity-50" disabled>🔴 打断</button>
          <button id="${chatPageIds.pauseBtn}" type="button" class="flex-1 px-2 py-1 text-12 bg-warning text-white rounded disabled:opacity-50" disabled>⏸️ 暂停</button>
          <button id="${chatPageIds.resumeBtn}" type="button" class="flex-1 px-2 py-1 text-12 bg-success text-white rounded disabled:opacity-50" disabled>▶️ 继续</button>
          <button id="${chatPageIds.cancelBtn}" type="button" class="flex-1 px-2 py-1 text-12 bg-secondary text-error border border-error rounded disabled:opacity-50" disabled>❌ 取消</button>
        </div>

        <div id="${chatPageIds.pausingFeedback}" class="hidden px-3 py-2 bg-warning bg-opacity-20 text-warning text-xs text-center border-b">
          ⏳ 正在暂停...
        </div>

        <div id="${chatPageIds.panesContainer}" class="chat-panes-container">
          <div id="${chatPageIds.messages}" class="chat-messages p-3">
            <div class="empty-state text-center py-4">
              <div class="text-muted text-xs">选择或创建会话以开始</div>
            </div>
          </div>
        </div>

        <div class="p-3 border-t bg-tertiary shrink-0">
          <div class="flex gap-2 mb-2">
            <select id="${chatPageIds.modelSelector}" class="text-12 flex-1 bg-secondary border rounded px-2 py-1">
              <option value="decision">决策模型 (Decision)</option>
              <option value="vision">视觉模型 (Vision)</option>
            </select>
          </div>
          <div class="relative">
            <textarea id="${chatPageIds.input}" rows="3" class="w-full text-12 p-2 pr-8 resize-none bg-secondary border rounded focus:outline-none focus:border-accent" placeholder="输入消息... (Ctrl+Enter 发送)"></textarea>
            <div class="absolute bottom-2 right-2 flex gap-1">
              <button id="${chatPageIds.screenshotButton}" class="p-1 hover:bg-elevated rounded text-muted hover:text-primary" title="附加截图">📷</button>
              <button id="${chatPageIds.sendButton}" class="p-1 hover:bg-elevated rounded text-accent hover:text-accent-hover" title="发送">➤</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function syncChatPageInputToSidebar(): void {
  copyInputValue(chatPageIds.input, sidebarSyncSource.input);
  copySelectState(chatPageIds.modelSelector, sidebarSyncSource.modelSelector);
}

function wireEventHandlers(): void {
  const chatManager = getChatManager();
  if (!chatManager || !chatPageContainer) {
    return;
  }

  function addListener(element: HTMLElement | null, event: string, handler: (this: HTMLElement, ev: Event) => void) {
    if (!element) return;
    element.addEventListener(event, handler);
    eventCleanupCallbacks.push(() => element.removeEventListener(event, handler));
  }

  const sessionStatusFilter = document.getElementById(chatPageIds.sessionStatusFilter) as HTMLSelectElement | null;
  const sessionSelect = document.getElementById(chatPageIds.sessionSelect) as HTMLSelectElement | null;
  const cotToggle = document.getElementById(chatPageIds.cotToggle) as HTMLInputElement | null;
  const createButton = document.getElementById(chatPageIds.createButton) as HTMLButtonElement | null;
  const deleteButton = document.getElementById(chatPageIds.deleteButton) as HTMLButtonElement | null;
  const input = document.getElementById(chatPageIds.input) as HTMLTextAreaElement | null;
  const screenshotButton = document.getElementById(chatPageIds.screenshotButton) as HTMLButtonElement | null;
  const sendButton = document.getElementById(chatPageIds.sendButton) as HTMLButtonElement | null;
  const interruptButton = document.getElementById(chatPageIds.interruptBtn) as HTMLButtonElement | null;
  const pauseButton = document.getElementById(chatPageIds.pauseBtn) as HTMLButtonElement | null;
  const resumeButton = document.getElementById(chatPageIds.resumeBtn) as HTMLButtonElement | null;
  const cancelButton = document.getElementById(chatPageIds.cancelBtn) as HTMLButtonElement | null;

  if (sessionStatusFilter) {
    addListener(sessionStatusFilter, 'change', () => {
      chatManager.setStatusFilter(sessionStatusFilter.value);
      syncChatPageFromSidebar();
    });
  }

  if (sessionSelect) {
    addListener(sessionSelect, 'change', () => {
      void chatManager.switchSession(sessionSelect.value);
      syncChatPageFromSidebar();
    });
  }

  if (createButton) {
    addListener(createButton, 'click', () => {
      void chatManager.createSession();
      syncChatPageFromSidebar();
    });
  }

  if (deleteButton) {
    addListener(deleteButton, 'click', () => {
      void chatManager.deleteCurrentSession();
      syncChatPageFromSidebar();
    });
  }

  if (cotToggle) {
    addListener(cotToggle, 'change', () => {
      chatManager.toggleCoT(cotToggle.checked);
      syncChatPageFromSidebar();
    });
  }

  if (input) {
    addListener(input, 'keydown', (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === 'Enter' && keyboardEvent.ctrlKey) {
        syncChatPageInputToSidebar();
        chatManager.sendMessage();
        syncChatPageFromSidebar();
      }
    });
  }

  if (screenshotButton) {
    addListener(screenshotButton, 'click', () => {
      void chatManager.captureScreenshot();
      syncChatPageFromSidebar();
    });
  }

  if (sendButton) {
    addListener(sendButton, 'click', () => {
      syncChatPageInputToSidebar();
      chatManager.sendMessage();
      syncChatPageFromSidebar();
    });
  }

  if (interruptButton) {
    addListener(interruptButton, 'click', () => {
      invokeChatManagerMethod(chatManager, 'interruptSession');
      syncChatPageFromSidebar();
    });
  }

  if (pauseButton) {
    addListener(pauseButton, 'click', () => {
      invokeChatManagerMethod(chatManager, 'pauseSession');
      syncChatPageFromSidebar();
    });
  }

  if (resumeButton) {
    addListener(resumeButton, 'click', () => {
      invokeChatManagerMethod(chatManager, 'resumeSession');
      syncChatPageFromSidebar();
    });
  }

  if (cancelButton) {
    addListener(cancelButton, 'click', () => {
      invokeChatManagerMethod(chatManager, 'cancelSession');
      syncChatPageFromSidebar();
    });
  }
}

function show(): void {
  hideMainLayout();

  if (!chatPageContainer) {
    chatPageContainer = document.createElement('div');
    chatPageContainer.id = CHAT_PAGE_CONTAINER_ID;
    chatPageContainer.className = 'main-content-page active';
    chatPageContainer.style.position = 'fixed';
    chatPageContainer.style.inset = '0';
    chatPageContainer.style.zIndex = '2000';
    chatPageContainer.style.display = 'flex';
    chatPageContainer.style.flexDirection = 'column';
    chatPageContainer.style.background = 'var(--bg-primary)';
    chatPageContainer.style.overflow = 'hidden';
    chatPageContainer.innerHTML = createChatPageHTML();
    document.body.appendChild(chatPageContainer);
    wireEventHandlers();
  } else {
    chatPageContainer.style.display = 'flex';
  }

  syncChatPageFromSidebar();
  observeSidebarUpdates();
}

function hide(): void {
  showMainLayout();
  stopSidebarObserver();

  // Clean up all event listeners
  eventCleanupCallbacks.forEach(cleanup => {
    cleanup();
  });
  eventCleanupCallbacks = [];

  if (chatPageContainer) {
    chatPageContainer.remove();
    chatPageContainer = null;
  }
}

window.chatComponent = { show, hide, syncChatPageFromSidebar };

export { show, hide, createChatPageHTML, wireEventHandlers, syncChatPageFromSidebar };
