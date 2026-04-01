/// <reference types="dom" />

import { router } from './router.js';
import { show as showChatPage, hide as hideChatPage } from './chat-component.js';
import '../css/chat-page.css';

// 声明全局函数和对象
declare global {
  interface Window {
    liveView?: {
      init: () => void;
      startPolling: (intervalMs?: number) => void;
      stopPolling: () => void;
    };
    connectWebSocket: () => void;
    fetchConfig: () => Promise<void>;
    fetchHistory: () => Promise<void>;
    sendCommand: () => void;
    initRightPanelTabs: () => void;
    initHistoryPanelTabs: () => void;
    initActivityBar: () => void;
    initPlaywrightControl: () => Promise<void>;
    initMarkerCheckbox: () => void;
  }
}

// 自定义事件类型
interface PlaywrightStatusChangedEvent extends Event {
  detail: {
    isOpen: boolean;
  };
}

let liveViewPollingStarted: boolean = false;

function initLiveViewControl(): void {
  if (typeof window.liveView === 'undefined') return;
  window.addEventListener('playwrightStatusChanged', (e: Event) => {
    const customEvent = e as PlaywrightStatusChangedEvent;
    const isOpen: boolean = customEvent.detail.isOpen;
    if (isOpen && !liveViewPollingStarted) {
      window.liveView!.startPolling(500);
      liveViewPollingStarted = true;
    } else if (!isOpen && liveViewPollingStarted) {
      window.liveView!.stopPolling();
      liveViewPollingStarted = false;
    }
  });
}

export { initLiveViewControl };

document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.liveView !== 'undefined') {
    window.liveView.init();
  }

  if (typeof window.connectWebSocket === 'function') {
    window.connectWebSocket();
  }
  if (typeof window.fetchConfig === 'function') {
    window.fetchConfig();
  }
  if (typeof window.fetchHistory === 'function') {
    window.fetchHistory();
  }

  const input: HTMLElement | null = document.getElementById('customCommand');
  if (input) {
    input.addEventListener('keypress', (e: Event) => {
      const keyboardEvent = e as KeyboardEvent;
      if (keyboardEvent.key === 'Enter') {
        if (typeof window.sendCommand === 'function') {
          window.sendCommand();
        }
      }
    });
  }

  if (typeof window.initRightPanelTabs === 'function') {
    window.initRightPanelTabs();
  }
  if (typeof window.initHistoryPanelTabs === 'function') {
    window.initHistoryPanelTabs();
  }
  if (typeof window.initActivityBar === 'function') {
    window.initActivityBar();
  }
  if (typeof window.initPlaywrightControl === 'function') {
    window.initPlaywrightControl();
  }
  if (typeof window.initMarkerCheckbox === 'function') {
    window.initMarkerCheckbox();
  }
  initLiveViewControl();

  router.on('/chat', () => {
    showChatPage();
  });

  router.on('/', () => {
    hideChatPage();
  });

  router.resolve();
});
