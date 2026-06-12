# 技术债清理计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 系统性清理审计发现的 36 项技术债，按优先级分 5 个阶段执行。

**Architecture:** 以 Phase 为单位串行推进，每个 Phase 内的任务尽量并行。每个 Task 是一个可独立验证、可独立提交的原子单元。

**Tech Stack:** TypeScript, Fastify, Vitest, React 19, pnpm monorepo

---

## 审计概要

| 类别 | 数量 | CRITICAL | HIGH | MEDIUM | LOW |
|------|------|----------|------|--------|-----|
| 安全 | 14 | 1 | 4 | 5 | 4 |
| 测试覆盖率 | 4 | — | 2 | 2 | — |
| 历史报告(仍存) | 5 | — | 2 | 3 | — |
| ai-e2e 限制 | 5 | — | 1 | 3 | 1 |
| 死代码 | 5 | — | — | — | 5 |
| 依赖健康度 | 4 | — | — | 4 | — |
| README 标记 | 3 | — | — | 2 | 1 |

---

## Phase 0: 即时清理（低风险，快速见效）

### Task 0.1: 删除死代码

**Files:**
- Delete: `shared/utils/uuid.d.ts`
- Delete: `proxy-adapter/src/services/provider/built-in.ts`
- Delete: `proxy-adapter/src/services/provider/schema.ts`
- Delete: `proxy-adapter/src/services/provider/index.ts`
- Delete: `proxy-adapter/src/schemas/common.ts`

- [ ] **Step 1: 验证无生产引用**

Run: `grep -r "built-in" proxy-adapter/src --include="*.ts" | grep -v __tests__ | grep -v ".d.ts"`
Run: `grep -r "uuid.d.ts\|generateUUID" shared/ --include="*.ts"`
Run: `grep -r "SuccessResponseSchema\|common.js" proxy-adapter/src --include="*.ts" | grep -v __tests__`

Expected: 仅测试文件或已删除文件自身引用（若有生产引用则跳过该文件）

- [ ] **Step 2: 逐个删除文件**

```bash
git rm shared/utils/uuid.d.ts
git rm proxy-adapter/src/services/provider/built-in.ts
git rm proxy-adapter/src/services/provider/schema.ts
git rm proxy-adapter/src/services/provider/index.ts
git rm proxy-adapter/src/schemas/common.ts
```

- [ ] **Step 3: 验证构建**

Run: `pnpm build`
Expected: 成功，无编译错误

- [ ] **Step 4: 验证测试**

Run: `pnpm -r exec -- vitest run`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git commit -m "chore: 删除5个无生产消费者的死代码文件

删除 shared/utils/uuid.d.ts, provider/built-in.ts,
provider/schema.ts, provider/index.ts, schemas/common.ts"
```

---

### Task 0.2: 修复依赖版本说明符

**Files:**
- Modify: `playwright-server/package.json` — 4处版本更新
- Modify: `pnpm-workspace.yaml` — catalog 更新（如适用）

- [ ] **Step 1: 更新 playwright-server/package.json**

```diff
- "playwright": "^1.41.0"
+ "playwright": "^1.58.2"
```

```diff
- "@types/node": "^20.0.0"
+ "@types/node": "^22.0.0"
```

```diff
- "node": ">=20.0.0"
+ "node": ">=22.5.0"
```

- [ ] **Step 2: 检查 pnpm-workspace.yaml catalog**

若 Vite catalog 指定 `^5.0.0`，确认是否需要更新。注意：lockfile 中 Vite 7.3.1 来自 vitest 内部依赖，catalog `^5.0.0` 用于直接依赖（debug-ui 等），需确认实际使用版本。

- [ ] **Step 3: 安装依赖**

Run: `pnpm install`
Expected: lockfile 更新，无 peer dep 错误

- [ ] **Step 4: 验证构建和测试**

Run: `pnpm build && pnpm -r exec -- vitest run`
Expected: 成功

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "fix: 更新依赖版本说明符对齐实际使用版本

playwright ^1.41.0→^1.58.2, @types/node ^20→^22,
engine >=20→>=22.5"
```

---

## Phase 1: 安全加固（CRITICAL/HIGH）

> **前提:** H1（全局无认证）是跨 Phase 架构决策，需先确认产品方向。
> 本 Phase 先处理不依赖认证的 HIGH 级安全修复。

### Task 1.1: H4 — debug 路由添加 body schema 验证

**Files:**
- Modify: `proxy-adapter/src/plugins/routes/api/debug/*.ts` — 5个端点

- [ ] **Step 1: 定位缺 body schema 的 debug 端点**

搜索 debug 路由中 `body` 未配置 JSON Schema 的 POST/PUT/PATCH 端点。对每个端点添加 Fastify JSON Schema:

```typescript
// 示例：为 execute-script 端点添加 schema
schema: {
  body: Type.Object({
    script: Type.String({ minLength: 1 }),
    // ...其他必要字段
  })
}
```

- [ ] **Step 2: 为每个端点添加 schema**

