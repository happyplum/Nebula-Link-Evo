# AI E2E

## Overview

`ai-e2e` 是一个 **AI 驱动的 E2E 自动化测试编排子包**。它自身不直连 AI provider，也不直连 Playwright，而是统一通过 `ProxyAdapterClient` 调用 `proxy-adapter` 暴露的 AI 与浏览器控制 HTTP API。

它的核心职责不是“浏览器自动化底座”，而是：

- 需求 / PRD 分析
- 站点探索与 URL 绑定
- Playwright 脚本生成与版本化
- 脚本执行
- 单次运行失败诊断与可选自动修复

## Commands

```bash
pnpm dev          # tsx watch src/server.ts
pnpm build        # tsc -b && cd ui && pnpm build
pnpm start        # node dist/server.js
pnpm test         # vitest run
pnpm type-check   # tsc --noEmit
```

## Entry Points

- Runtime entry: `src/server.ts`
- Bootstrap implementation: `src/server/index.ts`
- UI mount prefix: `/ai-e2e/`

## Architecture

```text
ai-e2e (:3002)
├── src/server.ts                     # 真实启动入口
├── src/server/index.ts               # createServer()/start()、DI、路由注册
├── ProxyAdapterClient                # 唯一外部能力入口
│   ├── POST /api/ai/generate
│   └── /debug/api/playwright/*
├── PromptTemplateManager             # prompts/*.md
├── TokenBudgetTracker                # token 预算统计
├── DatabaseManager                   # SQLite
├── Business Services                 # analysis/exploration/scripts/execution/diagnosis
└── React SPA                         # /ai-e2e/
```

## Startup Order

1. 加载 `.env.local` / 上级 `.env` / 当前 `.env`
2. 创建 `ProxyAdapterClient`
3. 创建 `PromptTemplateManager`
4. 创建 `TokenBudgetTracker`
5. 初始化 `DatabaseManager`
6. 创建 `LoginRecorderService`
7. `createServer({ proxyClient, promptManager, tokenTracker, loginRecorder })`
8. 注册路由、SSE、静态 UI、404 处理
9. `app.listen()`

## Runtime Facts

- 默认端口：`3002`
- 默认数据库路径：`./data/ai-e2e.sqlite`
- 当前 `start()` 读取的 env 名是：
  - `PROXY_ADAPTER_URL`
  - `AI_E2E_PORT`
  - `AI_E2E_DB_PATH`
- 启动成功后会打印：
  - `AI E2E server listening`
  - `UI: http://localhost:<port>/ai-e2e/`

## Where To Look

| Area | Path | Notes |
|---|---|---|
| Runtime entry | `src/server.ts` | 仅负责调用 `start()` |
| Bootstrap / DI | `src/server/index.ts` | 路由注册、静态 UI、SSE、env 读取 |
| HTTP client | `src/infrastructure/proxy-adapter-client.ts` | AI / Playwright API、契约适配、错误映射 |
| Services | `src/services/` | PRD 分析、探索、脚本、执行、诊断、状态机 |
| Routes | `src/server/routes/` | 通过 plugin options 注入依赖 |
| Prompts | `prompts/*.md` | 必须保留，属于稳定资产 |
| Database | `src/database/` | SQLite、migrations、repos |
| Frontend | `ui/src/` | SPA、流程页、AI 状态、执行面板 |

## Route Groups

- `/api/projects`
- `/api/projects/:id/config`
- `/api/projects/:id/analysis`
- `/api/projects/:id/exploration`
- `/api/projects/:id/scenarios`
- `/api/projects/:id/scripts`
- `/api/projects/:id/execution`
- `/api/projects/:id/diagnosis`
- `/api/projects/:id/state`
- `/api/projects/:id/events`

## Dependency Injection Rule

路由依赖统一通过 **plugin options** 注入，不通过 Fastify decorators 注入业务服务。

当前典型注入项：

- `proxyClient`
- `promptManager`
- `tokenTracker`
- `loginRecorder`
- `scenarioService`
- `diagnosisService`
- `stateMachine`

如果新增服务，优先遵循相同模式，不要混入另一套注入方式。

## Hard Boundaries

- **不直连 AI provider**：所有 AI 调用必须经 `ProxyAdapterClient.generateText()`
- **不直连 `playwright-server`**：所有浏览器操作必须经 `ProxyAdapterClient`
- **不引入 `@ai-sdk/*`**：ai-e2e 已被重构为零 AI SDK 依赖
- **不共享 proxy-adapter 数据库**：ai-e2e 维护自己的 SQLite
- **不在 proxy-adapter 中引入 ai-e2e 特有概念**

