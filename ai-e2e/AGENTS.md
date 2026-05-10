# AI E2E

## Overview

AI 驱动的 E2E 自动化测试编排服务，运行在端口 `3002`。通过 HTTP 消费 `proxy-adapter` 的 AI 生成和 Playwright 浏览器控制服务，自身不直连 AI provider 或 Playwright。

## Commands

```bash
pnpm dev          # tsx watch src/server/index.ts
pnpm build        # tsc → dist/ + vite build ui/
pnpm start        # node dist/server/index.js
pnpm test         # Vitest
```

## Architecture

```
ai-e2e (:3002)
├── ProxyAdapterClient (HTTP client) ──→ proxy-adapter (:3000)
│   ├── POST /api/ai/generate          AI 文本生成 (defaults.decision)
│   └── /debug/api/playwright/*        浏览器控制 (navigate, click, type, ...)
├── PromptTemplateManager              提示词模板管理 (prompts/*.md)
├── TokenBudgetTracker                 Token 预算追踪
├── DatabaseManager                    SQLite (项目、探索、脚本、诊断)
└── Fastify server                     REST API + SSE + SPA 静态服务
```

## Startup Order

1. `dotenv` 加载
2. `ProxyAdapterClient` 实例化（读 `PROXY_ADAPTER_URL` env，默认 `http://localhost:3000`）
3. `PromptTemplateManager` 初始化（读 `prompts/` 目录）
4. `TokenBudgetTracker` 初始化（默认预算 500,000 tokens）
5. `DatabaseManager` 初始化（SQLite）
6. `LoginRecorderService` 创建（依赖 DB + ProxyAdapterClient）
7. `createServer()` 注入所有服务到路由插件 options
8. `app.listen()`

## Where To Look

| Area | Path | Notes |
|------|------|-------|
| Server entry | `src/server/index.ts` | Bootstrap、DI、路由注册 |
| HTTP client | `src/infrastructure/proxy-adapter-client.ts` | AI + Playwright 调用、契约适配、错误映射 |
| Service error | `src/services/service-error.ts` | 统一错误类型（含 `unavailable(503)`） |
| Business services | `src/services/` | PRD 分析、脚本生成、探索、诊断、登录录制 |
| Prompts | `prompts/*.md` | Mustache 模板，**不可删除** |
| AI infrastructure | `src/ai/` | PromptTemplateManager + TokenBudgetTracker（**非** AIProvider，已移除） |
| Routes | `src/server/routes/` | Fastify 路由，通过 plugin options 接收服务实例 |
| Tests | `src/__tests__/`, `src/**/__tests__/` | Vitest，mock ProxyAdapterClient |

## Boundaries

- **不直连 AI provider**：所有 AI 调用通过 `ProxyAdapterClient.generateText()` → `POST /api/ai/generate`
- **不直连 Playwright**：所有浏览器操作通过 `ProxyAdapterClient` Playwright 方法 → `proxy-adapter` debug API
- **不依赖 `@ai-sdk/*`**：AI SDK 依赖已完全移除
- **数据库独立**：自有 SQLite，不与 proxy-adapter 共享

## Conventions

- 路由通过 plugin options 注入服务实例，**不用** Fastify decorators（encapsulation rule）
- `.js` extension for local TS imports
- `ProxyAdapterClient` 是唯一的外部基础设施访问点
- 优雅降级：`PROXY_ADAPTER_URL` 未配置时，DB-only 路由正常工作，AI/Playwright 路由返回 503

## Anti-Patterns

- 不引入 `@ai-sdk/*` 或任何 AI SDK 依赖
- 不直连 `playwright-server`（必须经过 proxy-adapter）
- 不修改 `ExecutorService`
- 不删除 `prompts/` 目录
- 不在 proxy-adapter 中引入 ai-e2e 特有概念

## Pre-existing Issues

- `server.test.ts` 有 3 个测试因 `setNotFoundHandler` 冲突失败（SPA catch-all 与 error-handler plugin 重复注册）
