# shared — 产品规格 (PRODUCT-SPEC)

> 一句话目标：为所有后端包与前端消费方（debug-ui、agent-activity-ui）提供共享、框架中立、运行时安全的类型与工具，避免跨包契约漂移。
> 端口：无（库包） ｜ 包名：`@nebula-link-evo/shared` ｜ 角色：依赖图最底层

---

## 1. 包级目标与边界

### 目标

- 沉淀跨包共享的纯类型、纯函数与测试辅助，保证 `proxy-adapter` / `ai-chat-service` / `ai-e2e` / `integrations/*` 与前端消费方（`debug-ui`、`agent-activity-ui`）之间契约一致。
- 框架中立、服务中立，**不引入任何后端业务语义**。

### 边界

| Owns                                                                                                      | Consumes         | Does NOT own                                  |
| --------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------- |
| 运行时类型（browser-execution / browser-operation-result / browser-target / agent-task / vision-snapshot / agent-stream / vision-marker / debug-events / constants） | TypeBox（现有 catalog 版本） | 业务逻辑、浏览器引擎、AI provider、数据库访问 |
| 运行时工具（frame-counter、agent-stream）                                                                            |                  | 任何 `dist/` 产物（直接编辑源码）             |
| 源码级测试辅助（test-utils/，含 mocks、service-lifecycle）                                                |                  |                                               |

### 硬约束

- 不反向依赖任何上层包（`proxy-adapter` / `ai-chat-service` / `ai-e2e` / `integrations/*`）。
- 不写入后端业务逻辑或服务假设。
- 工具函数无隐藏副作用。

---

## 2. 模块清单

| 模块        | 路径               | 状态    | 职责                                                                                          | 边界/契约                                                                                           |
| ----------- | ------------------ | ------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 公共入口    | `index.ts`         | shipped | 聚合 re-export 运行时类型与工具                                                               | 仅 re-export，不放新逻辑                                                                            |
| 运行时类型  | `types/`           | shipped | browser-execution、browser-operation-result、browser-target、agent-task、vision-snapshot、agent-stream、vision-marker、debug-events、constants、index | 框架中立；Agent Stream 是脱敏呈现契约，不承载控制面状态；新增类型经公共入口或显式子路径导出 |
| Agent Task 协议 | `types/agent-task.ts` | shipped | TypeBox schema + Static 派生创建、脱敏持久请求、视图、状态、命令、审计事件、真实浏览器步骤 | 仅 `./types/agent-task`；领域政策和 Harness 上下文留服务 |
| 浏览器目标协议 | `types/browser-target.ts` | shipped | canonical target/locator schema + Static | 仅 `./types/browser-target` 运行时导出；browser-execution 保留既有 type 入口 |
| 操作结果协议 | `types/browser-operation-result.ts` | shipped | TypeBox schema + Static 派生 operation record/status、artifact、resolved target 与 problem | 显式 `./types/browser-operation-result`；复用 observe/act 词表与 locator strategy，旧 browser-execution type-only 重导出；root 不加载 schema |
| 运行时工具  | `utils/`           | shipped | frame-counter、agent-stream、index 纯函数                                                                 | 必须纯函数，无副作用                                                                                |
| 测试辅助    | `test-utils/`      | shipped | mocks（BrowserContext、debug-event）、service-lifecycle、index                               | **不进 `tsc -b` 构建产物**；消费方按源码相对路径引用                                                |
| Vitest 配置 | `vitest.config.ts` | shipped | shared 包测试与覆盖率防回退门禁                                                               | 仅统计运行时入口、类型与工具；`test-utils/` 不计入生产覆盖率                                        |

### 子路径导出（package.json）

| Subpath                     | 用途                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `.`（root）                 | 运行时类型 + 工具                                                                   |
| `./types`                   | 仅类型                                                                              |
| `./types/agent-stream`      | Chat、Agent Task、Authoring 与 Run 共用的脱敏活动 snapshot/event/section v1          |
| `./types/vision-marker`     | 视觉标记线协议                                                                      |
| `./types/debug-events`      | Debug 事件契约                                                                      |
| `./types/browser-execution` | 浏览器 execution session/lease/operation/target/capability/problem 线协议与操作常量 |
| `./types/browser-operation-result` | 操作结果及嵌套 artifact/target/problem 的 canonical schema、状态常量与派生类型 |
| `./types/vision-snapshot`   | proxy-owned immutable snapshot/artifact binding，供 ai-chat-service Vision v2 校验  |
| `./utils`                   | 仅工具                                                                              |

> `test-utils/` 不在 `package.json` `exports` 中：它不进 `tsc -b` 构建产物，消费方按源码相对路径引用。

---

## 3. 功能清单

