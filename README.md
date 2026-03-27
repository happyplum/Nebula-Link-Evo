# Nebula-Link Evo - Phase 1

Phase 1: 基础设施与"手眼"打通

## 架构

```
[Browser]
    │
    ├──→ [Debug UI :5173 (dev)]
    │         │
    │         └──→ [Proxy Adapter :3000] ──→ [AI Provider APIs]
    │                               │
    │                               └──→ [Playwright Server :3001] ──→ Chromium
    │
    └──→ [Proxy Adapter :3000/debug/ (prod)]
```

## 技术栈

| 组件 | 技术 | 端口 |
|------|------|------|
| Debug UI | Vite + TypeScript + DOM APIs | 5173（开发） |
| Proxy Adapter | Node.js + Fastify + AI APIs | 3000 |
| Playwright Server | Node.js + Fastify + Playwright | 3001 |
| Shared | TypeScript workspace package | - |

## 快速开始

### 环境要求

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 22.5.0 | 满足 `proxy-adapter` 的运行要求 |
| pnpm | >= 8.0.0 | Node 包管理器 |
| Git | 任意版本 | 版本控制（可选） |

### 前置条件检查

```powershell
# 检查环境
node --version     # 应显示 v22.5.x 或更高
pnpm --version     # 应显示 8.x 或更高
```

### 1. 安装依赖

```powershell
cd D:\Work\Nebula-Link Evo
pnpm install
```

### 2. 安装 Playwright 浏览器

```powershell
cd playwright-server
pnpm exec playwright install chromium
```

### 3. 配置环境变量

**方式一: 使用 .env 文件（推荐）**

```powershell
# 复制示例文件
copy .env.example .env

# 编辑配置文件
notepad .env
```

编辑 `.env` 文件：
```env
# AI Provider API 配置
KIMI_API_KEY=your_kimi_api_key_here
KIMI_BASE_URL=https://api.moonshot.cn/v1
KIMI_MODEL=moonshot-v1-vision-preview

# 端口配置
PLAYWRIGHT_PORT=3001
PROXY_PORT=3000

# 浏览器配置
BROWSER_HEADLESS=false
BROWSER_VIEWPORT_WIDTH=1920
BROWSER_VIEWPORT_HEIGHT=1080
```

**方式二: 使用环境变量**

```powershell
# Windows PowerShell
$env:KIMI_API_KEY = "your_kimi_api_key_here"

# Windows CMD
set KIMI_API_KEY=your_kimi_api_key_here

# 永久设置（PowerShell）
[Environment]::SetEnvironmentVariable("KIMI_API_KEY", "your_api_key", "User")
```

### 4. 启动服务

**注意**: Debug UI 现在是根目录下的独立包 `debug-ui/`。开发模式由 Vite 直接提供页面，生产模式由 `proxy-adapter` 托管 `debug-ui/dist`。

#### 方式一: 使用启动脚本（推荐）

**CMD/Batch**（已包含自动构建）
```cmd
start.bat
```

启动脚本会自动执行以下步骤：
1. 构建 `shared`
2. 构建 `debug-ui`、`playwright-server`、`proxy-adapter`
3. 启动 Playwright Server (3001)
4. 启动 Proxy Adapter (3000)，并从 `debug-ui/dist` 提供 `/debug/`

#### 方式二: 使用 workspace 命令

**开发模式（推荐）**
```powershell
cd D:\Work\Nebula-Link Evo
pnpm dev
```

这会先构建 `shared`，再并行启动：
- `debug-ui` dev server (`http://localhost:5173/debug/`)
- `proxy-adapter` (`http://localhost:3000`)
- `playwright-server` (`http://localhost:3001`)

**生产构建**
```powershell
cd D:\Work\Nebula-Link Evo
pnpm build
```

#### 方式三: 开发脚本（带热更新）

```cmd
start-dev.bat
```

该脚本会分别启动：
- `debug-ui` 开发服务器（5173）
- `proxy-adapter`（3000）
- `playwright-server`（3001）

### Debug UI 开发说明

项目包含一个 Debug UI 界面，用于调试和监控服务状态。

| 模式 | 命令 | 说明 |
|------|------|------|
| 生产模式 | `start.bat` 或 `pnpm build` 后启动后端 | `proxy-adapter` 从 `debug-ui/dist` 提供 `/debug/` |
| 开发模式 | `start-dev.bat` 或 `pnpm dev` | `debug-ui` 使用独立 Vite dev server，支持热更新（HMR） |

