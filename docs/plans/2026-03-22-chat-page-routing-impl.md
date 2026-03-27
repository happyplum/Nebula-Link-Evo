# AI Chat Page Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add hash-based routing to debug-ui, enabling a standalone full-screen AI chat page using navigo.

**Architecture:** Extract sidebar AI panel as a reusable component. Router switches between main console view and full-screen chat view. Both share the same ChatManager instance.

**Tech Stack:** TypeScript, navigo (hash routing), Vite

---

## Task 1: Install navigo dependency

**Files:**
- Modify: `debug-ui/package.json`

**Step 1: Add navigo to dependencies**

```bash
cd debug-ui && pnpm add navigo
```

**Step 2: Verify installation**

Run: `cd debug-ui && pnpm ls navigo`
Expected: navigo@x.x.x

---

## Task 2: Create router module

**Files:**
- Create: `debug-ui/js/router.ts`

**Step 1: Write router.ts**

```typescript
import Navigo from 'navigo';

declare global {
  interface Window {
    router?: Navigo;
  }
}

const router = new Navigo('/', { hash: true });

// Route handlers will be registered by main.ts
// This module just exports the router instance

export { router };

// Initialize on load
window.router = router;
```

**Step 2: Run type-check**

Run: `cd debug-ui && pnpm type-check`
Expected: No errors

---

## Task 3: Create chat component module

**Files:**
- Create: `debug-ui/js/chat-component.ts`

**Step 1: Write chat-component.ts**

