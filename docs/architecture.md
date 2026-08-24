# Nebula-Link Evo — 架构文档

> Generated: 2026-03-28 | Updated: 2026-08-12 | Source: proxy-adapter, ai-chat-service, debug-ui, ai-e2e, shared

## 系统架构

```
Browser ←→ Debug UI (:5173 dev)
              ↕ SSE (Chat)        ↕ REST (Browser/Config)
         AI Chat Service       Proxy Adapter
            (:3001)                (:3000)
              ↕ MCP Client ──────→  ↕ MCP Server (StreamableHTTP)
              ↕ HTTP                    ↕ Playwright (in-process)
         AI Providers                Chromium
    (GLM, OpenAI, Anthropic, Kimi, NVIDIA)

         AI E2E (:3002) — 自动化测试编排
    AiE2eRuntimeClient(:3001) + BrowserGatewayClient(:3000)
```

### 核心产品分层

- **浏览器能力层（proxy-adapter，shipped）**：Playwright/CDP 集成的唯一所有者；负责页面分析、DOM/截图证据和动作执行，只通过 `browser-control.operation_execute/get/cancel`、browser-execution HTTP 控制面及受仲裁调试面服务。
- **AI 基础能力层（ai-chat-service，in-progress）**：唯一 AI 驱动核心；统一 DSH Agent Loop、分析/决策模型、不可变快照 Vision、MCP/ToolRuntime、Chat/Agent task、逐 effect 授权、持久化、声明式 Skills 与部署锁定插件已交付；生产恢复演练仍 pending。
- **E2E 业务层（ai-e2e，in-progress）**：现有 PRD 分析、页面探索、URL binding、scenario 级 TypeScript 脚本和 run 级修复；目标是业务版本、URL+参数页面锚点、模块下多个功能脚本、跨模块场景调用图，以及主代理派发页面子代理的编排。

目标主代理是 `ai-e2e` 内由 authoring/run 状态机驱动的持久工作流协调器，不依赖一个长期模型会话。首次 PRD + URL 依次完成需求抽取、页面发现/建模、模块需求、脚本/场景 candidate、静态校验、真实浏览器验证和原子激活；后续 recheck/repair 通过 revision dependency index 只重验和修复受影响闭包。

目标上下文边界以页面场景片段为单位：主代理维护 PRD 流程、TODO 依赖、运行变量和决策并持有浏览器生命周期；子代理只执行不可变任务包授权的模块、功能脚本、Tab 与工具。默认使用干净子代理上下文，可恢复中断在重新检查页面状态和副作用后可由主代理决定续接。首期每个 `proxy-adapter` 进程全局最多一个活动 browser execution session，authoring verification 与 test run 共用一个 FIFO；只有当前子代理持有 control，主代理只在原子操作安全边界 observe，UI live view 只读。后期再以明确版本化的多 Context/Tab capability 扩展并发。所有目标浏览器操作按语义步骤经 `proxy-adapter` 可视执行，使用可去重、可查询的原子操作身份，并关联实时画面与结果证据；结果不确定时先检查副作用。

目标运行状态按测试流程、TODO、执行尝试、Agent 与浏览器操作分层；`ai-e2e` 以持久 snapshot、单调运行事件和不可变证据 manifest 作为业务真相。`proxy-adapter` 只保留可提升的短期浏览器原始产物，`ai-chat-service` 只保留 Agent/工具审计；运行决策、失败传播、长期证据和汇总仍归 `ai-e2e`。

跨服务链使用 `ai-e2e /api/v1/runs` → `ai-chat-service /api/v1/agent-tasks` → `proxy-adapter /mcp` 与 `/api/v1/browser-execution/*`。所有外部写操作使用幂等键，`ai-e2e` 以 outbox 驱动并查询外部账本收敛；Run、Agent task、Browser session 各自使用 snapshot-first SSE 和独立单调序号。核心服务只提供 canonical v1 HTTP 路径和三个 operation MCP 工具，不保留旧路径、旧工具或静默回退。

目标迁移不原地改写旧执行资产：001–013 先结构校验并纳入正式 migration 账本，旧 TypeScript/login/run 只读保留，导入生成待复核业务版本/候选。新链按 business version opt-in，run 固定 `semantic_v1`，不与 legacy 子进程混合；三服务先通过 `/api/v1/capabilities` preflight。

首期新控制面只支持 loopback/local 单用户部署。capability、Origin 与 lease 不代替认证；远程或多用户拓扑必须先增加统一身份、授权和租户隔离，再开放 semantic authoring/run。

### 端口映射

| 服务            | 端口     | 职责                                                              |
| --------------- | -------- | ----------------------------------------------------------------- |
| proxy-adapter   | 3000     | 浏览器能力网关（内进程 Playwright + 3 个受控 operation 工具）     |
| ai-chat-service | 3001     | 唯一 AI 驱动核心（统一 Harness、Chat/Task、Vision、工具与持久化） |
| debug-ui (dev)  | 5173     | 前端开发服务器                                                    |
| debug-ui (prod) | 独立部署 | 独立构建，不通过 proxy-adapter 托管                               |
| ai-e2e          | 3002     | AI E2E 自动化测试编排                                             |

## 开发模式 vs 生产模式

### 开发模式