**注意**:
- 前端源码位于根目录 `debug-ui/`
- 生产资源位于 `debug-ui/dist/`
- `proxy-adapter` 不再拥有前端源码或 `vite.config.ts`

### Proxy Configuration (Development Mode)

**Architecture**: Development mode uses the standalone `debug-ui` Vite server on port 5173. It proxies API and WebSocket traffic to Fastify on port 3000 while keeping `/debug/` page rendering local for HMR.

```
Browser ←→ Debug UI Vite (5173) ←→ Fastify (3000) ←→ Playwright (3001)
                    ↑                  ↑
                (proxies /api,     (compat proxy for
                 /ws, /debug/api)   /debug/* in dev)
```

**Proxy Configuration** (`debug-ui/vite.config.ts`):
```typescript
proxy: {
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true,
  },
  '/ws': {
    target: 'ws://localhost:3000',
    ws: true,
  },
  '/debug/api': {
    target: 'http://localhost:3000',
    changeOrigin: true,
  },
}
```

**Loop Prevention**: The configuration prevents proxy loops through:
1. **Vite side**: Only proxies `/api`, `/ws`, and `/debug/api` to Fastify (NOT `/debug/*`)
2. **Fastify side**: Dev compatibility proxy skips `/debug/api/*` and `/debug/ws` routes
3. **Static assets**: Served directly by Vite in dev mode, by Fastify from `debug-ui/dist` in production

**Troubleshooting**:

| Issue | Symptom | Solution |
|-------|---------|----------|
| Proxy loop | HTTP 500 error on `/debug/*` | Check that `debug-ui/vite.config.ts` does not proxy `/debug` |
| WebSocket fails | Connection refused | Verify `/ws` proxy in `debug-ui/vite.config.ts` uses `ws: true` |
| API not reachable | 404 on `/api/*` | Ensure Fastify is running on port 3000 |
| Port conflict | `EADDRINUSE` error | Run `stop.bat` to kill existing services |

**Development vs Production**:

| Aspect | Development Mode | Production Mode |
|--------|-----------------|-----------------|
| Entry point | `http://localhost:5173/debug/` | `http://localhost:3000/debug/` |
| UI serving | Vite dev server | Fastify static files |
| HMR | ✅ Enabled | ❌ Disabled |
| Proxy required | ✅ Yes | ❌ No |
| Start command | `start-dev.bat` | `start.bat` |

### 5. 验证安装

```powershell
# 测试所有服务健康状态
Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get
Invoke-RestMethod -Uri "http://localhost:3001/health" -Method Get
```

预期输出：
```json
{"status":"healthy","services":{"playwright":"http://localhost:3001"}}
{"status":"healthy","browserOpen":false}
```

## 快速测试

### 方式一：一键测试脚本（推荐）

运行测试脚本，通过交互菜单选择测试项目：

```powershell
.\test-api.ps1
```

菜单选项：
- [1] 健康检查（所有服务）
- [2] 基础任务测试
- [3] Playwright API 测试
- [4] 配置查询
- [5] 全部测试

### 方式二：单行命令快速验证

