# AI E2E

`ai-e2e` 是 PRD 驱动的 semantic E2E 业务编排服务。它负责项目、业务版本、结构化测试资产、Authoring、正式 Run、证据闭环和浏览器中心工作台；AI Agent/Vision 由 `ai-chat-service` 提供，浏览器执行由 `proxy-adapter` 提供。

## 产品工作流

```text
PRD + 目标 URL
  → 创建项目、部署修订、业务版本和待验证资产图
  → bootstrap / recheck / repair Authoring
  → 结构化候选、影响审批和安全边界排队
  → 真实浏览器验证并原子激活 revision
  → 冻结 Run 计划、TODO、变量和副作用授权
  → 页面任务经 Agent task 与 browser operation 可视执行
  → snapshot-first 事件、证据、恢复和结果汇总
```

## 服务边界

- `ai-e2e` 持有 PRD、页面、模块、功能脚本、场景、业务版本、Authoring 和 Run 的业务真相。
- `AgentTaskClient` 只消费 `ai-chat-service /api/v1/agent-tasks`、Vision v2 和逐 effect 授权控制面。
- `SemanticBrowserClient` 只消费 `proxy-adapter /api/v1/browser-execution/*`；Playwright/CDP 归 `proxy-adapter` 独占。
- 权威脚本是结构化 semantic 功能脚本，场景使用 DAG 编排跨模块或跨页面调用。
- Authoring 与 Run 共享单浏览器 FIFO；只有活动执行者持有控制，工作台实时画面只读。

## 已交付功能

- 原子项目初始化及幂等重放。
- 不可变部署修订、业务版本、资产 revision 和版本 copy。
- `bootstrap`、`recheck`、`repair` Authoring 与结构化 amendment。
- 同页/跨 URL 影响决策、stale 防护、安全边界排队、浏览器验证和原子激活。
- 正式 Run、TODO/DAG、页面 task/attempt、暂停/恢复/取消、依赖跳过和结果未知决策。
- local/test/staging/production 副作用策略与逐 `stepId/effectId` 授权。
- outbox、稳定幂等键、重启收敛、snapshot-first SSE 和证据提升。
- 浏览器中心三栏工作台、PRD/模块/场景联动预览、显式浏览器定位、Diff/审批/证据和作用域 Chat。
- 三栏调宽、布局持久化、浏览器缩放/收起/专注、明暗主题及 reduced-motion。

## 快速开始

前置条件：Node.js `^22.19.0 || >=24.0.0`、pnpm、运行于 `127.0.0.1:3000` 的 `proxy-adapter` 和运行于 `127.0.0.1:3001` 的 `ai-chat-service`。

```powershell
cd ai-e2e
pnpm install
pnpm dev
```

- API：`http://127.0.0.1:3002/api/v1`
- UI：`http://127.0.0.1:3002/ai-e2e/`
- 当前控制面仅支持 loopback 单用户部署。

### 环境变量

```dotenv
PROXY_ADAPTER_URL=http://localhost:3000
AI_CHAT_SERVICE_URL=http://localhost:3001
AI_E2E_PORT=3002
AI_E2E_DB_PATH=./data/ai-e2e-semantic.sqlite
AI_E2E_COORDINATOR_ENABLED=true
AI_E2E_COORDINATOR_INTERVAL_MS=500
AI_E2E_SECRET_STORE_PATH=./data/semantic-secrets
AI_E2E_EVIDENCE_PATH=./data/semantic-evidence
```

### 常用命令

```powershell
pnpm dev
pnpm type-check
pnpm test
pnpm build
pnpm lint
```

UI 严格类型检查使用：

```powershell
cd ui
pnpm exec tsc -p tsconfig.app.json --noEmit
```

## API 与 UI

所有业务 API 均位于 `/api/v1`：

- `/projects`、`/projects/:projectId`
- `/projects/:projectId/business-versions`、`/business-versions/:versionId/*`
- `/business-versions/:versionId/authoring-jobs`
- `/authoring-jobs/:jobId/*`、`/authoring-amendments/:amendmentId/*`
- `/projects/:projectId/runs`、`/runs/:runId/*`
- `/capabilities`

写请求按接口要求携带 `Idempotency-Key`；状态命令同时携带 `If-Match`。

UI 路由：

- `/`
- `/semantic/:projectId`
- `/semantic/:projectId/authoring/:versionId`
- `/semantic/:projectId/runs/:runId`

## 目录

```text
ai-e2e/
├── src/
│   ├── server/          Fastify、canonical v1 路由与静态 UI
│   ├── services/        Project、Version、Authoring、Run 与 Coordinator
│   ├── infrastructure/  Agent task、浏览器、证据与本地 secret 客户端
│   └── database/        semantic SQLite schema、migration 与 repository
├── ui/src/
│   ├── features/project/
│   └── features/semantic/
└── docs/                semantic 资产、编排、API、授权与证据契约
```

## 规格与技术债

- 产品状态与验收：[`PRODUCT-SPEC.md`](PRODUCT-SPEC.md)
- 跨服务 API 与事件：[`docs/service-api-event-contract.md`](docs/service-api-event-contract.md)
- Authoring 与 repair：[`docs/asset-authoring-repair-contract.md`](docs/asset-authoring-repair-contract.md)
- Run、决策与证据：[`docs/run-state-decision-evidence-contract.md`](docs/run-state-decision-evidence-contract.md)
- 环境与副作用：[`docs/environment-side-effect-policy-contract.md`](docs/environment-side-effect-policy-contract.md)

当前技术债以 `PRODUCT-SPEC.md` 第 6 节为准。