```typescript
import { chatManager } from './chat.js';

declare global {
  interface Window {
    chatComponent?: {
      show: () => void;
      hide: () => void;
    };
  }
}

const CHAT_PAGE_CONTAINER_ID = 'chat-page-container';

function createChatPageContainer(): HTMLElement {
  const container = document.createElement('div');
  container.id = CHAT_PAGE_CONTAINER_ID;
  container.className = 'chat-page-container';
  container.innerHTML = `
    <div class="chat-page-header">
      <h1>🤖 AI 对话测试</h1>
      <a href="#/" class="back-link">← 返回控制台</a>
    </div>
    <div class="chat-page-content">
      <div class="chat-page-sidebar">
        <div class="flex-between p-2 border-b bg-tertiary shrink-0">
          <div class="flex gap-2 overflow-hidden flex-1 items-center">
            <select id="chat-page-status-filter" class="text-12 w-32 bg-secondary border rounded px-2 py-1">
              <option value="">全部状态</option>
              <option value="idle">⏸️ 空闲</option>
              <option value="running">▶️ 运行</option>
              <option value="paused">⏸️ 暂停</option>
              <option value="blocked">🚫 阻塞</option>
              <option value="completed">✅ 完成</option>
            </select>
            <select id="chat-page-session-select" class="text-12 flex-1 text-ellipsis bg-secondary border rounded px-2 py-1">
              <option value="">选择会话...</option>
            </select>
          </div>
          <div class="flex gap-1 ml-2 items-center">
            <label class="flex items-center gap-1 text-xs cursor-pointer select-none">
              <input type="checkbox" id="chat-page-cot-toggle" class="w-3 h-3">
              <span>CoT</span>
            </label>
            <div class="w-px h-4 bg-border mx-1"></div>
            <button id="chat-page-create-btn" class="px-2 py-1 text-12">➕</button>
            <button id="chat-page-delete-btn" class="px-2 py-1 text-12 text-error">🗑️</button>
          </div>
        </div>
        <div class="flex gap-2 p-2 border-b bg-tertiary shrink-0" id="chat-page-control-bar" style="display: none;">
          <button id="chat-page-interrupt-btn" type="button" class="flex-1 px-2 py-1 text-12 bg-error text-white rounded disabled:opacity-50" disabled>🔴 打断</button>
          <button id="chat-page-pause-btn" type="button" class="flex-1 px-2 py-1 text-12 bg-warning text-white rounded disabled:opacity-50" disabled>⏸️ 暂停</button>
          <button id="chat-page-resume-btn" type="button" class="flex-1 px-2 py-1 text-12 bg-success text-white rounded disabled:opacity-50" disabled>▶️ 继续</button>
          <button id="chat-page-cancel-btn" type="button" class="flex-1 px-2 py-1 text-12 bg-secondary text-error border border-error rounded disabled:opacity-50" disabled>❌ 取消</button>
        </div>
        <div id="chat-page-pausing-feedback" class="hidden px-3 py-2 bg-warning bg-opacity-20 text-warning text-xs text-center border-b">
          ⏳ 正在暂停...
        </div>
      </div>
      <div class="chat-page-messages" id="chat-page-messages">
        <div class="empty-state text-center py-4">
          <div class="text-muted text-xs">选择或创建会话以开始</div>
        </div>
      </div>
      <div class="chat-page-input p-3 border-t bg-tertiary shrink-0">
        <div id="chat-page-screenshot-preview" class="hidden mb-2 relative inline-block group">
          <img src="" class="h-20 rounded border border-border object-cover">
          <button id="chat-page-clear-screenshot" class="absolute -top-2 -right-2 bg-error text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">×</button>
        </div>
        <div class="flex gap-2 mb-2">
          <select id="chat-page-model-selector" class="text-12 flex-1 bg-secondary border rounded px-2 py-1">
            <option value="decision">决策模型 (Decision)</option>
            <option value="vision">视觉模型 (Vision)</option>
          </select>
        </div>
        <div class="relative">
          <textarea id="chat-page-input" rows="3" class="w-full text-12 p-2 pr-8 resize-none bg-secondary border rounded focus:outline-none focus:border-accent" placeholder="输入消息... (Ctrl+Enter 发送)"></textarea>
          <div class="absolute bottom-2 right-2 flex gap-1">
            <button id="chat-page-screenshot-btn" class="p-1 hover:bg-elevated rounded text-muted hover:text-primary">📷</button>
            <button id="chat-page-send-btn" class="p-1 hover:bg-elevated rounded text-accent hover:text-accent-hover">➤</button>
          </div>
        </div>
      </div>
    </div>
  `;
  return container;
}

function show(): void {
  // Hide main layout
  document.querySelector('.activity-bar')?.classList.add('hidden');
  document.querySelector('.sidebar')?.classList.add('hidden');
  document.querySelector('.main')?.classList.add('hidden');
  document.querySelector('.right-panel')?.classList.add('hidden');
  
  // Show/create chat page
  let container = document.getElementById(CHAT_PAGE_CONTAINER_ID);
  if (!container) {
    container = createChatPageContainer();
    document.body.appendChild(container);
    wireEventListeners();
  }
  container.classList.remove('hidden');
  
  // Sync UI state with ChatManager
  syncUIState();
}

function hide(): void {
  // Show main layout
  document.querySelector('.activity-bar')?.classList.remove('hidden');
  document.querySelector('.sidebar')?.classList.remove('hidden');
  document.querySelector('.main')?.classList.remove('hidden');
  document.querySelector('.right-panel')?.classList.remove('hidden');
  
  // Hide chat page
  const container = document.getElementById(CHAT_PAGE_CONTAINER_ID);
  if (container) {
    container.classList.add('hidden');
  }
}

function syncUIState(): void {
  // Sync session select with ChatManager
  const sessionSelect = document.getElementById('chat-page-session-select') as HTMLSelectElement;
  const statusFilter = document.getElementById('chat-page-status-filter') as HTMLSelectElement;
  
  if (sessionSelect && window.chatManager) {
    const currentSessionId = window.chatManager.currentSessionId;
    // Copy options from sidebar session select
    const sidebarSelect = document.getElementById('session-select') as HTMLSelectElement;
    if (sidebarSelect) {
      sessionSelect.innerHTML = sidebarSelect.innerHTML;
      if (currentSessionId) {
        sessionSelect.value = currentSessionId;
      }
    }
  }
}

function wireEventListeners(): void {
  // Session select change
  const sessionSelect = document.getElementById('chat-page-session-select');
  if (sessionSelect) {
    sessionSelect.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      if (target.value && window.chatManager) {
        window.chatManager.switchSession(target.value);
      }
    });
  }
  
  // Status filter change
  const statusFilter = document.getElementById('chat-page-status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      if (window.chatManager) {
        window.chatManager.setStatusFilter(target.value);
      }
    });
  }
  
  // Create session button
  const createBtn = document.getElementById('chat-page-create-btn');
  if (createBtn) {
    createBtn.addEventListener('click', () => {
      if (window.chatManager) {
        window.chatManager.createSession();
      }
    });
  }
  
  // Delete session button
  const deleteBtn = document.getElementById('chat-page-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (window.chatManager) {
        window.chatManager.deleteCurrentSession();
      }
    });
  }
  
  // Send message
  const sendBtn = document.getElementById('chat-page-send-btn');
  const input = document.getElementById('chat-page-input') as HTMLTextAreaElement;
  if (sendBtn && input) {
    sendBtn.addEventListener('click', () => {
      if (window.chatManager) {
        // Copy input value to sidebar input (ChatManager reads from there)
        const sidebarInput = document.getElementById('chat-input') as HTMLTextAreaElement;
        if (sidebarInput) {
          sidebarInput.value = input.value;
          input.value = '';
        }
        window.chatManager.sendMessage();
      }
    });
    
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        sendBtn.click();
      }
    });
  }
  
  // Back button
  const backLink = document.querySelector('.back-link');
  if (backLink) {
    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = '/';
    });
  }
}

// Export public API
window.chatComponent = {
  show,
  hide
};

export { show, hide };
```