**健康检查**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get
Invoke-RestMethod -Uri "http://localhost:3001/health" -Method Get
```

**执行简单任务**
```powershell
$headers = @{"Content-Type" = "application/json"}
$body = @{
    url = "https://www.baidu.com"
    instruction = "搜索关键词"
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/task" -Method Post -Headers $headers -Body $body
```

**查看当前配置**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/config" -Method Get
```

## 使用方法

### 基本用法

**执行自动化任务**

```powershell
$headers = @{"Content-Type" = "application/json"}
$body = @{
    url = "https://www.example.com"
    instruction = "点击登录按钮"
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/task" -Method Post -Headers $headers -Body $body
```

### 高级用法

**指定最大步骤数**
```powershell
$headers = @{"Content-Type" = "application/json"}
$body = @{
    url = "https://www.example.com"
    instruction = "填写表单并提交"
    context = @{
        maxSteps = 20
    }
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/task" -Method Post -Headers $headers -Body $body
```

**直接使用 Playwright API**
```powershell
# 打开浏览器
$body = @{
    headless = $false
    viewport = @{
        width = 1920
        height = 1080
    }
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/browser/open" -Method Post -Headers @{"Content-Type"="application/json"} -Body $body

# 导航到页面
$body = @{url = "https://www.example.com"} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/browser/navigate" -Method Post -Headers @{"Content-Type"="application/json"} -Body $body

# 截图
$body = @{fullPage = $false} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/browser/screenshot" -Method Post -Headers @{"Content-Type"="application/json"} -Body $body

# 点击坐标
$body = @{
    x = 500
    y = 300
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/action/click" -Method Post -Headers @{"Content-Type"="application/json"} -Body $body

# 输入文本
$body = @{
    selector = "#search-input"
    text = "Hello World"
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/action/type" -Method Post -Headers @{"Content-Type"="application/json"} -Body $body

# 获取页面 DOM
Invoke-RestMethod -Uri "http://localhost:3001/dom/simplified" -Method Get

# 关闭浏览器
Invoke-RestMethod -Uri "http://localhost:3001/browser/close" -Method Post
```

## 故障排除

### 快速诊断

```powershell
# 检查端口占用
netstat -ano | findstr :3000
netstat -ano | findstr :3001

# 检查进程状态
tasklist | findstr node
```

### 常见问题

#### Q1: 端口被占用

**错误**: `EADDRINUSE: address already in use`

**解决**:
```powershell
# 查找占用端口的进程
netstat -ano | findstr :3000

# 终止进程（替换 PID）
taskkill /PID <PID> /F

# 或修改端口配置
# 编辑对应服务的 .env 文件
PROXY_PORT=3003
```

#### Q2: Playwright 浏览器未安装

**错误**: `Executable doesn't exist at ...`

**解决**:
```powershell
cd playwright-server
pnpm exec playwright install chromium
```

#### Q3: Kimi API 调用失败

**错误**: `KIMI_API_KEY is not set` 或认证错误

**解决**:
```powershell
# 检查环境变量
$env:KIMI_API_KEY

# 重新设置（临时，仅当前会话）
$env:KIMI_API_KEY = "your_api_key"

# 验证 API Key 有效性
$headers = @{"Authorization" = "Bearer $env:KIMI_API_KEY"}
Invoke-RestMethod -Uri "https://api.moonshot.cn/v1/models" -Method Get -Headers $headers
```

#### Q4: 浏览器无法启动

**可能原因**: 权限问题、端口冲突、防病毒软件阻止

**解决**:
```powershell
# 以管理员身份运行终端
# 或使用 headless 模式
$body = @{headless = $true} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/browser/open" -Method Post -Headers @{"Content-Type"="application/json"} -Body $body

# 临时关闭防病毒软件
```

#### Q5: 截图返回空或截图为黑屏

**可能原因**: 页面未完全加载、浏览器未就绪

**解决**:
```powershell
# 增加等待时间
$body = @{
    url = "https://example.com"
    waitUntil = "networkidle"
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/browser/navigate" -Method Post -Headers @{"Content-Type"="application/json"} -Body $body

# 等待页面加载
# 在任务执行器中添加额外等待
```

#### Q6: 点击坐标不准确

**可能原因**: 页面缩放、视口差异

**解决**:
```powershell
# 使用固定视口大小
$body = @{
    viewport = @{
        width = 1920
        height = 1080
    }
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/browser/open" -Method Post -Headers @{"Content-Type"="application/json"} -Body $body

# 检查页面缩放
# 在 Chrome 中按 Ctrl+0 重置缩放
```

### 日志级别

如需更详细的日志输出，可设置环境变量：

```powershell
# Playwright 和 Proxy (Fastify)
$env.DEBUG = "*"
# 或
set DEBUG=*
```

### 性能优化

```powershell
# 减少截图分辨率
$body = @{fullPage = $false} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/browser/screenshot" -Method Post -Headers @{"Content-Type"="application/json"} -Body $body

# 使用 headless 模式提高速度

# 限制 DOM 元素数量
# 在 browser.ts 中调整 DOMElement 限制
```

### 获取帮助

如遇到未列出的问题：

1. 检查各服务终端的错误输出
2. 验证网络连接和 API Key
3. 重启所有服务
4. 查看 GitHub Issues

## 项目结构

```
nebula-link-evo/
├── playwright-server/          # Playwright HTTP 服务
│   ├── src/
│   │   ├── server.ts           # Fastify 服务入口
│   │   ├── browser.ts          # 浏览器管理
│   │   ├── routes.ts           # API 路由
│   │   └── types.ts            # 类型定义
│   ├── package.json
│   └── tsconfig.json
│
├── proxy-adapter/              # AI API 适配器
│   ├── src/
│   │   ├── server.ts           # Fastify 服务入口
│   │   ├── kimi-client.ts      # Kimi API 客户端
│   │   ├── browser-client.ts   # Playwright 客户端
│   │   ├── task-executor.ts    # 任务执行器
│   │   └── types.ts            # 类型定义
│   ├── package.json
│   └── tsconfig.json
│
├── shared/                     # 共享资源
│   └── types/                  # 共享类型定义
│
├── start-services.ps1          # PowerShell 启动脚本
├── run.bat                     # CMD 启动脚本
├── quick-start.bat             # 带环境检测的启动脚本
├── test-e2e.bat                # 端到端测试脚本
├── .env.example                # 环境变量示例
└── README.md                   # 本文档
```

## 启动脚本

项目提供了多个启动脚本，适应不同场景：

### 启动脚本对比

| 脚本 | 类型 | 功能 | 使用场景 |
|------|------|------|----------|
| `start-services.ps1` | PowerShell | 完整启动，自动检测 | 推荐 PowerShell 用户 |
| `run.bat` | CMD | 简化启动 | 推荐 CMD 用户 |
| `quick-start.bat` | CMD | 带环境检测 | 首次启动时使用 |
| `test-e2e.bat` | CMD | 端到端测试 | 验证安装是否正确 |

### 详细说明

#### start-services.ps1（推荐）

PowerShell 启动脚本，自动启动 2 个服务并提供状态监控。

```powershell
.\start-services.ps1
```

功能：
- 自动启动 Playwright Server (3001)
- 自动启动 Proxy Adapter (3000)
- 显示服务状态
- 按 Enter 停止所有服务

#### run.bat

简化版 CMD 启动脚本。

```cmd
run.bat
```

功能：
- 快速启动 2 个服务
- 显示启动状态

#### quick-start.bat

带环境检测的启动脚本。

```cmd
quick-start.bat
```

功能：
- 检测 pnpm/Node.js
- 检测 KIMI_API_KEY
- 可选输入 API Key
- 验证环境后启动服务

#### test-e2e.bat

端到端测试脚本。

```cmd
test-e2e.bat
```

功能：
- 健康检查
- 导航测试页面
- 截图测试

### 自定义启动

如需自定义启动参数，可直接运行命令：

```powershell
# Playwright - 启用热重载
pnpm dev -- --port 3001

# Proxy - 生产模式
pnpm start -- --port 3000
```

### 环境变量配置

在启动前设置环境变量：

```powershell
# PowerShell
$env:KIMI_API_KEY = "your_key"
$env:BROWSER_HEADLESS = "true"

# CMD
set KIMI_API_KEY=your_key
set BROWSER_HEADLESS=true
```

或创建 `.env` 文件：

```env
KIMI_API_KEY=your_kimi_api_key_here
KIMI_BASE_URL=https://api.moonshot.cn/v1
KIMI_MODEL=moonshot-v1-vision-preview
PLAYWRIGHT_PORT=3001
PROXY_PORT=3000
BROWSER_HEADLESS=false
```

## API 文档

### Proxy Adapter (:3000)

主服务入口，处理自动化任务编排。

#### 健康检查

**GET /api/health**

返回所有服务的健康状态。

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get
```

响应：
```json
{
  "status": "healthy",
  "services": {
    "playwright": "http://localhost:3001"
  }
}
```

#### 执行任务

**POST /task**

执行网页自动化任务。

请求参数：
```json
{
  "url": "https://example.com",
  "instruction": "点击登录按钮",
  "context": {
    "previousActions": [],
    "maxSteps": 10
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | 目标网页 URL |
| instruction | string | 是 | 任务指令 |
| context.maxSteps | number | 否 | 最大执行步骤，默认 10 |

响应：
```json
{
  "success": true,
  "url": "https://example.com",
  "actions": [
    {
      "action": {
        "type": "click",
        "params": {"x": 500, "y": 300},
        "reasoning": "点击登录按钮"
      },
      "success": true,
      "message": "Clicked at (500, 300)"
    }
  ],
  "result": "Task completed"
}
```

### Playwright Server (:3001)

浏览器控制服务。

#### 浏览器管理

**POST /browser/open**

打开浏览器实例。

请求：
```json
{
  "headless": false,
  "viewport": {
    "width": 1920,
    "height": 1080
  }
}
```

响应：
```json
{
  "success": true,
  "message": "Browser opened successfully"
}
```

**POST /browser/navigate**

导航到指定 URL。

请求：
```json
{
  "url": "https://example.com",
  "waitUntil": "networkidle",
  "timeout": 30000
}
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| url | string | 是 | 目标 URL |
| waitUntil | string | networkidle | 加载策略 |
| timeout | number | 30000 | 超时时间(ms) |

**POST /browser/screenshot**

截取页面截图。

请求：
```json
{
  "fullPage": false,
  "type": "png"
}
```

响应：
```json
{
  "success": true,
  "screenshot": "base64_encoded_image",
  "viewport": {
    "width": 1920,
    "height": 1080
  }
}
```

**POST /browser/close**

关闭浏览器。

**GET /browser/status**

获取浏览器状态。

响应：
```json
{
  "isOpen": true,
  "currentUrl": "https://example.com",
  "title": "Example Domain"
}
```

#### 页面操作

**POST /action/click**

点击指定坐标。

请求：
```json
{
  "x": 500,
  "y": 300
}
```

**POST /action/click-by-selector**

点击指定元素。

请求：
```json
{
  "selector": "#submit-button",
  "options": {
    "button": "left",
    "clickCount": 1,
    "delay": 100
  }
}
```

**POST /action/type**

输入文本。

请求：
```json
{
  "selector": "#search-input",
  "text": "Hello World",
  "options": {
    "delay": 50,
    "clear": true
  }
}
```

**POST /action/scroll**

滚动页面。

请求：
```json
{
  "x": 0,
  "y": 500
}
```

#### DOM 操作

**GET /dom/simplified**

获取页面简化 DOM 树。

响应：
```json
{
  "success": true,
  "url": "https://example.com",
  "title": "Example Domain",
  "elements": [
    {
      "tag": "button",
      "id": "submit",
      "class": "btn btn-primary",
      "text": "Submit",
      "bbox": {
        "x": 100,
        "y": 200,
        "width": 120,
        "height": 40
      },
      "isVisible": true,
      "isInteractable": true
    }
  ],
  "viewport": {
    "width": 1920,
    "height": 1080
  }
}
```

#### 健康检查

**GET /health**

```powershell
Invoke-RestMethod -Uri "http://localhost:3001/health" -Method Get
```

响应：
```json
{
  "status": "healthy",
  "browserOpen": true
}
```
### Streaming API Endpoints

#### POST /api/chat/stream

Stream responses from AI models using Vercel AI SDK v6.

**Request Body**:
```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

**Response**:
- Content-Type: `text/event-stream`
- Cache-Control: `no-cache`
- Connection: `keep-alive`

**Response Format** (SSE):
```
data: {"type":"text-delta","delta":"Hello"}
data: {"type":"text-delta","delta":" there"}
data: {"type":"done"}
```

**WebSocket Events**:
- Events are broadcast to connected debug clients
- Includes taskId, timestamp, and event data



## 工作流程

### 完整执行流程

```
用户请求
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Proxy Adapter 接收任务                                    │
│    - url: 目标网页                                           │
│    - instruction: 用户指令                                   │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Playwright Server                                        │
│    - 打开浏览器实例（如果未打开）                              │
│    - 导航到目标 URL                                          │
│    - 等待页面加载完成                                         │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. 截图 & 获取 DOM                                           │
│    - 截取当前页面截图                                        │
│    - 获取视口尺寸                                            │
│    - 获取可交互元素列表                                       │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Proxy Adapter 组装 Prompt                                │
│    - 截图 (base64)                                          │
│    - DOM 树信息                                              │
│    - 用户指令                                                │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. AI Provider API 调用                                     │
│    - 发送多模态 Prompt                                       │
│    - 接收结构化响应                                          │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. 解析 AI 响应                                              │
│    - 提取操作类型 (click/type/scroll/finish)                 │
│    - 提取操作参数                                            │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. 执行操作                                                  │
│    - click: 调用 Playwright 点击坐标                         │
│    - type: 调用 Playwright 输入文本                          │
│    - scroll: 调用 Playwright 滚动页面                        │
│    - finish: 任务完成                                        │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
              ┌────────┴────────┐
              │                 │
            继续              完成
              │                 │
              ▼                 ▼
        返回步骤 3          返回结果
```

### 循环执行

任务会循环执行以下步骤，直到任务完成或达到最大步骤数：

1. 截图
2. 获取 DOM
3. AI 分析
4. 执行操作

默认最大步骤数为 10，可在请求中自定义：

```json
{
  "url": "https://example.com",
  "instruction": "完成注册流程",
  "context": {
    "maxSteps": 20
  }
}
```

## Phase 1 验收标准

- [x] Playwright Server 能接收 HTTP 指令控制浏览器
- [x] Proxy Adapter 能对接 AI Provider APIs
- [x] 端到端流程能正常工作

## 下一步 (Phase 2)

- 优化 Prompt 工程
- 添加更多浏览器操作 (拖拽、右键等)
- 实现任务规划和多步骤推理