逐一处理 5 个端点，使用 `@sinclair/typebox` 构造 schema（已有依赖）。

- [ ] **Step 3: 验证 schema 拒绝无效输入**

为每个端点编写/补充测试，验证缺失字段、类型错误返回 400。

- [ ] **Step 4: 提交**

```bash
git commit -m "fix(security): 为5个debug端点添加body schema验证"
```

---

### Task 1.2: H3 — failure-sample 路径遍历防护

**Files:**
- Modify: `proxy-adapter/src/` — failure-sample 相关处理逻辑

- [ ] **Step 1: 定位 failure-sample 文件路径处理代码**

搜索接受用户输入构造文件路径的逻辑。

- [ ] **Step 2: 添加路径规范化检查**

```typescript
import path from 'node:path';

const SAFE_BASE = path.resolve('/some/safe/dir');
function sanitizePath(userInput: string): string {
  const resolved = path.resolve(SAFE_BASE, userInput);
  if (!resolved.startsWith(SAFE_BASE + path.sep)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}
```

- [ ] **Step 3: 编写测试验证拒绝 `../` 等遍历模式**

- [ ] **Step 4: 提交**

```bash
git commit -m "fix(security): failure-sample添加路径遍历防护"
```

---

### Task 1.3: H5 — ai-e2e 移除 shell:true

**Files:**
- Modify: `ai-e2e/src/` — exec 调用点

- [ ] **Step 1: 定位 ai-e2e 中使用 `shell: true` 的 exec 调用**

- [ ] **Step 2: 改为不使用 shell 的形式**

```typescript
// Before
exec(`playwright test ${scriptPath}`, { shell: true })
// After
execFile('playwright', ['test', scriptPath])
```

- [ ] **Step 3: 验证功能不受影响**

- [ ] **Step 4: 提交**

```bash
git commit -m "fix(security): ai-e2e移除shell:true防止脚本注入"
```

---

### Task 1.4: H1 — 认证框架设计（需用户确认方向）

> **这是架构级决策，不直接写代码。产出设计文档，等用户确认后拆分实现 Task。**

- [ ] **Step 1: 评估选项**

产出方案对比文档，覆盖：
- API Key (简单，适合工具类 API)
- JWT + Refresh Token (标准 Web 应用)
- OAuth2 (第三方集成)
- Session-based (传统)

每个方案对当前架构（Fastify, MCP Server, debug UI, ai-e2e）的影响分析。

- [ ] **Step 2: 保存设计文档到 `docs/plans/2026-06-12-auth-design.md`**

- [ ] **Step 3: 等用户确认后创建实现计划**

---

## Phase 2: 测试覆盖率补齐

### Task 2.1: 安装 @vitest/coverage-v8

**Files:**
- Modify: `package.json`（root devDependency）

- [ ] **Step 1: 安装**

Run: `pnpm add -Dw @vitest/coverage-v8`

- [ ] **Step 2: 验证覆盖率可运行**

Run: `cd proxy-adapter && pnpm vitest run --coverage`
Expected: 生成覆盖率报告

- [ ] **Step 3: 提交**

```bash
git commit -m "chore: 安装@vitest/coverage-v8支持覆盖率报告"
```

---

### Task 2.2: shared 包添加测试

> shared 是基础包（170 源文件仅 6 测试），被所有其他包依赖。

**Files:**
- Create: `shared/__tests__/` 下多个测试文件
- Modify: `shared/vitest.config.ts` — 添加配置和阈值

- [ ] **Step 1: 为 shared 添加 vitest 配置**

```typescript
// shared/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['**/*.ts'],
      exclude: ['**/*.test.ts', '**/types/**', '**/index.ts'],
      thresholds: {
        statements: 30,
        functions: 30,
        branches: 30,
        lines: 30,
      },
    },
  },
});
```

初始阈值 30%（从 3.5% 起步），后续逐步提升。

- [ ] **Step 2: 为核心类型和工具函数编写测试**

优先测试：
- `shared/types/` — 类型守卫和验证函数
- `shared/utils/` — 工具函数
- `shared/schemas/` — Zod schema 验证

- [ ] **Step 3: 提交**

```bash
git commit -m "test: 为shared包添加基础测试和vitest配置"
```

---

### Task 2.3: ai-e2e/ui 添加测试框架

> 前端 78 源文件 0 测试。

**Files:**
- Create: `ai-e2e/ui/vitest.config.ts`
- Create: `ai-e2e/ui/src/__tests__/setup.ts`
- Create: 首批测试文件

- [ ] **Step 1: 配置 React Testing Library + Vitest**

参考 `debug-ui/vitest.config.ts` 的配置模式（jsdom environment, setupFiles）。

- [ ] **Step 2: 为关键组件编写 smoke 测试**

优先：ScenarioEditor、TestRunner、Dashboard 等核心组件的渲染测试。

- [ ] **Step 3: 提交**

```bash
git commit -m "test: 为ai-e2e/ui添加测试框架和首批smoke测试"
```

