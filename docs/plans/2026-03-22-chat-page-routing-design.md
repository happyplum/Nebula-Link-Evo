# AI Chat Page Routing Design

## Overview

Add hash-based routing to debug-ui, enabling a standalone full-screen AI chat testing page while preserving the existing sidebar AI panel.

## Requirements

| Requirement | Decision |
|-------------|----------|
| Routing method | Hash routing with navigo (`#/chat`) |
| Session data | Shared (same ChatManager instance) |
| Page relationship | Independent full-screen page, not sharing sidebar |
| Feature parity | Identical to sidebar AI panel |
| Code maintenance | Single component, rendered in different layouts |

## Architecture

### URL Structure

```
/debug/           → Main debug console (default)
/debug/#/chat     → AI chat testing page (full-screen)
```

### Component Strategy

**Key Insight**: Instead of creating a duplicate chat implementation, extract the AI panel as a reusable component that can be rendered in two contexts:

1. **Sidebar context**: Within `#sidebar-ai` (current behavior)
2. **Full-screen context**: Within `#main-chat-page` (new route)

Both contexts share the **same ChatManager instance** and session data.

### File Structure

```
debug-ui/
├── index.html              # Modified: add chat page container
├── js/
│   ├── router.ts           # NEW: navigo router configuration
│   ├── chat-component.ts   # NEW: reusable chat panel component
│   ├── chat.ts             # Modified: ChatManager accepts container config
│   └── main.ts             # Modified: initialize router
└── css/
    └── chat-page.css       # NEW: full-screen chat page styles
```

## Implementation Details

### 1. Router Module (router.ts)

```typescript
import Navigo from 'navigo';
import { renderChatPage, hideChatPage } from './chat-component.js';

const router = new Navigo('/', { hash: true });

router.on('/chat', () => {
  renderChatPage();
});

router.on('/', () => {
  hideChatPage();
});

router.resolve();

export { router };
```

### 2. Chat Component (chat-component.ts)

```typescript
import { chatManager } from './chat.js';

let chatPageContainer: HTMLElement | null = null;

export function renderChatPage(): void {
  // Hide main layout
  document.querySelector('.activity-bar')?.classList.add('hidden');
  document.querySelector('.sidebar')?.classList.add('hidden');
  document.querySelector('.main')?.classList.add('hidden');
  document.querySelector('.right-panel')?.classList.add('hidden');
  
  // Show/create chat page container
  chatPageContainer = document.getElementById('chat-page-container');
  if (!chatPageContainer) {
    chatPageContainer = createChatPageContainer();
    document.body.appendChild(chatPageContainer);
  }
  chatPageContainer.classList.remove('hidden');
  
  // Rebind ChatManager to full-screen container
  chatManager.rebindToContainer('chat-page-');
}

export function hideChatPage(): void {
  // Restore main layout
  document.querySelector('.activity-bar')?.classList.remove('hidden');
  document.querySelector('.sidebar')?.classList.remove('hidden');
  document.querySelector('.main')?.classList.remove('hidden');
  document.querySelector('.right-panel')?.classList.remove('hidden');
  
  // Hide chat page
  chatPageContainer?.classList.add('hidden');
  
  // Rebind ChatManager back to sidebar
  chatManager.rebindToContainer('');
}

function createChatPageContainer(): HTMLElement {
  const container = document.createElement('main');
  container.id = 'chat-page-container';
  container.innerHTML = `
    <div class="chat-page-layout">
      <div class="chat-page-sidebar">
        <div class="chat-page-header">
          <h1>💬 AI 对话测试</h1>
          <a href="#/" class="back-link">← 返回控制台</a>
        </div>
        <div class="flex-between p-2 border-b bg-tertiary">
          <select id="chat-page-session-status-filter" class="text-12">...</select>
          <select id="chat-page-session-select" class="text-12">...</select>
        </div>
        <div class="flex gap-2 p-2">
          <button id="chat-page-create-btn">➕</button>
          <button id="chat-page-delete-btn">🗑️</button>
        </div>
      </div>
      <div class="chat-page-content">
        <div id="chat-page-messages" class="chat-messages"></div>
        <div class="chat-page-input-area">
          <textarea id="chat-page-input" placeholder="输入消息..."></textarea>
          <button id="chat-page-send-btn">➤</button>
        </div>
      </div>
    </div>
  `;
  return container;
}
```

### 3. ChatManager Modification (chat.ts)

Add `rebindToContainer()` method to support container switching:

```typescript
class ChatManager {
  private prefix: string = '';
  
  rebindToContainer(prefix: string): void {
    this.prefix = prefix;
    this.messageContainer = document.getElementById(`${prefix}chat-messages`);
    this.sessionSelect = document.getElementById(`${prefix}session-select`) as HTMLSelectElement;
    this.input = document.getElementById(`${prefix}chat-input`) as HTMLInputElement;
    // Rebind other elements...
  }
  
  // Update all getElementById calls to use this.prefix
}
```

### 4. Navigation Entry

Add button to activity bar:

```html
<div class="activity-item" onclick="location.hash='#/chat'">
    💬
    <span class="tooltip">对话测试</span>
</div>
```

### 5. CSS (chat-page.css)

```css
.chat-page-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
}

.chat-page-sidebar {
  width: 320px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.chat-page-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.chat-page-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.chat-page-input-area {
  padding: 16px;
  border-top: 1px solid var(--border);
}
```

## Implementation Phases

### Phase 1: Router Setup
- [ ] Install navigo: `pnpm add navigo`
- [ ] Create `router.ts` with hash routing
- [ ] Import router in `main.ts`

### Phase 2: ChatManager Refactor
- [ ] Add `prefix` property to ChatManager
- [ ] Add `rebindToContainer(prefix)` method
- [ ] Update all `getElementById` calls to use prefix

### Phase 3: Chat Component
- [ ] Create `chat-component.ts` with render/hide functions
- [ ] Create `chat-page.css` styles
- [ ] Add chat page container HTML structure

### Phase 4: Integration
- [ ] Add activity bar button for navigation
- [ ] Add back link in chat page
- [ ] Test navigation flow

### Phase 5: Testing
- [ ] Verify sidebar AI panel still works
- [ ] Verify chat page renders correctly
- [ ] Verify session data shared between views
- [ ] Test SSE streaming in both contexts

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Sidebar regression | Test sidebar after each change |
| SSE connection issues | ChatManager remains singleton, single SSE connection |
| Memory leaks | Container switching only changes DOM bindings, no new instances |

## Success Criteria

- [ ] Navigating to `#/chat` shows full-screen chat page
- [ ] Navigating to `#/` returns to main debug console
- [ ] Session data persists between views
- [ ] Sidebar AI panel functions unchanged
- [ ] Single codebase for chat functionality
