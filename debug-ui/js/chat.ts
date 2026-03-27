import { showSuccess, showError } from './ui.js';

// 类型定义
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  screenshot?: string;
  thinking?: string;
  timestamp?: number;
  created_at?: number | string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt?: number;
  created_at?: number;
  status?: 'idle' | 'running' | 'paused' | 'blocked' | 'completed';
}

interface SessionsResponse {
  success: boolean;
  sessions: ChatSession[];
}

interface SessionResponse {
  success: boolean;
  messages?: ChatMessage[];
}

interface ScreenshotResponse {
  success: boolean;
  screenshot?: string;
}

interface WebSocketData {
  type: string;
  seq?: number;
  sessionId?: string;
  messageId?: string;
  role?: 'user' | 'assistant';
  text?: string;
  content?: string;
  toolCall?: {
    function?: {
      name: string;
    };
  };
  error?: string;
  messages?: Array<{
    id: string;
    role: string;
    content: string;
    created_at: string;
  }>;
  state?: 'idle' | 'running' | 'paused' | 'interrupted' | 'cancelled' | 'blocked' | 'completed';
  agentState?: any;
}

declare global {
  interface Window {
    chatManager?: ChatManager;
    ws?: WebSocket;
  }
}

class ChatManager {
  currentSessionId: string | null;
  sessions: ChatSession[];
  messageContainer: HTMLElement | null;
  leftPaneContainer: HTMLElement | null;
  sessionSelect: HTMLSelectElement | null;
  private currentSessionTitleEl: HTMLElement | null = null;
  input: HTMLInputElement | null;
  currentScreenshot: string | null;
  showThinking: boolean;
  private sessionStatus: 'idle' | 'running' | 'paused' | 'interrupted' | 'cancelled' | 'blocked' | 'completed' = 'idle';
  private isConnectivityOk: boolean = true;
  private buttonStates: Record<string, Record<string, boolean>> = {
    idle: { interrupt: false, pause: false, resume: false, cancel: false },
    running: { interrupt: true, pause: true, resume: false, cancel: true },
    paused: { interrupt: false, pause: false, resume: true, cancel: true },
    blocked: { interrupt: false, pause: false, resume: true, cancel: true },
    completed: { interrupt: false, pause: false, resume: false, cancel: false },
    interrupted: { interrupt: false, pause: false, resume: false, cancel: false },
    cancelled: { interrupt: false, pause: false, resume: false, cancel: false },
  };

  private sessionState: Map<string, {
    messages: ChatMessage[];
    isRunning: boolean;
    lastEventId: string;
    highestEventSeq: number;
    hydrated: boolean;
  }> = new Map();
  private sessionSwitchEpoch = 0;

  // Lazy loading properties
  private isLoadingMessages: boolean = false;
  private hasMoreMessages: boolean = true;
  private messageOffset: number = 0;
  private readonly LOAD_MORE_LIMIT: number = 50;

  private ensureSessionState(sessionId: string): {
    messages: ChatMessage[];
    isRunning: boolean;
    lastEventId: string;
    highestEventSeq: number;
    hydrated: boolean;
  } {
    const existing = this.sessionState.get(sessionId);
    if (existing) {
      return existing;
    }
    const persistedLastEventId = localStorage.getItem(`sse_lastEventId_${sessionId}`) || '';
    const parsedSeq = Number.parseInt(persistedLastEventId, 10);
    const initialState = {
      messages: [],
      isRunning: false,
      lastEventId: persistedLastEventId,
      highestEventSeq: Number.isFinite(parsedSeq) ? parsedSeq : -1,
      hydrated: false,
    };
    this.sessionState.set(sessionId, initialState);
    return initialState;
  }