**Step 2: Run type-check**

Run: `cd debug-ui && pnpm type-check`
Expected: No errors

---

## Task 4: Create chat page styles

**Files:**
- Create: `debug-ui/css/chat-page.css`

**Step 1: Write chat-page.css**

```css
/* Chat Page Container */
.chat-page-container {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-primary);
  z-index: 1000;
  display: flex;
  flex-direction: column;
}

.chat-page-container.hidden {
  display: none;
}

/* Chat Page Header */
.chat-page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

.chat-page-header h1 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.chat-page-header .back-link {
  color: var(--accent);
  text-decoration: none;
  font-size: 13px;
}

.chat-page-header .back-link:hover {
  text-decoration: underline;
}

/* Chat Page Content */
.chat-page-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
}

/* Chat Page Sidebar */
.chat-page-sidebar {
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

/* Chat Page Messages */
.chat-page-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

/* Chat Page Input */
.chat-page-input {
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}

#chat-page-input {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  color: var(--text-primary);
}

#chat-page-input:focus {
  border-color: var(--accent);
}

/* Responsive */
@media (max-width: 768px) {
  .chat-page-content {
    max-width: 100%;
  }
}
```

**Step 2: Add import to index.html**

Add to `debug-ui/index.html` in the `<head>` section after other CSS imports:
```html
<link rel="stylesheet" href="./css/chat-page.css">
```

---

## Task 5: Wire up router in main.ts

**Files:**
- Modify: `debug-ui/js/main.ts`

**Step 1: Import and configure router**

Add at the top of main.ts:
```typescript
import { router } from './router.js';
import { show as showChatPage, hide as hideChatPage } from './chat-component.js';
```

**Step 2: Register route handlers**

Add after imports:
```typescript
// Register routes
router.on('/chat', () => {
  showChatPage();
});

router.on('/', () => {
  hideChatPage();
});

// Resolve current route
router.resolve();
```

**Step 3: Run type-check**

Run: `cd debug-ui && pnpm type-check`
Expected: No errors

---

## Task 6: Add navigation entry in activity bar

**Files:**
- Modify: `debug-ui/index.html`

**Step 1: Add chat page button to activity bar**

Find the activity bar section (around line 19-41) and add after the interactions button:
```html
<div class="activity-item" onclick="window.location.hash='#/chat'">
    💬
    <span class="tooltip">对话测试</span>
</div>
```

Place this between the AI button and the interactions button, or at the end before `<div class="flex-1"></div>`.

---

## Task 7: Export ChatManager for module access

**Files:**
- Modify: `debug-ui/js/chat.ts`

**Step 1: Export chatManager instance**

At the end of chat.ts, change:
```typescript
window.chatManager = new ChatManager();
```

To:
```typescript
const chatManager = new ChatManager();
window.chatManager = chatManager;
export { chatManager };
```

**Step 2: Run type-check**

Run: `cd debug-ui && pnpm type-check`
Expected: No errors

---

## Task 8: Test routing functionality

**Files:**
- None (manual testing)

**Step 1: Start dev server**

Run: `pnpm dev`

**Step 2: Test navigation**

1. Open `http://localhost:5173/debug/`
2. Click the new 💬 button in activity bar
3. Verify URL changes to `http://localhost:5173/debug/#/chat`
4. Verify chat page appears full-screen
5. Verify main layout is hidden
6. Click "← 返回控制台" link
7. Verify URL changes back to `http://localhost:5173/debug/#/`
8. Verify main layout reappears

**Step 3: Test session sync**

1. Navigate to chat page
2. Create a new session
3. Return to main console
4. Open sidebar AI panel
5. Verify the same session appears in the dropdown

---

## Task 9: Build and verify production

**Files:**
- None (build verification)

**Step 1: Build debug-ui**

Run: `cd debug-ui && pnpm build`
Expected: Build succeeds without errors

**Step 2: Preview production build**

Run: `cd debug-ui && pnpm preview`
Then test the same navigation flows as Task 8.

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | Install navigo | package.json |
| 2 | Create router module | router.ts |
| 3 | Create chat component | chat-component.ts |
| 4 | Add chat page styles | chat-page.css |
| 5 | Wire router in main.ts | main.ts |
| 6 | Add navigation button | index.html |
| 7 | Export chatManager | chat.ts |
| 8 | Test routing | Manual |
| 9 | Verify production build | Manual |