## Conventions

- 本地 TS import 保持 `.js` 后缀
- `ProxyAdapterClient` 是唯一外部基础设施访问点
- `PROXY_ADAPTER_URL` 为空时，DB-only 路由继续工作，AI / Playwright 路由返回 `503`
- `ServiceError.unavailable()` 用于服务缺失 / 降级场景
- UI 通过 `/ai-e2e/` 前缀挂载，404 处理要兼顾 SPA 与 JSON API

## Workflow Truths

- 项目状态机：`draft → configuring → analyzing → analyzed → exploring → explored → generating → ready → running → completed`
- 当前进入 `generating` 前检查每个功能模块至少绑定一个 URL，`ai_proposed` 状态计为已绑定
- 当前支持：
  - 模块编辑
  - URL 绑定建议与确认
  - 测试场景编辑（preconditions ↔ expected_results 数据映射）
  - 脚本编辑与版本历史
  - 单次运行失败诊断
  - 可选自动修复
  - 项目级诊断汇总报告（根因分布统计、JSON/HTML 导出）

## Anti-Patterns

- 不重新引入 `AIProvider` / `PlaywrightClient` 旧架构
- 不在 ai-e2e 内新增直连外部模型或浏览器服务的代码
- 不把历史迁移计划 `.sisyphus/plans/ai-e2e-redesign.md` 当成当前活文档
- 不在 README / AGENTS 中写没有代码支撑的能力
- 不把“单次 run 诊断”描述成“项目级报告系统”
- 不把“模块可编辑”偷换成“scenario 可编辑”

## Current Known Gaps

### 已解决（历史）

1. ~~项目级诊断报告未实现~~ — 已支持
2. ~~URL 绑定校验粒度不足~~ — 已强制每个功能模块绑定 URL
3. ~~Scenario 编辑能力不完整~~ — 已提供完整编辑能力

### 当前缺口（2026-06-05 验收后识别）

4. **SPA 探索器无效** — BFS 对 HashRouter/History API SPA 发现 0 个 URL
5. **page_snapshot_json 缺失** — 手动 URL 无快照，脚本质量崩溃（4.6% 通过率）
6. **AI 模板约束执行不足** — AI 偶尔生成 test()/expect()/waitForLoadState/前缀

详见 `docs/requirements-baseline.md` Gap D/E/F/G。

## Runtime Gotchas（运行时真相）

### 脚本质量数据链路

脚本通过率取决于完整的数据链路，**不是**只看脚本生成模板本身：

```text
探索阶段 getSnapshot() → urls.page_snapshot_json
  → ScriptGeneratorService.loadScenarioContext()
    → {{page_snapshot}} 模板变量
      → AI 选择器选择 → 脚本通过率
```

- 手动添加的 URL 不经过探索，`page_snapshot_json` 为 NULL
- NULL 快照 → AI 编造选择器 → 通过率从 60%+ 降到 4.6%
- 变通：手动注入 DOM 快照到 `urls.page_snapshot_json`

### 脚本执行约束

- `ExecutorService` 通过 `npx tsx` 子进程执行，**不支持 Playwright Test API**
- 生成的脚本必须使用 Playwright **Library API**（`import { chromium } from 'playwright'`）
- 禁止使用 `test()`, `describe()`, `expect()` — executor 不识别这些函数
- 禁止使用 `waitForLoadState('networkidle')` — SPA 不触发此事件
- AI 偶尔在脚本内容开头加 `typescript` 语言标记，导致 ReferenceError

### 并发执行限制

- `POST /execution/run/:scriptId` **不支持并发调用**
- 并发执行会导致子进程被 SIGTERM，全部返回 timeout
- 批量执行必须串行（顺序调用或使用 `run-all`）
- `run-all` 内部是逐个执行，不并发

### AI 超时配置

- `config/config.json` `settings.timeout` 默认 30s — 对复杂 prompt 太短，建议 180s
- `proxy-adapter-client.ts` `DEFAULT_AI_TIMEOUT_MS` 默认 120s — 建议 300s
- 已在代码中临时调整为推荐值

### PowerShell JSON 序列化陷阱

- PowerShell `ConvertTo-Json` 会破坏多行字符串中的换行符
- 上传 PRD 时应使用 `curl --data-binary @file.json` 而非 PowerShell 哈希表
- AI 返回的中文可能因 GBK 编码在 stderr 中显示乱码，但不影响执行逻辑

## Verification Reality

- 不要再把 `setNotFoundHandler` 的旧 3 个失败测试当作当前已知问题
- 当前文档应以**最新代码与本分支验证结果**为准，而不是历史计划中的旧测试数字
