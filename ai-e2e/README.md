# AI E2E

AI 驱动的端到端自动化测试编排子包。它把 **PRD 分析、目标站点探索、Playwright 脚本生成、脚本执行、失败诊断** 串成一个完整工作流，并且**统一通过 `proxy-adapter` 获取 AI 与浏览器能力**。

> 当前实现的重点是“从需求到脚本，再到执行与失败诊断”的闭环，而不是做一个通用测试平台。

## 它解决什么问题

ai-e2e 面向这样一类场景：

- 你已经有一个待测 Web 应用
- 你有产品需求文档（PRD）或至少有较明确的业务描述
- 你希望 AI 帮你完成需求拆解、页面探索、测试脚本生成与失败诊断
- 你希望测试编排层本身**不要再直连 AI provider 或 Playwright**，而是复用平台已有基础设施

它不是浏览器控制底座，也不是通用 Agent 聊天系统；它是一个**基于需求驱动的 E2E 测试编排器**。

## 当前真实工作流

```text
PRD / 业务描述
  → AI 分析业务模块 / 功能模块 / 测试场景
  → AI 探索目标网站并提出 URL 绑定
  → AI 为测试场景生成 Playwright 脚本
  → 人工可编辑脚本并保存版本
  → 执行脚本
  → 失败时进行单次运行级别的 AI 诊断
  → 对明确可修复的问题可选执行自动修复
```

## 当前功能边界

### 已实现

- **项目管理**：创建项目、配置目标 URL、维护基础测试配置
- **PRD 分析**：把需求拆成 L1 业务模块、L2 功能模块和测试场景
- **模块编辑**：支持业务模块 / 功能模块的增删改排
- **站点探索**：AI 驱动探索页面并提出 URL 与功能模块的绑定建议
- **脚本生成**：按测试场景生成 Playwright TypeScript 脚本
- **脚本编辑与版本管理**：人工修改脚本、保存版本、查看版本历史
- **脚本执行**：执行单个脚本、批量执行、查看 run 历史与详情
- **失败诊断**：对单次运行失败进行 AI 诊断，支持项目级诊断汇总报告、根因分布统计、JSON/HTML 导出
- **可选自动修复**：对选择器漂移、等待时序等明确问题做受限自动修复
- **SSE 实时推送**：向前端推送分析 / 探索 / 生成 / 执行阶段的实时事件
- **SPA UI**：通过 `/ai-e2e/` 提供 React 前端

### 已实现的增强功能

1. **项目级诊断汇总报告**
   - 已支持项目范围的失败聚合、根因汇总、JSON/HTML 导出
   - 根因类型：selector|timing|assertion|environment|data|unknown

2. **每个功能模块都必须绑定 URL 的强校验**
   - 状态机现在强制每个功能模块都必须完成 URL 绑定才允许继续生成脚本
   - `ai_proposed` 状态计为已绑定

3. **测试场景（scenario）的人工作业面**
   - 提供完整的独立人工编辑 API / UI 能力
   - 支持测试场景的增删改查和数据映射

## 设计思路

### 1. 把 ai-e2e 定位成“编排层”，而不是基础设施层

ai-e2e 自己不负责：

- 直连 AI provider
- 直连 Playwright 浏览器服务
- 管理多 provider 配置

这些都交给 `proxy-adapter`。ai-e2e 只关心：

- 需求如何拆解
- 页面如何探索
- 脚本如何生成 / 编辑 / 执行
- 失败如何诊断 / 修复

### 2. `ProxyAdapterClient` 是唯一外部能力入口

```text
ai-e2e
  └── ProxyAdapterClient
        ├── POST /api/ai/generate
        └── /debug/api/playwright/*
              ↓
         proxy-adapter
```

这样做的好处：

- ai-e2e 不依赖 `@ai-sdk/*`
- 浏览器操作契约统一
- provider 切换、AI 参数、Playwright 接口演进由 proxy-adapter 统一吸收
- ai-e2e 的职责更清晰：只做测试编排，不做基础设施拼装

### 3. 服务层按工作流拆分

| 服务 | 作用 |
|---|---|
| `ProjectService` | 项目与基础配置管理 |
| `PRDAnalyzerService` | PRD → 业务模块 / 功能模块 / 测试场景 |
| `TestScenarioService` | 测试场景 CRUD + 数据映射（preconditions ↔ expected_results） |
| `ExplorerService` | 页面探索与 URL 绑定建议 |
| `ScriptGeneratorService` | 测试脚本生成、再生成、保存人工编辑版本 |
| `LoginRecorderService` | 登录步骤录制与回放支撑 |
| `ExecutorService` | 运行脚本并收集产物 |
| `AIDiagnosisService` | 单次运行失败诊断、自动修复、人工审核升级、项目级诊断聚合 |
| `StateMachineService` | 项目状态流转与阶段门禁 |

### 4. 用状态机约束交付物边界

当前状态流：

```text
draft → configuring → analyzing → analyzed → exploring → explored → generating → ready → running → completed
```

关键门禁：

