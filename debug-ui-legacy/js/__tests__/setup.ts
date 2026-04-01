/**
 * jsdom 测试环境 setup
 * 用于 Debug UI 前端测试
 */
import { vi } from 'vitest';
import { JSDOM } from 'jsdom';

// 创建 jsdom 实例
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost:3000',
});

// 设置全局对象
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Document = dom.window.Document;

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  url: string;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);

// Mock fetch
global.fetch = vi.fn();

// Mock customElements
if (!dom.window.customElements) {
  (dom.window as any).customElements = {
    define: vi.fn(),
    get: vi.fn(),
    whenDefined: vi.fn(),
  };
}

// Mock scrollIntoView - jsdom doesn't implement this
Element.prototype.scrollIntoView = vi.fn();

// Mock remove for notifications
Element.prototype.remove = vi.fn(function (this: Element) {
  if (this.parentNode) {
    this.parentNode.removeChild(this);
  }
});

// 创建测试需要的 DOM 元素
beforeEach(() => {
  document.body.innerHTML = `
    <div id="notificationContainer"></div>
    <div id="logDisplay"></div>
    <div id="statusIndicator"></div>
    <div id="statusText"></div>
    <div id="connectionStatusBadge"></div>
    <div id="connectionStatus"></div>
    <div id="decisionDisplay"></div>
    <div id="playwright-status-indicator"></div>
    <div id="playwright-status-text"></div>
    <div id="fullLogDisplay"></div>
    <div id="ai-log-modal" style="display: none;"></div>
    <div id="modal-body"></div>
  `;
});

// 清理
afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});