```
Browser (http://localhost:5173 /debug)
     │ chat/AI: /api/v1/chat, /api/v1/ai, /api/v1/test-ai → ai-chat-service (:3001)
     │ browser/debug: /api/v1/browser-execution, /debug → proxy-adapter (:3000)
```

debug-ui 通过 Vite dev server (`:5173`) 独立运行，chat/AI 请求代理到 ai-chat-service (`:3001`)，browser/debug 请求代理到 proxy-adapter (`:3000`)。proxy-adapter 不再反向代理 `/debug*` 到 Vite。

### 生产模式

```
Browser → debug-ui (独立部署 / CDN)
     │ /api, /debug/api
     ▼
proxy-adapter (:3000)
     │
     ├─ /api/v1/{health,capabilities,livekit-token,browser-execution/*}
     ├─ /mcp → controlled operation tools
     └─ /debug/* → arbitrated debug routes
```

**proxy-adapter 行为:**

- 纯后端 API 服务，不托管前端静态文件
- `debug-ui/` 为独立前端包，通过 Vite dev server 或独立部署访问

## 请求代理链

### Vite 开发模式

```
Browser
    │ http://localhost:5173/debug (Vite dev server)
    │
    ├─ /api/* → proxy-adapter (:3000)
    ├─ /debug/api/* → proxy-adapter (:3000)
    └─ /debug/* (其他) → Vite 本地处理
```

### 生产模式

```
Browser
    │ http://localhost:5173/debug (debug-ui 独立部署/Vite dev server)
    │
     ├─ /api/* → proxy-adapter (:3000)
     └─ /debug/api/* → proxy-adapter (:3000)
```

### 服务间通信

```
debug-ui (:5173)
    │ SSE (Chat)        ↕ REST (Browser/Config)
    ▼
ai-chat-service (:3001)          proxy-adapter (:3000)
    │                                  │
    │ MCP Client ──────────────────→ MCP Server (StreamableHTTP)
    │ HTTP                                  │ Playwright (in-process)
    ▼                                       ▼
AI Providers                            Chromium
```

**设计原则:**

- ai-chat-service 通过 MCP-over-HTTP 从 proxy-adapter 获取浏览器控制能力；视觉分析由 ai-chat-service 内部 VisionAnalyzer 提供
- proxy-adapter 内进程运行 Playwright 引擎，不再依赖外部 playwright-server 进程
- debug-ui 分别连接两个服务：chat SSE → ai-chat-service (:3001)，browser/debug → proxy-adapter (:3000)
- ai-e2e 通过 AiChatClient(:3001) 和 BrowserGatewayClient(:3000) 消费

## 数据持久化

### SQLite (`conversations.sqlite` / `agent-tasks.sqlite`)

**存储内容:**

- 会话 (sessions)
- 消息 (messages)
- 事件流 (events)
- 受限 Agent task 的脱敏请求、状态、结构化结果、预算、工具摘要、命令/事件/checkpoint，以及 Skill registry/version/hash/pin（独立 `agent-tasks.sqlite`；不持久化 lease token 明文）

**使用场景:**

- 会话历史查询
- SSE 事件持久化（用于 `session.snapshot` 恢复 thinking / tool 历史；不提供 `Last-Event-ID` 断点重放）
- 失败会话恢复

### Filesystem

**存储内容:**

- 日志文件
- 失败截图
- 交互日志
- 内容寻址的浏览器截图与归一化 DOM artifact

**使用场景:**

- 调试信息持久化
- 失败分析样本

## 参考文档

- [AI Operation Flow](reference/ai-operation-flow.md) — AI 操作流程与执行模型
- [AI E2E UI Architecture](reference/ai-e2e-ui-architecture.md) — AI E2E UI 的 Atlas 视觉系统、路由、Tab 与 SSE 架构
- [AI E2E Version & Page Assets](../ai-e2e/docs/version-page-asset-contract.md) — 业务版本 copy、部署、页面锚点、URL 参数和页面基线契约
- [AI E2E Agent & Browser Execution](../ai-e2e/docs/agent-browser-execution-contract.md) — 页面任务包、Agent 作用域、浏览器控制租约、原子操作和可视事件契约
- [AI E2E Run State, Decision & Evidence](../ai-e2e/docs/run-state-decision-evidence-contract.md) — 分层状态、失败传播、决策、证据和人工控制契约
- [AI E2E Target Data Model](../ai-e2e/docs/target-data-model.md) — 业务版本、不可变资产修订、页面规范化、运行与证据关系模型
- [AI E2E Service API & Events](../ai-e2e/docs/service-api-event-contract.md) — 三服务目标 API、MCP 原子操作、事件、outbox 与恢复
- [AI Model & Skills Contract](../ai-e2e/docs/ai-model-skill-contract.md) — 双模型、单次视觉分析、Agent task 与声明式 Skills
- [AI E2E Migration & Acceptance](../ai-e2e/docs/migration-compatibility-acceptance-contract.md) — migration runner、旧资产导入、切流、回滚与发布门禁
- [Proxy Adapter Observability Design](reference/observability-design.md) — proxy-adapter 可观测性设计参考
- [Technical Debt Backlog](reference/technical-debt-backlog.md) — 已从大型清理计划提炼出的剩余维护项
- [Debug Page Integration API Reference](reference/debug-page-integration-api-reference.md) — 完整的 API 端点、SSE 事件参考