  private parseMessageTime(value: number | string | undefined): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const asNumber = Number.parseInt(value, 10);
      if (Number.isFinite(asNumber)) {
        return asNumber;
      }
      const asDate = Date.parse(value);
      if (Number.isFinite(asDate)) {
        return asDate;
      }
    }
    return Date.now();
  }

  private normalizeMessage(message: ChatMessage): ChatMessage {
    const createdAt = this.parseMessageTime(message.created_at ?? message.timestamp);
    return {
      id: message.id,
      role: message.role,
      content: message.content || '',
      screenshot: message.screenshot,
      thinking: message.thinking,
      created_at: createdAt,
      timestamp: createdAt,
    };
  }

  private sortMessages(messages: ChatMessage[]): ChatMessage[] {
    return [...messages].sort((a, b) => {
      const timeA = this.parseMessageTime(a.created_at ?? a.timestamp);
      const timeB = this.parseMessageTime(b.created_at ?? b.timestamp);
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      return a.id.localeCompare(b.id);
    });
  }

  private mergeMessage(existing: ChatMessage, incoming: ChatMessage): ChatMessage {
    const existingTime = this.parseMessageTime(existing.created_at ?? existing.timestamp);
    const incomingTime = this.parseMessageTime(incoming.created_at ?? incoming.timestamp);
    const mergedTime = Math.min(existingTime, incomingTime);
    return {
      id: incoming.id,
      role: incoming.role || existing.role,
      content: incoming.content.length >= existing.content.length ? incoming.content : existing.content,
      screenshot: incoming.screenshot || existing.screenshot,
      thinking: (incoming.thinking || '').length >= (existing.thinking || '').length ? incoming.thinking : existing.thinking,
      created_at: mergedTime,
      timestamp: mergedTime,
    };
  }

  private mergeSessionMessages(sessionId: string, incomingMessages: ChatMessage[], markHydrated: boolean): void {
    const state = this.ensureSessionState(sessionId);
    const messageMap = new Map<string, ChatMessage>(state.messages.map((msg) => [msg.id, msg]));
    incomingMessages.forEach((rawMessage) => {
      if (!rawMessage.id || !rawMessage.role) {
        return;
      }
      const message = this.normalizeMessage(rawMessage);
      if (message.role === 'user' && !message.id.startsWith('temp-')) {
        const optimistic = Array.from(messageMap.values()).find(
          (msg) => msg.id.startsWith('temp-') && msg.role === 'user' && msg.content === message.content
        );
        if (optimistic) {
          messageMap.delete(optimistic.id);
        }
      }
      const existing = messageMap.get(message.id);
      messageMap.set(message.id, existing ? this.mergeMessage(existing, message) : message);
    });
    state.messages = this.sortMessages(Array.from(messageMap.values()));
    if (markHydrated) {
      state.hydrated = true;
    }
  }

  private renderCurrentSessionMessages(sessionId: string): void {
    if (sessionId !== this.currentSessionId) {
      return;
    }
    const state = this.ensureSessionState(sessionId);
    this.renderMessages(state.messages);
  }

  constructor() {
    this.currentSessionId = null;
    this.sessions = [];
    this.messageContainer = document.getElementById('chat-messages');
    this.leftPaneContainer = document.getElementById('chat-left-pane');
    this.sessionSelect = document.getElementById('session-select') as HTMLSelectElement | null;
    this.input = document.getElementById('chat-input') as HTMLInputElement | null;
    this.currentScreenshot = null;
    this.showThinking = localStorage.getItem('showThinking') === 'true';

    // Bind methods
    this.handleStream = this.handleStream.bind(this);

    this.init();
  }

  async init(): Promise<void> {
    await this.loadSessions();

    // Restore CoT toggle state
    const cotToggle = document.getElementById('cot-toggle') as HTMLInputElement | null;
    if (cotToggle) {
      cotToggle.checked = this.showThinking;
    }

    // Event listeners
    if (this.input) {
      this.input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && e.ctrlKey) {
          this.sendMessage();
        }
      });
    }

    if (this.sessionSelect) {
      this.sessionSelect.addEventListener('change', (e: Event) => {
        const target = e.target as HTMLSelectElement;
        if (target.value) {
          this.switchSession(target.value);
        }
      });
    }

    // Initialize control buttons
    this.initControlButtons();

    // Initialize scroll listener for lazy loading
    this.initScrollListener();

    // Initialize input state
    this.updateInputState();
  }

  private initControlButtons(): void {
    const interruptBtn = document.getElementById('interrupt-btn') as HTMLButtonElement | null;
    const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement | null;
    const resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement | null;
    const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement | null;

    if (interruptBtn) {
      interruptBtn.addEventListener('click', () => this.interruptSession());
    }
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => this.pauseSession());
    }
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => this.resumeSession());
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.cancelSession());
    }

    // Update button states based on current status
    this.updateButtonStates();
  }

  private updateButtonStates(): void {
    const interruptBtn = document.getElementById('interrupt-btn') as HTMLButtonElement | null;
    const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement | null;
    const resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement | null;
    const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement | null;
    const controlBar = document.getElementById('chat-control-bar');

    if (!interruptBtn || !pauseBtn || !resumeBtn || !cancelBtn) return;

    const states = this.buttonStates[this.sessionStatus] || this.buttonStates.idle;

    interruptBtn.disabled = !states.interrupt;
    pauseBtn.disabled = !states.pause;
    resumeBtn.disabled = !states.resume;
    cancelBtn.disabled = !states.cancel;

    // Show/hide control bar based on session status
    if (controlBar) {
      controlBar.style.display = this.sessionStatus === 'idle' ? 'none' : 'flex';
    }
  }

  private setSessionStatus(status: 'idle' | 'running' | 'paused' | 'interrupted' | 'cancelled' | 'blocked' | 'completed'): void {
    this.sessionStatus = status;
    this.updateButtonStates();
  }

  private async interruptSession(): Promise<void> {
    if (!this.currentSessionId) return;

    try {
      const response = await fetch(`/api/chat/sessions/${this.currentSessionId}/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        this.setSessionStatus('interrupted');
        showSuccess('会话已打断');
      } else {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        showError(`打断失败：${error.error}`);
      }
    } catch (error) {
      console.error('Failed to interrupt session:', error);
      showError(`打断失败：${(error as Error).message}`);
    }
  }

  private async pauseSession(): Promise<void> {
    if (!this.currentSessionId) return;

    // Show immediate feedback
    const pausingFeedback = document.getElementById('pausing-feedback');
    if (pausingFeedback) {
      pausingFeedback.classList.remove('hidden');
    }

    try {
      const response = await fetch(`/api/chat/sessions/${this.currentSessionId}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        this.setSessionStatus('paused');
        showSuccess('会话已暂停');
      } else {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        showError(`暂停失败：${error.error}`);
      }
    } catch (error) {
      console.error('Failed to pause session:', error);
      showError(`暂停失败：${(error as Error).message}`);
    } finally {
      // Hide feedback after a short delay
      setTimeout(() => {
        const pausingFeedback = document.getElementById('pausing-feedback');
        if (pausingFeedback) {
          pausingFeedback.classList.add('hidden');
        }
      }, 1000);
    }
  }

  private async resumeSession(): Promise<void> {
    if (!this.currentSessionId) return;

    try {
      const response = await fetch(`/api/chat/sessions/${this.currentSessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        this.setSessionStatus('running');
        showSuccess('会话已继续');
      } else {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        showError(`继续失败：${error.error}`);
      }
    } catch (error) {
      console.error('Failed to resume session:', error);
      showError(`继续失败：${(error as Error).message}`);
    }
  }

  private async cancelSession(): Promise<void> {
    if (!this.currentSessionId) return;

    if (!confirm('确定要取消此会话吗？')) return;

    try {
      const response = await fetch(`/api/chat/sessions/${this.currentSessionId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        this.setSessionStatus('cancelled');
        showSuccess('会话已取消');
      } else {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        showError(`取消失败：${error.error}`);
      }
    } catch (error) {
      console.error('Failed to cancel session:', error);
      showError(`取消失败：${(error as Error).message}`);
    }
  }

  public getSessionStatus(): string {
    return this.sessionStatus;
  }

  public setConnectivityState(isOk: boolean): void {
    this.isConnectivityOk = isOk;
    this.updateInputState();
  }

  private updateInputState(): void {
    if (!this.input) return;
    const sendBtn = this.input.parentElement?.querySelector('button[title="发送"]') as HTMLButtonElement | null;
    
    if (!this.isConnectivityOk) {
      this.input.disabled = true;
      this.input.placeholder = '连通性测试失败，请在配置面板重新测试';
      if (sendBtn) sendBtn.disabled = true;
    } else {
      this.input.disabled = false;
      this.input.placeholder = '输入消息... (Ctrl+Enter 发送)';
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  private statusFilter: string = '';

  async loadSessions(): Promise<void> {
    try {
      const res = await fetch('/api/chat/sessions');
      if (!res.ok) throw new Error('Failed to fetch sessions');
      const data = await res.json();
      // Backend now returns an array directly instead of {success: true, sessions: []}
      if (Array.isArray(data)) {
        this.sessions = data;
        this.renderSessionList();
      }
    } catch (e) {
      console.error('Failed to load sessions', e);
      showError('Failed to load sessions');
    }
  }

  private getStatusIcon(status?: string): string {
    switch (status) {
      case 'running':
        return '<span class="status-icon status-running" title="运行中">▶️</span>';
      case 'paused':
        return '<span class="status-icon status-paused" title="已暂停">⏸️</span>';
      case 'blocked':
        return '<span class="status-icon status-blocked" title="已阻塞">🚫</span>';
      case 'completed':
        return '<span class="status-icon status-completed" title="已完成">✅</span>';
      case 'idle':
      default:
        return '<span class="status-icon status-idle" title="空闲">⏸️</span>';
    }
  }

  renderSessionList(): void {
    if (!this.sessionSelect) return;

    const currentVal = this.sessionSelect.value;
    this.sessionSelect.innerHTML = '<option value="">选择会话...</option>';

    const filteredSessions = this.statusFilter
      ? this.sessions.filter((s: ChatSession) => s.status === this.statusFilter)
      : this.sessions;

    filteredSessions.forEach((session: ChatSession): void => {
      const option = document.createElement('option');
      option.value = session.id;
      const time = new Date(session.createdAt || session.created_at || 0).toLocaleTimeString();
      const icon = this.getStatusIcon(session.status);
      option.innerHTML = `${icon} ${session.title || '无标题会话'} (${time})`;
      this.sessionSelect!.appendChild(option);
    });

    if (this.currentSessionId) {
      this.sessionSelect.value = this.currentSessionId;
    } else if (currentVal && this.sessions.find((s: ChatSession) => s.id === currentVal)) {
      this.sessionSelect.value = currentVal;
      this.currentSessionId = currentVal;
    } else if (filteredSessions.length > 0) {
      // 自动选择第一个会话
      const firstSessionId = filteredSessions[0].id;
      this.sessionSelect.value = firstSessionId;
      this.currentSessionId = firstSessionId;
    }
  }

  public setStatusFilter(filter: string): void {
    this.statusFilter = filter;
    this.renderSessionList();
  }

  async createSession(): Promise<void> {
    if (!this.isConnectivityOk) {
      showError('连通性测试失败，请在配置面板重新测试');
      return;
    }

    // 移除了会导致测试死锁的 prompt
    const title = `新会话 ${new Date().toLocaleTimeString()}`;

    try {
      // 从配置 API 获取默认的 provider 和 model
      let provider = 'glm';
      let model = 'glm-4.6v-flash';
      try {
        const configRes = await fetch('/api/config');
        if (configRes.ok) {
          const configData = (await configRes.json()) as any;
          if (configData.decision?.provider) {
            provider = configData.decision.provider;
          }
          if (configData.decision?.model) {
            model = configData.decision.model;
          }
        }
      } catch (e) {
        console.warn('Failed to fetch config, using defaults', e);
      }

      const res = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || '新会话',
          provider: provider,
          model: model,
        }),
      });
      if (res.ok) {
        const sessionResult = await res.json();
        const sessionId = sessionResult.id || sessionResult.session?.id;
        if (sessionId) {
          await this.loadSessions();
          this.switchSession(sessionId);
          showSuccess('会话已创建');
        }
      }
    } catch (e) {
      console.error('Failed to create session', e);
      showError('Failed to create session');
    }
  }

  async deleteCurrentSession(): Promise<void> {
    if (!this.currentSessionId) return;
    if (!confirm('确定删除此会话吗？')) return;

    const deletedId = this.currentSessionId;

    // Close SSE connection before deleting session
    this.closeSSE();

    try {
      await fetch(`/api/chat/sessions/${deletedId}`, {
        method: 'DELETE',
      });

      showSuccess('会话已删除');
      this.currentSessionId = null;
      if (this.sessionSelect) {
        this.sessionSelect.value = '';
      }
      await this.loadSessions();

      // 自动选择下一个会话
      const filteredSessions = this.statusFilter
        ? this.sessions.filter((s: ChatSession) => s.status === this.statusFilter)
        : this.sessions;
      if (filteredSessions.length > 0) {
        const nextSession = filteredSessions[0];
        this.switchSession(nextSession.id);
      } else {
        this.renderMessages([]);
      }
    } catch (e) {
      console.error('Failed to delete session', e);
      showError('Failed to delete session');
    }
  }

  async switchSession(sessionId: string): Promise<void> {
    this.closeSSE();
    const switchEpoch = ++this.sessionSwitchEpoch;

    if (!sessionId) {
      this.currentSessionId = null;
      this.renderMessages([]);
      this.setSessionStatus('idle');
      return;
    }

    this.currentSessionId = sessionId;
    if (this.sessionSelect) {
      this.sessionSelect.value = sessionId;
    }

    this.isLoadingMessages = false;
    this.hasMoreMessages = false;
    this.messageOffset = 0;

    this.ensureSessionState(sessionId);
    this.renderCurrentSessionMessages(sessionId);
    this.initSSE(sessionId, false);

    try {
      const sessionRes = await fetch(`/api/chat/sessions/${sessionId}`);
      if (switchEpoch !== this.sessionSwitchEpoch || sessionId !== this.currentSessionId) {
        return;
      }
      if (sessionRes.ok) {
        const sessionData = await sessionRes.json();
        this.setSessionStatus(sessionData.status || 'idle');
        if (sessionData.status === 'blocked' && sessionData.agentState) {
          this.renderBlockedState(sessionData.agentState);
        } else {
          this.clearBlockedState();
        }
      } else {
        console.warn('Failed to fetch session status');
        this.setSessionStatus('idle'); // Fallback to avoid carrying over 'paused' UI
      }
    } catch (err) {
      console.warn('Failed to load session details for status check', err);
    }
  }

  /**
   * Load messages with pagination
   * @param sessionId - Session ID to load messages for
   * @param offset - Number of messages to skip
   * @param limit - Number of messages to load
   */
  async loadMessages(sessionId: string, offset: number, limit: number): Promise<void> {
    if (this.isLoadingMessages || !this.hasMoreMessages) return;

    this.isLoadingMessages = true;

    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}/messages?limit=${limit}&offset=${offset}`);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const data = await res.json() as ChatMessage[];
      this.mergeSessionMessages(sessionId, data || [], true);
      this.renderCurrentSessionMessages(sessionId);

      this.hasMoreMessages = data.length === limit;
      this.messageOffset = offset + (data?.length || 0);
    } catch (e) {
      console.error('Failed to load messages', e);
      showError('Failed to load messages');
    } finally {
      this.isLoadingMessages = false;
    }
  }

  /**
   * Load more messages when scrolling to top
   */
  async loadMoreMessages(): Promise<void> {
    if (!this.currentSessionId || this.isLoadingMessages || !this.hasMoreMessages) return;

    // Show loading indicator
    this.showLoadingIndicator();

    await this.loadMessages(this.currentSessionId, this.messageOffset, this.LOAD_MORE_LIMIT);

    // Hide loading indicator
    this.hideLoadingIndicator();
  }

  renderMessages(messages: ChatMessage[]): void {
    if (!this.messageContainer) return;

    this.messageContainer.innerHTML = '';
    if (this.leftPaneContainer) {
      this.leftPaneContainer.innerHTML = `
        <div class="pane-header-sticky">执行日志 & 思考过程</div>
      `;
    }

    if (!messages || messages.length === 0) {
      this.messageContainer.innerHTML = `
                <div class="empty-state text-center py-4">
                    <div class="text-muted text-xs">暂无消息</div>
                </div>`;
      return;
    }

    messages.forEach((msg: ChatMessage) => {
      this.appendMessage(msg);
    });
    this.scrollToBottom();
  }

  appendMessage(msg: ChatMessage): HTMLElement | null {
    if (!this.messageContainer) return null;

    // Remove empty state if exists
    const emptyState = this.messageContainer.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const div = document.createElement('div');
    div.className = `chat-message ${msg.role}`;
    div.dataset.id = msg.id;

    let contentHtml = '';

    if (msg.screenshot) {
      contentHtml += `<div class="mb-2"><img src="data:image/png;base64,${msg.screenshot}" class="max-w-full rounded border border-border"></div>`;
    }

    if (msg.thinking) {
      contentHtml += `
          <div class="thinking-block expanded" data-id="${msg.id}">
              <div class="thinking-header" onclick="this.parentElement.classList.toggle('expanded')">
                  <span>💭 思考过程</span>
              </div>
              <div class="thinking-content">${this.formatContent(msg.thinking)}</div>
          </div>
      `;
    }

    contentHtml += this.formatContent(msg.content);

    const avatar = msg.role === 'user' ? '👤' : '🤖';
    const timestamp = msg.timestamp || msg.created_at || Date.now();
    div.innerHTML = `
            <div class="chat-avatar">${avatar}</div>
            <div class="chat-bubble-container">
                <div class="chat-meta">${new Date(timestamp).toLocaleTimeString()}</div>
                <div class="msg-content">${contentHtml}</div>
            </div>
        `;

    this.messageContainer.appendChild(div);
    this.scrollToBottom();
    return div;
  }

  formatContent(content: string): string {
    if (!content) return '';
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  /**
   * Prepend messages to the top of the chat container
   * @param messages - Messages to prepend
   */
  prependMessages(messages: ChatMessage[]): void {
    if (!this.messageContainer) return;

    if (!messages || messages.length === 0) return;

    // Create document fragment for better performance
    const tempContainer = document.createElement('div');
    const tempLeftContainer = document.createElement('div');

    messages.forEach((msg: ChatMessage) => {
      const div = document.createElement('div');
      div.className = `chat-message ${msg.role}`;
      div.dataset.id = msg.id;

      let contentHtml = '';

      if (msg.screenshot) {
        contentHtml += `<div class="mb-2"><img src="data:image/png;base64,${msg.screenshot}" class="max-w-full rounded border border-border"></div>`;
      }

      if (msg.thinking && this.leftPaneContainer) {
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'thinking-block expanded';
        thinkingDiv.dataset.id = msg.id;
        thinkingDiv.innerHTML = `
            <div class="thinking-header" onclick="this.parentElement.classList.toggle('expanded')">
                <span>💭 思考过程</span>
            </div>
            <div class="thinking-content">${this.formatContent(msg.thinking)}</div>
        `;
        tempLeftContainer.appendChild(thinkingDiv);
      }

      contentHtml += this.formatContent(msg.content);

      const avatar = msg.role === 'user' ? '👤' : '🤖';
      const timestamp = msg.timestamp || msg.created_at || Date.now();
      div.innerHTML = `
            <div class="chat-avatar">${avatar}</div>
            <div class="chat-bubble-container">
                <div class="chat-meta">${new Date(timestamp).toLocaleTimeString()}</div>
                <div class="msg-content">${contentHtml}</div>
            </div>
        `;

      tempContainer.appendChild(div);
    });

    // Prepend to the beginning of the message container
    while (tempContainer.firstChild) {
      this.messageContainer.insertBefore(tempContainer.firstChild, this.messageContainer.firstChild);
    }
  }

  /**
   * Show loading indicator at the top of the chat
   */
  showLoadingIndicator(): void {
    if (!this.messageContainer) return;

    const existingIndicator = this.messageContainer.querySelector('.loading-indicator');
    if (existingIndicator) return;

    const indicator = document.createElement('div');
    indicator.className = 'loading-indicator';
    indicator.innerHTML = `
            <div class="typing-indicator">
                <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
            </div>
            <div class="loading-text">加载中...</div>
        `;

    this.messageContainer.insertBefore(indicator, this.messageContainer.firstChild);
  }

  /**
   * Hide loading indicator
   */
  hideLoadingIndicator(): void {
    if (!this.messageContainer) return;

    const indicator = this.messageContainer.querySelector('.loading-indicator');
    if (indicator) indicator.remove();
  }

  /**
   * Initialize scroll listener for lazy loading
   */
  initScrollListener(): void {
    if (!this.messageContainer) return;

    this.messageContainer.addEventListener('scroll', () => {
      // Load more when scrolled to top (within 100px)
      if (this.messageContainer && this.messageContainer.scrollTop < 100 && this.hasMoreMessages && !this.isLoadingMessages) {
        this.loadMoreMessages();
      }
    });
  }

  toggleCoT(enabled: boolean): void {
    this.showThinking = enabled;
    localStorage.setItem('showThinking', enabled.toString());
  }

  async captureScreenshot(): Promise<void> {
    try {
      const res = await fetch('/debug/api/playwright/screenshot');
      const data = (await res.json()) as ScreenshotResponse;
      if (data.success && data.screenshot) {
        this.currentScreenshot = data.screenshot;
        this.renderScreenshotPreview();
        showSuccess('截图已添加');
      } else {
        showError('Failed to capture screenshot');
      }
    } catch (e) {
      const error = e as Error;
      console.error('Screenshot error:', e);
      showError('Screenshot error: ' + error.message);
    }
  }

  clearScreenshot(): void {
    this.currentScreenshot = null;
    this.renderScreenshotPreview();
  }

  renderScreenshotPreview(): void {
    const container = document.getElementById('screenshot-preview') as HTMLElement | null;
    if (!container) return;

    if (this.currentScreenshot) {
      container.classList.remove('hidden');
      const img = container.querySelector('img') as HTMLImageElement | null;
      if (img) img.src = `data:image/png;base64,${this.currentScreenshot}`;
    } else {
      container.classList.add('hidden');
    }
  }

  // SSE EventSource instance for streaming responses
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private maxReconnectDelay = 30000; // 30 seconds
  private streamApiBase = '/api/chat';
  private currentSessionIdForSSE: string | null = null;

  sendMessage(): void {
    if (!this.input) return;
    if (!this.isConnectivityOk) {
      showError('连通性测试失败，请在配置面板重新测试');
      return;
    }

    const content = this.input.value.trim();
    if (!content && !this.currentScreenshot) return;

    if (!this.currentSessionId) {
      alert('请先选择或创建会话。');
      return;
    }

    const msg: ChatMessage = {
      role: 'user',
      content: content,
      timestamp: Date.now(),
      id: 'temp-' + Date.now(),
    };

    if (this.currentScreenshot) {
      msg.screenshot = this.currentScreenshot;
    }

    this.mergeSessionMessages(this.currentSessionId, [msg], false);
    this.renderCurrentSessionMessages(this.currentSessionId);

    this.input.value = '';
    const screenshotToSend = this.currentScreenshot;
    this.clearScreenshot();

    this.sendChatMessageHTTP(this.currentSessionId, content, screenshotToSend);
  }

  private async sendChatMessageHTTP(
    sessionId: string,
    message: string,
    screenshot?: string | null
  ): Promise<void> {
    try {
      const response = await fetch(`${this.streamApiBase}/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: message,
          screenshot,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to trigger message task');
      }
      // Status and message streaming are purely handled via the already active SSE loop
    } catch (error) {
      console.error('Failed to send chat message:', error);
      showError(`发送失败：${(error as Error).message}`);
    }
  }

  private initSSE(sessionId: string, allowResume: boolean): void {
    this.closeSSE();

    this.currentSessionIdForSSE = sessionId;
    this.reconnectAttempts = 0;

    const url = new URL(`${this.streamApiBase}/sessions/${sessionId}/stream`, window.location.origin);
    const state = this.ensureSessionState(sessionId);
    const lastEventId = allowResume ? state.lastEventId || localStorage.getItem(`sse_lastEventId_${sessionId}`) || '' : '';
    if (!allowResume) {
      state.lastEventId = '';
      state.highestEventSeq = -1;
      localStorage.removeItem(`sse_lastEventId_${sessionId}`);
    }
    if (lastEventId) {
      url.searchParams.set('lastEventId', lastEventId);
    }

    try {
      this.eventSource = new EventSource(url.toString());

      this.eventSource.onopen = () => {
        console.log('SSE connection established');
        this.reconnectAttempts = 0;
      };

      const handleEvent = (event: MessageEvent<string>) => {
        if (event.lastEventId) {
          state.lastEventId = event.lastEventId;
          localStorage.setItem(`sse_lastEventId_${sessionId}`, event.lastEventId);
        }
        this.handleSSEMessage(event);
      };

      this.eventSource.onmessage = handleEvent;

      const sseEvents = [
        'session.snapshot',
        'message.created',
        'assistant.started',
        'assistant.delta',
        'assistant.completed',
        'assistant.thinking',
        'assistant.tool_call',
        'assistant.tool_result',
        'run.error'
      ];

      sseEvents.forEach(eventType => {
        this.eventSource?.addEventListener(eventType, handleEvent as EventListener);
      });

      this.eventSource.onerror = () => {
        console.error('SSE connection error');
        this.reconnect();
      };
    } catch (error) {
      console.error('Failed to initialize SSE:', error);
      showError('SSE 连接初始化失败');
    }
  }

  private handleSSEMessage(event: MessageEvent<string>): void {
    try {
      const data = JSON.parse(event.data) as WebSocketData;
      if (data.sessionId) {
        const state = this.ensureSessionState(data.sessionId);
        const eventSeq = Number.parseInt(event.lastEventId || '', 10);
        if (Number.isFinite(eventSeq)) {
          if (eventSeq <= state.highestEventSeq) {
            return;
          }
          state.highestEventSeq = eventSeq;
        }
      }
      this.handleStream(data);
    } catch (error) {
      console.error('Failed to parse SSE message:', error);
    }
  }

  private reconnect(): void {
    if (!this.currentSessionIdForSSE) {
      console.log('No session ID for SSE reconnection');
      return;
    }

    this.closeSSE();

    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.min(
        1000 * Math.pow(2, this.reconnectAttempts),
        this.maxReconnectDelay
      );
      this.reconnectAttempts++;
      console.log(`SSE reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

      setTimeout(() => {
        if (this.currentSessionIdForSSE) {
          this.initSSE(this.currentSessionIdForSSE, true);
        }
      }, delay);
    } else {
      showError('SSE 连接断开，无法重连');
      this.setSessionStatus('idle');
    }
  }

  private closeSSE(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.currentSessionIdForSSE = null;
    }
  }

  handleStream(data: WebSocketData): void {
    if (!data.sessionId || data.sessionId !== this.currentSessionId) return;
    if (!this.messageContainer) return;
    const sessionId = data.sessionId;
    const state = this.ensureSessionState(sessionId);

    let eventType = data.type;

    if (eventType === 'session.snapshot') {
      const isRunning = data.state === 'running';
      state.isRunning = isRunning;
      const snapshotMessages = ((data.messages as unknown as ChatMessage[]) || []).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content || '',
        created_at: message.created_at,
      }));
      this.mergeSessionMessages(sessionId, snapshotMessages, true);
      this.renderCurrentSessionMessages(sessionId);
      if (data.state) {
        this.setSessionStatus(data.state as any);
        if (data.state === 'blocked' && data.agentState) {
          this.renderBlockedState(data.agentState);
        } else {
          this.clearBlockedState();
        }
      }
      return;
    }

    if (eventType === 'message.created') {
      if (data.messageId) {
        this.mergeSessionMessages(
          sessionId,
          [{
            id: data.messageId,
            role: data.role || 'user',
            content: data.content || '',
            created_at: Date.now(),
          }],
          true
        );
        this.renderCurrentSessionMessages(sessionId);
      }
      return;
    }
    if (eventType === 'assistant.started') {
      eventType = 'chat_stream_start';
    } else if (eventType === 'assistant.delta') {
      eventType = 'chat_stream_token';
    } else if (eventType === 'assistant.completed') {
      eventType = 'chat_stream_end';
    } else if (eventType === 'assistant.thinking') {
      eventType = 'chat_stream_thinking';
    } else if (eventType === 'assistant.tool_call') {
      eventType = 'chat_stream_tool_call';
    } else if (eventType === 'run.error') {
      eventType = 'chat_stream_error';
    }

    if (eventType === 'chat_stream_start') {
      this.setSessionStatus('running');
    } else if (eventType === 'chat_stream_end' || eventType === 'chat_stream_error') {
      setTimeout(() => {
        if (this.sessionStatus === 'running') {
          this.setSessionStatus('idle');
        }
      }, 500);
    }

    if (eventType === 'chat_stream_start' && data.messageId) {
      this.mergeSessionMessages(
        sessionId,
        [{
          id: data.messageId,
          role: 'assistant',
          content: '',
          created_at: Date.now(),
        }],
        true
      );
      this.renderCurrentSessionMessages(sessionId);
    }

    let msgDiv = this.messageContainer.querySelector(
      `[data-id="${data.messageId}"]`
    ) as HTMLElement | null;

    if (!msgDiv && data.messageId && (eventType === 'chat_stream_token' || eventType === 'chat_stream_thinking' || eventType === 'chat_stream_tool_call' || eventType === 'chat_stream_end' || eventType === 'chat_stream_error')) {
      this.mergeSessionMessages(
        sessionId,
        [{
          id: data.messageId,
          role: 'assistant',
          content: '',
          created_at: Date.now(),
        }],
        true
      );
      this.renderCurrentSessionMessages(sessionId);
      msgDiv = this.messageContainer.querySelector(`[data-id="${data.messageId}"]`) as HTMLElement | null;
    }

    if (eventType === 'chat_stream_token') {
      if (msgDiv) {
        const contentDiv = msgDiv.querySelector('.msg-content') as HTMLElement | null;
        const indicator = msgDiv.querySelector('.typing-indicator') as HTMLElement | null;
        if (indicator) indicator.style.display = 'none';

        if (contentDiv && data.text) {
          const msg = state.messages.find((message) => message.id === data.messageId);
          if (msg) {
            msg.content = (msg.content || '') + data.text;
            contentDiv.innerHTML = this.formatContent(msg.content);
          }
        }
        this.scrollToBottom();
      }
    }

    if (eventType === 'chat_stream_thinking') {
      if (msgDiv) {
        let thinkingBlock = msgDiv.querySelector(`.thinking-block[data-id="${data.messageId}"]`) as HTMLElement | null;
        if (!thinkingBlock) {
          thinkingBlock = document.createElement('div');
          thinkingBlock.className = 'thinking-block expanded';
          thinkingBlock.dataset.id = data.messageId || '';
          thinkingBlock.innerHTML = `
              <div class="thinking-header" onclick="this.parentElement.classList.toggle('expanded')">
                  <span>💭 思考过程</span>
              </div>
              <div class="thinking-content"></div>
          `;

          const contentDiv = msgDiv.querySelector('.msg-content');
          if (contentDiv && contentDiv.parentElement) {
             contentDiv.parentElement.insertBefore(thinkingBlock, contentDiv);
          }
        }

        if (thinkingBlock) {
          const content = thinkingBlock.querySelector('.thinking-content') as HTMLElement | null;
          if (content) {
            const newText = data.text || data.content || '';
            const msg = state.messages.find((message) => message.id === data.messageId);
            if (msg) {
              msg.thinking = (msg.thinking || '') + newText;
              content.textContent = msg.thinking;
            } else if (data.messageId) {
              this.mergeSessionMessages(
                sessionId,
                [{
                  id: data.messageId,
                  role: 'assistant',
                  content: '',
                  thinking: newText,
                  created_at: Date.now(),
                }],
                true
              );
              const mergedMsg = state.messages.find((message) => message.id === data.messageId);
              content.textContent = mergedMsg?.thinking || newText;
            } else {
              content.textContent += newText;
            }
          }
        }
        this.scrollToBottom();
      }
    }

    if (eventType === 'chat_stream_tool_call') {
      if (msgDiv) {
        const toolCallDiv = document.createElement('div');
        toolCallDiv.className = 'tool-call-message';
        toolCallDiv.style.cssText =
          'background: var(--bg-card); border-left: 2px solid var(--accent-info); padding: 4px 8px; margin: 4px 0; font-family: monospace; font-size: 11px; border-radius: 4px; color: var(--text-primary);';
        const toolName = data.toolCall?.function?.name || 'Unknown Tool';
        toolCallDiv.textContent = `🔧 使用工具: ${toolName}`;

        const contentDiv = msgDiv.querySelector('.msg-content');
        if (contentDiv && contentDiv.parentElement) {
          contentDiv.parentElement.insertBefore(toolCallDiv, contentDiv.nextSibling);
        }
        this.scrollToBottom();
      }
    }

    if (eventType === 'chat_stream_end') {
      if (msgDiv) {
        const indicator = msgDiv.querySelector('.typing-indicator') as HTMLElement | null;
        if (indicator) indicator.remove();
      }
    }

    if (eventType === 'chat_stream_error') {
      if (msgDiv) {
        const indicator = msgDiv.querySelector('.typing-indicator') as HTMLElement | null;
        if (indicator) indicator.remove();
        const contentDiv = msgDiv.querySelector('.msg-content') as HTMLElement | null;
        if (contentDiv) {
          contentDiv.innerHTML += `<div class="text-error mt-2">[Error: ${data.error}]</div>`;
        }
      }
      showError(`Chat Error: ${data.error}`);
    }

    this.scrollToBottom();
  }

  scrollToBottom(): void {
    if (this.messageContainer) {
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
  }

  private showThinkingState(_content: string): void {
    // 逻辑被合并到 handleStream (chat_stream_thinking) 中，保留空方法兼容
  }

  renderBlockedState(agentState: any) {
    const reason = agentState?.blockReason || '等待进一步操作';
    const waitingFor = agentState?.waitingFor || '';

    let banner = document.getElementById('blocked-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'blocked-banner';
      banner.className = 'blocked-banner chat-message assistant';
      banner.style.margin = '10px';
      banner.style.borderRadius = 'var(--radius-lg)';
      banner.style.border = '1px solid var(--border)';
      banner.style.padding = '12px 16px';
      banner.style.display = 'flex';
      banner.style.justifyContent = 'space-between';
      banner.style.alignItems = 'center';

      const parent = this.messageContainer?.parentElement;
      if (parent && this.messageContainer) {
        parent.insertBefore(banner, this.input?.parentElement || null);
      }
    }

    banner.innerHTML = `
      <div class="blocked-info" style="flex: 1;">
        <div style="font-weight: 600; color: #f59e0b; margin-bottom: 4px;">⚠️ 任务暂停: ${reason}</div>
        ${waitingFor ? `<div style="font-size: 13px; color: var(--text-2);">详细: 等待 ${waitingFor}</div>` : ''}
      </div>
      <button id="resume-blocked-btn" class="chat-btn primary" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
        确认并继续
      </button>
    `;

    document.getElementById('resume-blocked-btn')?.addEventListener('click', () => {
      this.clearBlockedState();
      this.resumeSession();
    });
  }

  clearBlockedState() {
    const banner = document.getElementById('blocked-banner');
    if (banner) banner.remove();
  }
}

// 暴露为全局变量供 index.html 或其他模块使用
window.chatManager = new ChatManager();

// 导出 ChatManager 类供 chat-component.ts 使用
export { ChatManager };
export type { ChatMessage, ChatSession, SessionsResponse, SessionResponse, ScreenshotResponse, WebSocketData };