---

## Phase 3: 架构改进

### Task 3.1: API 版本控制

**Files:**
- Modify: `proxy-adapter/src/server.ts` — 路由前缀
- Modify: 所有路由注册文件

- [ ] **Step 1: 设计版本策略**

评估方案：
- URL 前缀：`/api/v1/...`
- Header 版本：`Accept: application/vnd.nebula.v1+json`
- 当前无版本 → 添加 v1 前缀的迁移路径

- [ ] **Step 2: 实现路由前缀**

```typescript
// server.ts
fastify.register(apiRoutes, { prefix: '/api/v1' });
// 同时保留无前缀路由作为兼容过渡
```

- [ ] **Step 3: 提交**

```bash
git commit -m "feat: 添加API v1版本前缀"
```

---

### Task 3.2: Action params 类型强化

**Files:**
- Modify: `proxy-adapter/src/services/action-executor.ts` — params 类型
- Modify: 相关调用点

- [ ] **Step 1: 将 `Record<string, unknown>` 替换为 discriminated union 的 params 类型**

利用 shared 中已有的完整 Action discriminated union，在 action-executor 中做类型窄化：

```typescript
import type { Action } from '@nebula-link-evo/shared';

// 在 action handler 中
function executeAction(action: Action) {
  switch (action.type) {
    case 'click':
      // action.params 已有明确类型，不再是 Record<string, unknown>
      break;
  }
}
```

- [ ] **Step 2: 提交**

```bash
git commit -m "refactor: action-executor使用shared discriminated union替代Record类型"
```

---

### Task 3.3: 可观测性基础设施

> 这是最大工作量的单项任务。分拆为独立子计划。

- [ ] **Step 1: 评估方案并产出设计**

覆盖：Prometheus metrics export、structured logging 增强、health check endpoints、optional OpenTelemetry traces。

- [ ] **Step 2: 保存设计文档到 `docs/plans/2026-06-12-observability-design.md`**

- [ ] **Step 3: 等用户确认后创建实现计划**

---

## Phase 4: ai-e2e 功能改进

### Task 4.1: SPA 探索器改进

- [ ] **Step 1: 分析当前 BFS 实现对 SPA 的限制**

定位 `ai-e2e` 中 URL 发现逻辑，理解为何 HashRouter/History API 返回 0 个 URL。

- [ ] **Step 2: 设计 SPA 感知的探索策略**

方案评估：
- 拦截 History API / hashchange 事件
- 使用 Playwright 的 page.evaluate 注入路由发现
- 解析 SPA 路由配置（React Router config 等）

- [ ] **Step 3: 实现并测试**

---

### Task 4.2: 并发执行支持

**Files:**
- Modify: `ai-e2e/src/services/executor-service.ts`

- [ ] **Step 1: 分析 ExecutorService 当前串行限制**

- [ ] **Step 2: 添加并发池控制**

```typescript
// 使用 p-limit 或自实现 semaphore
import pLimit from 'p-limit';
const limit = pLimit(maxConcurrency);
```

- [ ] **Step 3: 提交**

---

### Task 4.3: AI 超时和模板约束修复

- [ ] **Step 1: 将临时超时值 180s/300s 提升为可配置常量**
- [ ] **Step 2: 强化 AI 脚本生成的 prompt 约束**
- [ ] **Step 3: 提交**

---

## Phase 5: 中低优先级清理

### Task 5.1: M1 — CORS 收紧

- [ ] 将 `origin: true` 改为白名单或配置化 origin

### Task 5.2: M5 — 绑定地址配置化

- [ ] 默认 `127.0.0.1`，仅通过环境变量允许 `0.0.0.0`

### Task 5.3: ESLint 错误清理

- [ ] 修复 ~12 个 React Compiler warnings（debug-ui）
- [ ] 修复 ~4 个 style issues

### Task 5.4: DOM 处理共享模块

- [ ] 提取 marker-injector 和 dom-extractor 的公共 DOM 操作到 `shared/dom-utils.ts`

### Task 5.5: .env 加载集中化

- [ ] 将 server.ts 和 env.ts 的 .env 加载逻辑合并到统一入口

---

## 执行优先级摘要

| 优先级 | Phase | 预估工作量 | 依赖 |
|--------|-------|-----------|------|
| P0 | Phase 0: 即时清理 | 0.5天 | 无 |
| P1 | Phase 1: 安全加固(H2-H5) | 2天 | 无 |
| P1 | Phase 1: 认证设计(H1) | 1天设计 | 需用户确认 |
| P2 | Phase 2: 测试覆盖率 | 3-5天 | Phase 0 完成 |
| P3 | Phase 3: 架构改进 | 5-10天 | 部分依赖 Phase 1 |
| P4 | Phase 4: ai-e2e 改进 | 3-5天 | 独立 |
| P5 | Phase 5: 低优先级清理 | 2-3天 | 独立 |

**总预估：16-26 个工作日**（并行执行可压缩到 10-15 天）
