# AI E2E 需求基线（当前实现版）

> 这份文档不是历史迁移记录，而是 **ai-e2e 当前阶段的活需求基线**。当 README、历史计划、口头描述与代码不一致时，以"当前代码真实行为 + 本文约束"作为收敛依据。

> 如果需要查看"原始需求"与"当前实现"之间的逐条对照、偏差判断与优先级，请同时阅读：`ai-e2e/docs/gap-analysis.md`

## 1. 产品定位

ai-e2e 是一个 **PRD 驱动的 E2E 自动化测试编排器**。

它的目标不是成为新的浏览器底座，而是把下面这些步骤串起来：

1. 读需求
2. 拆模块
3. 探页面
4. 生脚本
5. 跑脚本
6. 诊断失败
7. 对明确可修复的问题做受控修复

## 2. 当前锁定的需求范围

### 2.1 必须存在的能力

- 项目创建与基础配置
- PRD / 需求文本分析
- 业务模块（L1）与功能模块（L2）生成
- 测试场景生成
- 页面探索与 URL 绑定建议
- Playwright 脚本生成
- 脚本人工编辑与版本管理
- 脚本执行与 run 历史
- 单次运行失败诊断
- 对明确问题的可选自动修复
- SSE 实时状态推送
- 包级 UI（`/ai-e2e/`）

### 2.2 必须保持的架构边界

- ai-e2e **只能**通过 `proxy-adapter` 获取 AI 与浏览器能力
- ai-e2e **不能**重新引入 AI SDK 依赖
- ai-e2e **不能**直接请求 `playwright-server`
- `PromptTemplateManager` 与 `TokenBudgetTracker` 继续保留在 ai-e2e 内部
- ai-e2e 维持独立 SQLite，不与 proxy-adapter 共库

## 3. 当前已实现（代码已覆盖）

### 3.1 需求分析阶段

- 上传 PRD / 原始需求文本
- 生成业务模块、功能模块、测试场景
- 编辑业务模块 / 功能模块

### 3.2 探索阶段

- AI 驱动的页面探索（传统多页应用有效，SPA 有限制 — 见 Gap D）
- URL 与功能模块绑定建议
- 人工确认 / 调整绑定

### 3.3 脚本阶段

- 生成 Playwright TypeScript 脚本（质量依赖 page_snapshot_json — 见 Gap E）
- 按脚本查看内容
- 保存人工修改版本
- 查看脚本版本历史

### 3.4 执行阶段

- 执行单个脚本
- 执行项目下全部脚本
- 查询 run 历史与 run 详情

### 3.5 诊断阶段

- 单次 run 的失败诊断
- 单次 run 的 intervention history
- 自动修复审批 / 拒绝流程
- 项目级诊断报告 — 失败聚合、根因分类、JSON/HTML 导出

## 4. 当前明确未完成的需求缺口

### 已关闭的 Gap（历史参考）

以下 Gap 已于 2025-05-15 全部解决，保留仅作历史对照：

- ~~Gap A：项目级诊断汇总报告~~ ✅ 已实现
- ~~Gap B：功能模块 URL 绑定校验~~ ✅ 已实现
- ~~Gap C：Scenario 人工编辑能力~~ ✅ 已实现

### 新发现的 Gap（2026-06-05 首次完整 E2E 验收后识别）

以下缺口通过真实执行 280 个测试脚本（对 debug-ui）暴露，之前未被文档记录。

#### Gap D：SPA 探索器对 HashRouter 应用无效

**当前现状**

- 探索器使用 BFS 爬取策略，依赖 `<a href>` 链接发现页面
- HashRouter SPA 的路由变化不产生传统导航，BFS 发现 0 个 URL

**尚未实现**

- 对 HashRouter / History API 路由的感知能力
- 基于已知 seed URL + AI 辅助的路由发现
- 对 SPA 路由模式的专用探索策略

**实际影响**

- 对 debug-ui（HashRouter SPA）探索发现 0 个 URL
- 必须手动添加 URL 并手动绑定所有功能模块
- 53 个功能模块全部需要人工绑定，工作量显著

**优先级** — **高**

#### Gap E：page_snapshot_json 缺失导致脚本质量崩溃

**当前现状**

- `ExplorerService` 在探索阶段通过 `getSnapshot()` 提取页面 DOM 快照，存入 `urls.page_snapshot_json`
- 手动添加的 URL 不经过探索流程，`page_snapshot_json` 为 NULL
- `ScriptGeneratorService` 在生成脚本时读取绑定的 URL 的 `page_snapshot_json`
- 模板变量 `{{page_snapshot}}` 为空时，AI 完全编造选择器

**尚未实现**

- 手动添加 URL 时提供可选的 DOM 快照获取
- 对 `page_snapshot_json` 为 NULL 的 URL 提供降级策略（如自动补充快照）
- 在脚本生成前校验快照完整性并发出警告

**实际影响**

- 快照缺失时 280 脚本只有 13 个通过（4.6%）
- 注入真实 DOM 快照后重生成脚本，通过率仍然受选择器匹配精确度制约
- 这是脚本质量的**关键前置条件**

**数据链路**