| 功能                    | 入口                         | 状态    | 验收面                                               | 关联模块                                                                                                            |
| ----------------------- | ---------------------------- | ------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 浏览器执行线协议        | `types/browser-execution.ts` | shipped | shared build + proxy/client/plugin 类型检查与测试    | `BrowserOperationRequestV1` 以 kind/operation 判别并映射精确 args；artifact ref 必含 `sizeBytes`、DOM 可带 `snapshotId`；不含 token hash、artifact bytes 或持久化内部记录 |
| 浏览器操作结果单源 | `types/browser-operation-result.ts` | shipped | shared 契约矩阵 + proxy provider 真实 MCP SDK 测试 | 三个 MCP 工具共用 schema；operation 收窄既有词表，保留 required/optional、artifact SHA/size/snapshotId、target 整数边界与 problem 字段；不改 wire major/HTTP/DB |
| Vision snapshot binding | `types/vision-snapshot.ts`   | shipped | shared build + ai-chat-service snapshot-loader tests | session/tab/operation/requestHash/lease/snapshot/artifact hash/MIME/size/status；不含 artifact bytes 或 lease token |
| Agent 活动纯回放        | `utils/agent-stream.ts`      | shipped | `utils/__tests__/agent-stream.test.ts`              | root/`./utils` 导出 `createEmptyAgentStream`、`reduceAgentStream`、`replayAgentStream`；copy-on-write 不修改 snapshot/event；跨 stream 与非递增 seq 原样忽略，允许 seq 间隙；同 sectionId 替换（含异 type 后 delta），empty 时间固定 epoch；不承载业务 state/time 策略 |
| Agent 活动呈现契约       | `types/agent-stream.ts`      | shipped | `types/agent-stream.test.ts`                         | snapshot/event/turn/section 严格运行时守卫；活动摘要上限 4 KiB；控制面事件不进入此契约                             |
| Debug 事件契约          | `types/debug-events.ts`      | shipped | `__tests__/debug-events-contract.test.ts`            | types/                                                                                                              |
| 视觉标记契约            | `types/vision-marker.ts`     | shipped | 截图契约测试                                         | types/                                                                                                              |
| 截图契约                | —                            | shipped | `__tests__/screenshot-contract.test.ts`              | types/                                                                                                              |
| Frame 计数器工具        | `utils/frame-counter.ts`     | shipped | `utils/__tests__/frame-counter.test.ts`              | utils/                                                                                                              |
| 测试 mock 工厂          | `test-utils/mocks/`          | shipped | `test-utils/__tests__/mocks.test.ts`                 | test-utils/                                                                                                         |

---

- Agent Task 公共协议契约测试：`types/agent-task.test.ts` 验证创建与脱敏请求独立、未知字段、关联键长度、安全整数、command/status 和 videoSegment 字段；浏览器 target 由同一 schema 供 Agent Task 和 proxy MCP 消费。

- `agent-stream-client` 直接消费既有 `types/agent-stream` 守卫；shared reducer 仍唯一拥有 seq 去重与回放。本次未改 shared 公共导出、wire 或 renderer 契约。

## 4. 修改维护协议 [MUST-MAINTAIN]

> **强制约束**：以下任何变更必须同步本文件，禁止漂移：
>
> 1. 新增 / 删除 / 重命名模块或子路径导出
> 2. 修改 `types/`、`utils/`、`test-utils/` 中导出的公共接口（字段、签名、枚举值）
> 3. 修改 build 范围（`tsconfig.json` 的 include/exclude）
> 4. 修改 `package.json` 的 `exports` 字段
> 5. 跨包契约变更（SSE 事件结构、action 类型、debug 事件结构、视觉标记格式）

### 维护检查清单

| 变更场景        | 必须更新                                                                    |
| --------------- | --------------------------------------------------------------------------- |
| 新增类型        | 模块清单 + 功能清单 + 对应契约测试                                          |
| 新增工具函数    | 模块清单 + 功能清单 + 单元测试                                              |
| 新增 mock       | 模块清单 + 功能清单 + `mocks.test.ts`                                       |
| 修改 build 范围 | 包级目标与边界 + 模块清单的"边界/契约"列                                    |
| 跨包契约变更    | 本文件 + 所有消费方 PRODUCT-SPEC + 跨包契约（`docs/PRODUCT-SPEC-INDEX.md`） |

---

## 5. 已知缺口与技术债

| 缺口           | 类型 | 状态 | 备注             |
| -------------- | ---- | ---- | ---------------- |
| 暂无活跃技术债 | —    | —    | 当前模块边界稳定 |

---

## 6. 关联文档

- `shared/AGENTS.md` — 开发约束与导出规则
- `docs/PRODUCT-SPEC-INDEX.md` — 跨包契约与全局索引
- 根 `AGENTS.md` — 仓库范围约束