- `configuring → analyzing`：要求已有 `target_base_url`
- `analyzed → exploring`：要求已有业务模块
- `explored → generating`：要求每个功能模块至少绑定一个 URL（`ai_proposed` 状态计为已绑定）
- `ready → running`：要求已有脚本

## 与 proxy-adapter 的关系

ai-e2e 是 `proxy-adapter` 的下游消费者：

- AI 文本生成：`POST /api/ai/generate`
- Playwright 操作：`/debug/api/playwright/*`
- 简化 DOM / 页面状态等调试信息：通过 debug API 获取

因此：

- ai-e2e **不应该**引入新的 AI SDK 依赖
- ai-e2e **不应该**直接请求 `playwright-server`
- proxy-adapter 是 ai-e2e 唯一外部能力网关

## 失败诊断与自动修复

当前实现支持的是：

- **单次运行级别诊断**：针对某个 `runId` 收集错误信息、日志、脚本上下文并生成诊断
- **诊断历史**：查询该次运行的 AI 干预记录
- **可选自动修复**：仅在问题足够明确、改动受控时尝试自动修复
- **项目级诊断报告**：聚合项目所有失败、根因分布统计、JSON/HTML 导出

## 快速开始

### 前置条件

- Node.js >= 22.5.0
- pnpm >= 8
- `proxy-adapter` 已启动（默认 `http://localhost:3000`）
- `playwright-server` 已启动（由 `proxy-adapter` 依赖）

### 安装与启动

```bash
cd ai-e2e
pnpm install
pnpm dev
```

启动后：

- API：`http://localhost:3002`
- UI：`http://localhost:3002/ai-e2e/`

### 环境变量

当前后端启动逻辑实际读取的是：

```bash
PROXY_ADAPTER_URL=http://localhost:3000
AI_E2E_PORT=3002
AI_E2E_DB_PATH=./data/ai-e2e.sqlite
```

说明：

- `PROXY_ADAPTER_URL` 为空时，DB-only 路由仍可工作
- AI / Playwright 相关路由会优雅降级为 `503 Service Unavailable`

### 常用命令

```bash
pnpm dev          # tsx watch src/server.ts
pnpm build        # tsc -b && cd ui && pnpm build
pnpm start        # node dist/server.js
pnpm test         # vitest run
pnpm type-check   # tsc --noEmit
```

## 使用方式

### 通过 UI

1. 打开 `/ai-e2e/`
2. 创建项目并填写目标站点 URL
3. 上传 PRD 或粘贴需求文本
4. 触发分析，得到业务模块 / 功能模块 / 测试场景
5. 启动探索，确认或调整 URL 绑定
6. 为测试场景生成脚本
7. 人工查看和编辑脚本（如有需要）
8. 执行脚本并查看诊断结果

### 通过 API（按阶段）

主要路由分组：

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

这套 API 分别对应：项目管理、配置、需求分析、站点探索、测试场景、脚本管理、执行诊断、项目级诊断、状态流转、实时事件。

## 目录结构

```text
ai-e2e/
├── src/
│   ├── server/                 # Fastify 后端与路由注册
│   │   ├── index.ts            # createServer()/start()、DI、静态 UI 挂载
│   │   ├── routes/             # 项目 / 分析 / 探索 / 脚本 / 执行 / 状态 / 事件
│   │   └── plugins/            # 错误处理、SSE 等插件
│   ├── services/               # 工作流核心服务
│   ├── infrastructure/         # ProxyAdapterClient
│   ├── ai/                     # PromptTemplateManager / TokenBudgetTracker
│   ├── database/               # SQLite 初始化、repo、migrations
│   └── types/                  # 后端领域类型 / API schema
├── prompts/                    # AI 提示词模板
├── ui/                         # React SPA
│   └── src/
│       ├── app/                # 路由、页面、应用壳
│       ├── features/           # project / analysis / exploration / scripts / execution / ai-status / scenario / report
│       ├── shared/             # 通用组件、hooks、API 基础设施
│       └── types/              # 前端类型
├── data/                       # SQLite 数据文件
├── artifacts/                  # 执行产物
├── AGENTS.md                   # 包级开发约束
└── docs/                       # 包级需求基线 / 防偏移文档
```

## 非目标

当前 ai-e2e 明确**不做**这些事情：

- 不与 proxy-adapter 合并为单一包
- 不共享 proxy-adapter 的数据库
- 不统一到 debug-ui 的 SSE 模型
- 不做 UI 视觉重设计
- 不做浏览器会话隔离系统
- 不做通用测试平台化抽象

## 已知限制与技术债

以下限制与技术债已在当前版本中解决：

1. ~~诊断能力是 run 级，不是 project 级~~ — 已支持项目级诊断聚合与导出
2. ~~URL 绑定校验粒度不足~~ — 已强制每个功能模块必须绑定 URL
3. ~~scenario 人工编辑面不完整~~ — 已提供完整的独立编辑能力

## 一句话总结

如果你想快速理解 ai-e2e，可以把它看成：

> 一个通过 `proxy-adapter` 复用 AI 与浏览器能力的、面向 PRD 驱动测试生成与失败诊断的 E2E 编排层。