```text
探索阶段 → getSnapshot() → urls.page_snapshot_json
                                    ↓
脚本生成 → loadScenarioContext() → 读取绑定的 URL 的 page_snapshot_json
                                    ↓
模板 {{page_snapshot}} 注入 → AI 根据快照选择选择器
```

**优先级** — **高**

#### Gap F：脚本生成模板对 Playwright API 使用模式约束不足

**当前现状**

- `script-generation.md` 模板已禁止 `test()`/`describe()`/`expect()` 和 `waitForLoadState`
- 但 AI 仍偶尔违反约束，生成不兼容的代码
- executor 使用 `npx tsx` 执行 Playwright Library API，不支持 Playwright Test API

**尚未实现**

- 脚本生成后的语法验证（检测 test()/expect() 调用）
- 对 `waitForLoadState('networkidle')` 的自动替换（SPA 不触发 networkidle）
- 对 AI 输出中语言标记（如 `typescript` 前缀）的自动清理

**实际影响**

- 280 脚本中 75 个含 `typescript` 前缀导致 ReferenceError
- 26 个仍含 `waitForLoadState('networkidle')` 导致超时
- 脚本质量依赖 AI 遵守指令的可靠性，缺少后验证机制

**优先级** — **中**

#### Gap G：AI 超时配置与实际负载不匹配

**当前现状**

- `config/config.json` 中 `settings.timeout` 默认 30000ms（30s）
- `proxy-adapter-client.ts` 中 `DEFAULT_AI_TIMEOUT_MS` 默认 120000ms（120s）
- PRD 分析、模块分解等复杂 prompt 处理时间经常超过这些限制

**尚未实现**

- 按操作类型（分析/分解/生成/诊断）设置差异化超时
- 默认配置满足大多数 AI provider 的实际响应时间

**实际影响**

- 首次运行时 30s 超时导致所有模块分解失败（502 错误）
- 调整到 180s/300s 后问题解决

**已临时修复**

- `config/config.json` timeout → 180000ms
- `proxy-adapter-client.ts` DEFAULT_AI_TIMEOUT_MS → 300000ms

**优先级** — **中**

## 5. 非目标（当前阶段明确不做）

- 不把 ai-e2e 与 proxy-adapter 合并
- 不共享数据库
- 不做统一 SSE 平台抽象
- 不做 UI 重设计
- 不做浏览器会话隔离系统
- 不做通用测试平台产品化抽象

## 6. 当前阶段的验收边界

只有同时满足下面这些，才能认为当前 ai-e2e 主线需求没有漂移：

1. ai-e2e 仍然完全通过 `proxy-adapter` 使用 AI / Playwright
2. 需求分析 → 探索 → 脚本 → 执行 → 单次诊断链路仍然完整
3. README 不夸大未实现能力
4. AGENTS 不保留已过期的旧事实
5. 已知 gap 被显式记录，而不是被模糊表述带过去

### 首次完整 E2E 验收数据（2026-06-05，目标：debug-ui）

| 指标 | 数值 |
|---|---|
| 目标应用 | debug-ui（HashRouter SPA，2 个路由） |
| 测试脚本数 | 280 |
| 执行结果 | 13 pass (4.6%), 268 fail (95.4%) |
| 通过脚本特征 | 仅做页面加载 + viewport/title 检查 |
| 主要失败类型 | typescript 前缀(75), 选择器超时(54), 断言不匹配(33), strict_mode(33), waitForLoadState(26) |
| 关键瓶颈 | page_snapshot_json 缺失 → AI 编造选择器 |

**结论**：完整链路已打通（PRD → 分析 → 探索 → 脚本 → 执行 → 诊断），但脚本质量严重依赖快照数据完整性和 AI 模板约束执行力。在 Gap D/E/F 解决前，首次生成脚本的通过率预期较低。

## 7. 后续文档维护规则

后续如果实现了任何一个 gap，必须同步更新三处：

1. `ai-e2e/README.md`
2. `ai-e2e/AGENTS.md`
3. 本文档（`ai-e2e/docs/requirements-baseline.md`）

如果未来发生以下变化，也必须更新本文：

- 工作流阶段变化
- 外部依赖边界变化
- 诊断 / 修复范围变化
- 场景编辑能力上线
- URL 绑定门禁规则变化
- 脚本质量链路变化（快照 → 选择器 → 通过率）

## 8. 路线建议（用于防偏移，不是立即承诺）

> **状态更新（2025-05-15）**：以下 4 项路线中，前 3 项已完成。

推荐的第一批后续顺序：

1. **先补文档真实度** ✅ 已完成
2. **补 URL 绑定门禁粒度** ✅ 已完成（2025-05-15）
3. **补 scenario 编辑能力** ✅ 已完成（2025-05-15）
4. **项目级诊断报告** ✅ 已完成（2025-05-15）

推荐的第二批后续顺序（基于 2026-06-05 验收发现）：

1. **补 SPA 探索能力** — Gap D，高优先级
2. **补 page_snapshot_json 降级策略** — Gap E，高优先级
3. **补脚本生成后验证** — Gap F，中优先级
4. **补 AI 超时差异化配置** — Gap G，中优先级

原因：

- Gap D/E 直接影响探索和脚本生成两个核心阶段的自动化价值
- Gap F 是质量保障层，可通过后处理临时缓解
- Gap G 已通过配置修改临时解决
