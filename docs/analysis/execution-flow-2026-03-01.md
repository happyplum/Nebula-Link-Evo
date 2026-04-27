# Nebula-Link Evo 执行流程分析

> **⚠️ Historical Document (2026-03-01)** — This analysis reflects the codebase state at the date above. The execution entry point `TaskExecutor` has been replaced by `TaskService`, and several modules referenced here have been removed or restructured. For current architecture, refer to `AGENTS.md` files and `README.md`.

**分析时间**: 2026-03-01  
**架构**: 双服务 Monorepo (Proxy Adapter + Playwright Server)

---

## 📊 系统架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                              │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │  Debug UI   │  │  REST API    │  │  WebSocket      │   │
│  │  (Vite)     │  │  Requests    │  │  Commands       │   │
│  │  Port 5173  │  │  Port 3000   │  │  /debug/ws/*    │   │
│  └─────────────┘  └──────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│               PROXY ADAPTER (Port 3000)                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Fastify Server + WebSocket Manager                   │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ Route Handlers:                                      │  │
│  │ - /task         → TaskExecutor                       │  │
│  │ - /chat         → ChatHandler                        │  │
│  │ - /config       → ConfigManager                      │  │
│  │ - /debug/*      → Debug UI Routes                    │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ Core Components:                                     │  │
│  │ - TaskExecutor (1,355 lines)                         │  │
│  │ - BrowserClient (290 lines)                          │  │
│  │ - ClientFactory (AI providers)                       │  │
│  │ - MCP SDK Client                                     │  │
│  │ - ConversationManager (SQLite)                       │  │
│  │ - InteractionLogger                                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │ HTTP (localhost)
                            │ Port 3001
                            ▼
┌─────────────────────────────────────────────────────────────┐
│             PLAYWRIGHT SERVER (Port 3001)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Fastify Server + CDP + WebSocket                     │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ Route Handlers:                                      │  │
│  │ - /browser/*    → Lifecycle (open/close/navigate)    │  │
│  │ - /action/*     → click/type/scroll                  │  │
│  │ - /dom/*        → DOM extraction                     │  │
│  │ - /cdp          → CDP WebSocket tunnel               │  │
│  │ - /stream/*     → Screencast streaming               │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ Core Components:                                     │  │
│  │ - BrowserManager (Singleton, 1,082 lines)            │  │
│  │ - ScreencastManager                                  │  │
│  │ - LocatorGenerator (multi-strategy)                  │  │
│  │ - MarkerInjector                                     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   BROWSER LAYER                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Chromium (Playwright)                                │  │
│  │ - Headless mode available                            │  │
│  │ - CDP Port 9222                                      │  │
│  │ - Real-time screenshot streaming                     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 服务启动流程

### 1. 启动脚本 (`start.bat`)

```batch
# 1. 启动 Playwright Server (端口 3001)
cd playwright-server
pnpm dev  # tsx watch src/server.ts

# 2. 启动 Proxy Adapter (端口 3000)
cd ../proxy-adapter
pnpm dev  # tsx watch src/server.ts
```

### 2. Playwright Server 启动序列

**文件**: `playwright-server/src/server.ts`

```typescript
// 步骤 1: 创建 Fastify 实例
const app = Fastify({ logger: { level: 'warn' } })

// 步骤 2: 注册全局插件
await app.register(cors, { origin: true, credentials: true })
await app.register(websocket)
await app.register(swaggerPlugin)

// 步骤 3: 注册路由插件 (按顺序)
await app.register(browserRoutesPlugin, { prefix: '/browser' })
await app.register(actionRoutesPlugin, { prefix: '/action' })
await app.register(domRoutesPlugin, { prefix: '/dom' })
await app.register(domRoutesPlugin, { prefix: '/execute' })
await app.register(healthRoutesPlugin, { prefix: '/health' })
await app.register(streamRoutesPlugin, { prefix: '/browser' })
await app.register(cdpRoutesPlugin)

// 步骤 4: 启动服务器
await app.listen({ port: 3001, host: '0.0.0.0' })
```

**启动日志**:
```
Playwright Server running on http://localhost:3001
CDP WebSocket endpoint: ws://localhost:3001/cdp
```

### 3. Proxy Adapter 启动序列

**文件**: `proxy-adapter/src/server.ts`

```typescript
// 步骤 1: 加载环境变量
dotenv.config({ path: '.env' })

// 步骤 2: 创建 Fastify 实例
const app = Fastify({ logger: { level: 'warn' } })

// 步骤 3: 注册全局插件
await app.register(cors, { origin: true, credentials: true })
await app.register(websocket)

// 步骤 4: 环境感知 Debug UI 服务
if (isProduction) {
  await app.register(fastifyStatic, { root: 'dist/static/debug', prefix: '/debug' })
} else {
  // 开发模式代理到 Vite dev server (端口 5173)
}

// 步骤 5: 注册路由插件
await app.register(healthRoutes)
await app.register(configRoutes)
await app.register(taskRoutes)
await app.register(debugRoutes)

// 步骤 6: 初始化核心组件
await app.decorate('taskExecutor', taskExecutor)
await app.decorate('wsManager', wsManager)
await app.decorate('browserClient', browserClient)

// 步骤 7: 初始化 TaskExecutor
await taskExecutor.initialize()
  → 加载配置文件
  → 创建 AI ClientFactory
  → 初始化 MCP Client
  → 设置 WebSocket 处理器

// 步骤 8: 启动服务器
await app.listen({ port: 3000, host: '0.0.0.0' })
```

**启动日志**:
```
[INFO] Development mode: Will proxy /debug* requests to Vite dev server
TaskExecutor initialized
Proxy Adapter Server running on http://localhost:3000
Debug UI WebSocket: ws://localhost:3000/debug/ws/chat
```

---

## ⚡ 任务执行流程

### 完整调用链

```
User Request
    │
    ▼
POST /task (Port 3000)
    │
    ▼
TaskExecutor.execute(request)
    │
    ├─→ [1] 创建 Task ID 和历史记录
    ├─→ [2] 打开浏览器
    ├─→ [3] 导航到 URL
    │
    └─→ [4] 执行循环 (maxSteps)
         │
         ├─→ [4.1] 截图 + DOM 提取
         ├─→ [4.2] AI 分析 (Vision + Decision)
         ├─→ [4.3] 解析 Action
         ├─→ [4.4] 执行 Action
         ├─→ [4.5] 记录交互历史
         └─→ [4.6] 检查完成条件
              │
              ├─ 未完成 → 继续循环
              └─ 完成 → 关闭浏览器，返回结果
```

### 详细步骤分解

#### 步骤 1: API 请求接收

**文件**: `proxy-adapter/src/plugins/routes/task.ts`

```typescript
POST /task
Body: {
  url: "https://example.com",
  instruction: "Click the submit button",
  skillId?: string,
  context?: { maxSteps: 10 }
}

// Route handler 委托给 TaskExecutor
const result = await taskExecutor.execute(request.body)
```

#### 步骤 2: TaskExecutor 初始化执行

**文件**: `proxy-adapter/src/task-executor.ts` (lines 61-220)

```typescript
async execute(request: TaskRequest): Promise<TaskResponse> {
  const { url, instruction, skillId, context = {} } = request
  
  // 2.1 创建 Task ID
  const taskId = crypto.randomUUID()
  
  // 2.2 广播任务开始事件 (WebSocket)
  this.wsManager.broadcast({
    type: 'task_started',
    taskId,
    url,
    instruction
  })
  
  // 2.3 初始化任务历史
  const taskHistory: TaskHistory = {
    taskId, url, instruction,
    startTime: new Date().toISOString(),
    status: 'running',
    steps: []
  }
  this.historyManager.add(taskHistory)
  
  // 2.4 如果是 Skill 执行
  if (skillId) {
    const skill = skillManager.getSkill(skillId)
    for (const step of skill.steps) {
      const result = await this.executeAction(step)
      // 记录步骤...
      if (step.type === 'finish') {
        return { success: true, ... }
      }
    }
  }
  
  // 2.5 标准 AI 驱动执行
  const maxSteps = context.maxSteps || 10
  
  // 步骤 3: 打开浏览器
  await browserClient.openBrowser()
  
  // 步骤 4: 导航到 URL
  await browserClient.navigate(url)
  
  // 步骤 5: 主循环
  for (let step = 0; step < maxSteps; step++) {
    // ... 见下方详细分解
  }
}
```

#### 步骤 3: 浏览器打开和导航

**文件**: `proxy-adapter/src/browser-client.ts`

```typescript
// 3.1 打开浏览器
async openBrowser(): Promise<void> {
  await axios.post(`${PLAYWRIGHT_URL}/browser/open`, {
    headless: false,
    cdpPort: 9222
  })
}

// 3.2 导航到 URL
async navigate(url: string): Promise<void> {
  await axios.post(`${PLAYWRIGHT_URL}/browser/navigate`, { url })
}
```

**Playwright Server 处理**:

**文件**: `playwright-server/src/plugins/routes/browser.ts`

```typescript
POST /browser/open
→ BrowserManager.openBrowser(config)
  → chromium.launch({ headless: false, args: [`--remote-debugging-port=9222`] })
  → browser.newContext()
  → context.newPage()

POST /browser/navigate
→ BrowserManager.navigate(url, { waitUntil: 'networkidle' })
  → page.goto(url, options)
```

#### 步骤 4: AI 驱动的执行循环

**文件**: `proxy-adapter/src/task-executor.ts` (lines 229-400)

```typescript
for (let step = 0; step < maxSteps; step++) {
  // 4.1 截图 + DOM 提取
  const screenshotData = await browserClient.screenshot()
  const dom = await browserClient.getSimplifiedDOM()
  
  // 4.2 AI 分析
  let elements: UIElement[] = []
  let action: Action
  
  // 检查是否有 MCP 工具
  const mcpTools = this.mcpClient?.getAvailableTools() || []
  
  if (this.clientFactory!.isUnifiedMode()) {
    // 统一模式：单个模型处理 vision + decision
    const result = await this.clientFactory!.decideAction(
      { screenshot: screenshotData.screenshot, dom, elements, instruction },
      mcpTools
    )
    action = result.action
    elements = result.elements
  } else {
    // 分离模式：先 vision 检测，再 decision 决策
    elements = await this.clientFactory!.detectUI(
      screenshotData.screenshot,
      dom.viewport,
      instruction
    )
    
    action = await this.clientFactory!.decideNextAction(
      { screenshot: screenshotData.screenshot, dom, elements, instruction },
      mcpTools
    )
  }
  
  // 4.3 解析 Action
  const actionType = action.type // 'click' | 'type' | 'scroll' | 'finish' | 'mcp_call'
  
  // 4.4 执行 Action
  const result = await this.executeAction(action)
  previousActions.push(result)
  
  // 4.5 记录交互历史 (异步，非阻塞)
  await interactionLogger.log({
    sessionId: taskId,
    snapshotId: dom.snapshot_id,
    markerId: action.target_id,
    success: result.success,
    strategyUsed: result.strategy,
    retryCount: result.retries,
    errorMessage: result.error
  })
  
  // 4.6 检查完成条件
  if (action.type === 'finish') {
    await browserClient.closeBrowser()
    return {
      success: true,
      url,
      actions: previousActions,
      result: action.params?.result
    }
  }
  
  // 检查是否失败
  if (!result.success && step >= maxSteps - 1) {
    // 收集失败样本
    await failureSampleCollector.collect({
      sessionId: taskId,
      screenshot: screenshotData.screenshot,
      dom: dom.simplified_dom,
      error: result.message
    })
  }
  
  await this.sleep(1000) // 步骤间延迟
}
```

#### 步骤 5: Action 执行

**文件**: `proxy-adapter/src/task-executor.ts` (executeAction 方法)

```typescript
private async executeAction(action: Action): Promise<ActionResult> {
  switch (action.type) {
    case 'click':
      if (action.params?.target_id) {
        // 通过 marker ID 点击 (新方式)
        return await this.executeClickByMarker(
          action.params.snapshot_id,
          action.params.target_id
        )
      } else {
        // 通过坐标点击 (旧方式)
        return await this.executeClickByCoords(
          action.params.x,
          action.params.y
        )
      }
    
    case 'type':
      return await browserClient.type(
        action.params.selector,
        action.params.text
      )
    
    case 'scroll':
      return await browserClient.scroll(
        action.params.x,
        action.params.y
      )
    
    case 'mcp_call':
      // 调用 MCP 工具
      const toolResult = await this.mcpClient!.callTool(
        action.params.name,
        action.params.arguments
      )
      return { success: true, message: JSON.stringify(toolResult) }
    
    case 'finish':
      return { success: true, message: 'Task completed' }
    
    default:
      throw new Error(`Unknown action type: ${action.type}`)
  }
}
```

#### 步骤 6: Playwright Server Action 处理

**文件**: `playwright-server/src/plugins/routes/action.ts`

```typescript
// 6.1 坐标点击
POST /action/click
Body: { x: number, y: number }
→ 3 次重试机制
→ BrowserManager.click(x, y)
  → page.mouse.click(x, y)

// 6.2 通过 Selector 点击
POST /action/click-by-selector
Body: { selector: string, options?: ClickOptions }
→ BrowserManager.clickBySelector(selector, options)
  → page.click(selector)
  → 失败时尝试 force: true

// 6.3 通过 Marker ID 点击 (新)
POST /action/click-by-marker
Body: { snapshot_id: string, nebula_id: number }
→ ClickResolutionService.resolve(snapshot_id, nebula_id)
  → 生成 locator_bundle (6 种策略)
  → 依次尝试:
     1. getByRole()
     2. getByTestId()
     3. getByLabel()/getByPlaceholder()
     4. getByText()
     5. CSS locator()
     6. XPath locator() (fallback)

// 6.4 输入文本
POST /action/type
Body: { selector: string, text: string }
→ BrowserManager.type(selector, text)
  → page.fill(selector, text)

// 6.5 滚动
POST /action/scroll
Body: { x: number, y: number }
→ BrowserManager.scroll(x, y)
  → page.mouse.wheel(x, y)
```

#### 步骤 7: DOM 提取和标记

**文件**: `playwright-server/src/plugins/routes/dom.ts`

```typescript
GET /dom/simplified?version=v2
→ BrowserManager.getSimplifiedDOM(version)
  → 提取可见元素
  → 生成 marker numbers (红色数字覆盖)
  → 创建 elements_map: [markerNumber, ElementInfo][]
  → 返回：
     {
       snapshot_id: "uuid",
       elements_map: [...],
       simplified_dom: "...",
       annotated_screenshot_base64: "..."
     }
```

**标记注入流程**:

**文件**: `playwright-server/src/marker-injector.ts`

```typescript
class MarkerInjector {
  async injectMarkers(page: Page): Promise<void> {
    // 1. 查找所有可交互元素
    const elements = await page.$$('button, a, input, [role="button"]')
    
    // 2. 为每个元素分配 marker ID
    for (let i = 0; i < elements.length; i++) {
      await elements[i].setAttribute('data-nebula-id', String(i + 1))
      
      // 3. 创建红色数字覆盖层
      const box = await elements[i].boundingBox()
      await page.evaluate((bbox, num) => {
        const marker = document.createElement('div')
        marker.textContent = num
        marker.style.cssText = `
          position: absolute;
          top: ${bbox.y}px;
          left: ${bbox.x}px;
          background: red;
          color: white;
          font-size: 12px;
          z-index: 9999;
        `
        document.body.appendChild(marker)
      }, box, i + 1)
    }
  }
}
```

---

## 🔄 关键决策点

### 1. AI 模式选择

**文件**: `proxy-adapter/src/clients/index.ts`

```typescript
isUnifiedMode(): boolean {
  return this.config.defaults.mode === 'unified'
}

// Unified 模式：单个模型处理 vision + decision
if (isUnifiedMode()) {
  const result = await client.decideAction(context)
  // 返回：{ action, elements }
}

// Separation 模式：独立的 vision 和 decision 客户端
else {
  const elements = await visionClient.detectUIElements(...)
  const action = await decisionClient.decideNextAction(...)
}
```

### 2. Locator 策略回退

**文件**: `playwright-server/src/services/click-resolution.ts`

```typescript
async resolve(snapshotId: string, nebulaId: number): Promise<Locator> {
  const cached = await this.snapshotCache.get(snapshotId)
  const elementInfo = cached.elements_map.find(([id]) => id === nebulaId)
  
  // 生成 locator_bundle
  const strategies = [
    { strategy: 'role', selector: generateRoleSelector(elementInfo) },
    { strategy: 'testid', selector: `[data-testid="${elementInfo.testid}"]` },
    { strategy: 'aria', selector: `[aria-label="${elementInfo.ariaLabel}"]` },
    { strategy: 'text', selector: `text=${elementInfo.text}` },
    { strategy: 'css', selector: elementInfo.cssSelector },
    { strategy: 'xpath', selector: elementInfo.xpath }
  ]
  
  // 依次尝试
  for (const { strategy, selector } of strategies) {
    try {
      const locator = this.page.locator(selector)
      await locator.click({ timeout: 2000 })
      return { success: true, strategy }
    } catch (error) {
      // 尝试下一个策略
    }
  }
  
  throw new Error('All strategies failed')
}
```

### 3. 错误处理和重试

**文件**: `playwright-server/src/plugins/routes/action.ts`

```typescript
// 3 次重试机制 (click 操作)
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    await browserManager.click(x, y)
    return { success: true, attempts: attempt }
  } catch (error) {
    lastError = error
    if (attempt < 3) {
      await sleep(attempt * 1000) // 递增延迟
    }
  }
}
throw lastError
```

---

## 📦 数据流

### 1. TaskRequest → TaskResponse

```typescript
// 请求
interface TaskRequest {
  url: string
  instruction: string
  skillId?: string
  context?: {
    maxSteps?: number
    params?: Record<string, any>
  }
}

// 响应
interface TaskResponse {
  success: boolean
  url: string
  actions: ActionResult[]
  result?: string
  error?: string
}

// Action 结果
interface ActionResult {
  action: Action
  success: boolean
  message: string
  strategy?: string  // 使用的 locator 策略
  retries?: number   // 重试次数
}
```

### 2. 交互历史存储

**文件**: `proxy-adapter/src/services/interaction-logger.ts`

```typescript
// SQLite 表结构
CREATE TABLE interactions (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  snapshot_id TEXT,
  nebula_id INTEGER,
  marker_id INTEGER,
  success BOOLEAN,
  strategy_used TEXT,
  retry_count INTEGER,
  error_message TEXT,
  created_at DATETIME
)

// 异步写入 (队列 + 批量刷新)
await interactionLogger.log({
  sessionId: taskId,
  snapshotId: dom.snapshot_id,
  nebulaId: action.target_id,
  success: result.success,
  strategyUsed: result.strategy,
  retryCount: result.retries,
  errorMessage: result.error
})
```

### 3. WebSocket 实时事件

**文件**: `proxy-adapter/src/websocket-manager.ts`

```typescript
// 广播事件类型
type WSEvent =
  | { type: 'task_started', taskId, url, instruction }
  | { type: 'step_completed', step, action, success }
  | { type: 'task_completed', taskId, result }
  | { type: 'task_failed', taskId, error }
  | { type: 'chat_message', role, content }

// 客户端监听
ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  switch (data.type) {
    case 'task_started':
      updateUI('Running...')
      break
    case 'step_completed':
      addLogEntry(data.step, data.action)
      break
    case 'task_completed':
      showResult(data.result)
      break
  }
}
```

---

## 🎯 核心组件职责

### TaskExecutor (1,355 行)

**职责**: 任务编排和 AI 决策循环

**关键方法**:
- `execute(request)`: 主入口
- `executeAction(action)`: Action 分发
- `executeClickByMarker()`: 视觉标记点击
- `executeClickByCoords()`: 坐标点击
- `sleep(ms)`: 步骤间延迟

**依赖**:
- `BrowserClient`: 浏览器操作
- `ClientFactory`: AI 客户端
- `MCPSDKClient`: MCP 工具调用
- `InteractionLogger`: 交互日志
- `FailureSampleCollector`: 失败样本收集

---

### BrowserManager (1,082 行)

**职责**: Playwright 浏览器生命周期和页面操作

**关键方法**:
- `openBrowser(config)`: 启动浏览器
- `closeBrowser()`: 关闭浏览器
- `navigate(url)`: 导航
- `screenshot()`: 截图
- `click(x, y)`: 点击
- `type(selector, text)`: 输入
- `getSimplifiedDOM()`: DOM 提取

**单例模式**:
```typescript
class BrowserManager {
  private static instance: BrowserManager
  private browser: Browser | null = null
  private page: Page | null = null
  
  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager()
    }
    return BrowserManager.instance
  }
}
```

---

### ClientFactory

**职责**: AI 客户端工厂和多模式支持

**层次结构**:
```
ClientFactory (抽象)
├── VisionClientFactoryImpl
│   ├── GLMVisionClient
│   ├── OpenAIVisionClient
│   ├── AnthropicVisionClient
│   └── NVIDIAPluginClient
└── DecisionClientFactoryImpl
    ├── KimiDecisionClient
    ├── GLMDecisionClient
    ├── NVIDIADecisionClient
    ├── OpenAIDecisionClient
    └── AnthropicDecisionClient
```

**关键方法**:
- `createVisionClient(provider, model)`: 创建视觉客户端
- `createDecisionClient(provider, model)`: 创建决策客户端
- `detectUI(screenshot, viewport)`: UI 元素检测
- `decideAction(context, mcpTools)`: 决策下一个动作
- `isUnifiedMode()`: 检查是否统一模式

---

## ⚠️ 错误处理流程

### 1. 自定义错误类

**文件**: `proxy-adapter/src/errors/`

```typescript
class BrowserError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'BrowserError'
  }
}

class AIClientError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message)
    this.name = 'AIClientError'
  }
}

class TaskExecutionError extends Error {
  constructor(message: string, public step?: number) {
    super(message)
    this.name = 'TaskExecutionError'
  }
}
```

### 2. 全局错误处理

**文件**: `proxy-adapter/src/plugins/03-error-handler.plugin.ts`

```typescript
fastify.setErrorHandler((error, request, reply) => {
  if (error instanceof BrowserError) {
    reply.status(503).send({
      error: 'Browser Error',
      message: error.message,
      code: error.code
    })
  } else if (error instanceof AIClientError) {
    reply.status(error.statusCode || 500).send({
      error: 'AI Client Error',
      message: error.message
    })
  } else {
    reply.status(500).send({
      error: 'Internal Server Error',
      message: error.message
    })
  }
})
```

### 3. 失败样本收集

**文件**: `proxy-adapter/src/services/failure-sample-collector.ts`

```typescript
async collect(params: {
  sessionId: string
  snapshotId: string
  screenshot: string
  dom: string
  error: string
}): Promise<void> {
  const timestamp = new Date().toISOString()
  const dir = `.sisyphus/failures/${timestamp}`
  
  // 保存截图
  writeFileSync(`${dir}/screenshot.png`, params.screenshot, 'base64')
  
  // 保存 DOM
  writeFileSync(`${dir}/dom.json`, params.dom)
  
  // 保存元数据
  writeFileSync(`${dir}/metadata.json`, JSON.stringify({
    sessionId: params.sessionId,
    error: params.error,
    timestamp
  }))
}
```

---

## 📈 性能优化

### 1. 异步日志写入

**文件**: `proxy-adapter/src/services/interaction-logger.ts`

```typescript
class InteractionLogger {
  private queue: QueuedInteraction[] = []
  private flushInterval: NodeJS.Timeout | null = null
  private readonly BATCH_SIZE = 100
  private readonly FLUSH_INTERVAL_MS = 5000
  
  async log(params: CreateInteractionParams): Promise<void> {
    // 入队 (非阻塞)
    this.queue.push({ params, timestamp: Date.now() })
    
    // 如果队列满，立即刷新
    if (this.queue.length >= this.MAX_BUFFER_SIZE) {
      await this.flush()
    }
  }
  
  private async flush(): Promise<void> {
    if (this.isFlushing) return
    this.isFlushing = true
    
    // 批量写入
    const batch = this.queue.splice(0, this.BATCH_SIZE)
    await this.dbManager.batchInsertInteractions(batch)
    
    this.isFlushing = false
  }
}
```

### 2. DOM 缓存

**文件**: `playwright-server/src/services/snapshot-cache.ts`

```typescript
class SnapshotCache {
  private cache: Map<string, CachedSnapshot> = new Map()
  private readonly MAX_SIZE = 100
  
  set(snapshotId: string, data: DOMSnapshotResponse): void {
    if (this.cache.size >= this.MAX_SIZE) {
      // LRU 淘汰
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(snapshotId, {
      ...data,
      cachedAt: Date.now()
    })
  }
  
  get(snapshotId: string): DOMSnapshotResponse | null {
    return this.cache.get(snapshotId) || null
  }
}
```

### 3. 点击重试指数退避

```typescript
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    await browserManager.click(x, y)
    return { success: true, attempts: attempt }
  } catch (error) {
    if (attempt < 3) {
      await sleep(attempt * 1000) // 1s, 2s
    }
  }
}
```

---

## 🔧 配置管理

**文件**: `proxy-adapter/src/config/`

```typescript
interface ResolvedConfig {
  defaults: {
    mode: 'unified' | 'separation'
    decision: { provider: string, model: string }
    vision: { provider: string, model: string }
    maxSteps: number
  }
  providers: {
    kimi: { apiKey: string, models: { ... } }
    glm: { apiKey: string, models: { ... } }
    openai: { apiKey: string, models: { ... } }
    // ...
  }
  settings: {
    timeout: number
    retryAttempts: number
    debugMode: boolean
  }
}
```

**加载顺序**:
1. `.env` 文件 (环境变量)
2. `config/config.json` (AI provider 配置)
3. 运行时验证和合并

---

## 🎯 总结

Nebula-Link Evo 通过双服务架构实现了 AI 驱动的浏览器自动化：

1. **Proxy Adapter (3000)**: AI 编排层，负责任务解析、AI 决策、交互记录
2. **Playwright Server (3001)**: 浏览器控制层，负责实际的浏览器操作

**核心流程**:
- 接收任务 → 打开浏览器 → 导航 → AI 循环 (截图→分析→决策→执行) → 完成

**关键特性**:
- 视觉标记系统 (snapshot_id + nebula_id)
- 多策略 locator 回退 (6 种策略)
- 异步交互日志 (非阻塞)
- MCP 工具调用集成
- WebSocket 实时更新
- 失败样本收集

**性能优化**:
- 队列批处理 (日志写入)
- DOM 缓存 (LRU)
- 指数退避重试
- 单例模式 (BrowserManager)

这个架构允许通过 AI 自然语言指令驱动复杂的网页自动化任务，同时保持高可靠性和可调试性。
