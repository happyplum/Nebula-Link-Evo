# AI E2E 后续开发路线图（基于当前需求基线）

> 状态：`deprecated` 历史路线。本文中的任务已经完成或属于旧需求阶段，不再是当前可执行开发顺序。
>
> 新目标必须在 `requirements-baseline.md` 的已确认需求完成技术细化和文档确认后另行制定；不得从本文续排任务。
>
> 目标不是“继续堆功能”，而是优先补齐会导致主流程偏差的缺口。

## 1. 路线总览

> **状态更新（2025-05-15）**：以下 3 个路线图现已全部实现完成。文档保留作为实施过程参考。

当前建议顺序：

1. **补 URL 绑定强门禁** ✅ 已完成
2. **补 Scenario 编辑能力** ✅ 已完成
3. **补项目级诊断报告** ✅ 已完成

这个顺序的理由：

- URL 绑定门禁直接影响脚本生成前的输入正确性
- Scenario 编辑决定“AI 分析产物能否被人工修正”
- 项目级诊断报告价值高，但属于汇总与治理层，不应先于主流程精度修正

---

## 2. Roadmap A：URL 绑定强门禁 ✅ 已完成

> **实施状态**：已实现。状态机现在检查每个功能模块是否都有绑定，返回未绑定模块清单，前端显示未绑定模块提示。

### 2.1 目标

把当前“项目里至少存在一个 URL binding”提升为：

- **每个功能模块都必须至少绑定一个 URL**

否则项目不能从 `explored` 进入 `generating`。

### 2.2 当前问题

当前 `StateMachineService.checkDeliverables()` 在 `explored → generating` 边界只检查：

- 当前项目下是否存在任意 `url_bindings`

这会导致：

- 某些功能模块尚未绑定 URL
- 但脚本生成仍然可以继续

### 2.3 交付结果

完成后应具备：

1. 状态机检查每个功能模块是否都有绑定
2. 返回未绑定功能模块清单
3. 前端或 API 调用方可明确提示哪些模块缺失绑定
4. 文档同步更新为“进入生成阶段前，每个功能模块都必须完成绑定”

### 2.4 建议拆解

#### Task A1：增强状态机门禁逻辑

- 文件：`ai-e2e/src/services/state-machine-service.ts`
- 修改点：`explored → generating` 的检查逻辑
- 当前行为：只检查 `url_bindings.length > 0`
- 目标行为：遍历项目下全部功能模块，检查每个模块是否至少存在一个 binding

#### Task A2：暴露未绑定模块详情

- 文件：
  - `ai-e2e/src/services/state-machine-service.ts`
  - 相关 route / 返回结构
- 目标：让调用方知道不是“门禁失败”，而是“哪些功能模块未绑定 URL”

#### Task A3：路由 / UI 层展示阻断原因

- 文件：
  - `ai-e2e/src/server/routes/state.ts`（若状态切换入口在此）
  - `ai-e2e/ui/src/features/exploration/` 相关页面 / store
- 目标：在前端明确展示未绑定模块，而不是只给模糊失败信息

#### Task A4：文档同步

- 更新：
  - `ai-e2e/README.md`
  - `ai-e2e/AGENTS.md`
  - `ai-e2e/docs/requirements-baseline.md`
  - 本文档

### 2.5 验收标准

- 存在 3 个功能模块，其中只有 2 个绑定 URL 时，**不能**进入 `generating`
- 返回值中能识别出未绑定模块
- 全部功能模块完成绑定后，状态切换恢复正常

---

## 3. Roadmap B：Scenario 编辑能力 ✅ 已完成

> **实施状态**：已实现。提供 GET/PUT `/api/projects/:id/scenarios` API，前端包含 ScenarioPanel 和 ScenarioEditor 组件。

### 3.1 目标

补齐原始需求里“文档生成后允许人为修改和补充”的最后一块：

- **测试场景（scenario）可以被独立查看、编辑、保存**

### 3.2 当前问题

当前系统明确支持：

- 模块编辑
- 脚本编辑

但不支持：

- 场景级的完整独立编辑工作面

### 3.3 交付结果

完成后应具备：

1. 查看某个功能模块下的测试场景
2. 编辑测试场景的核心字段
3. 保存修改结果
4. 后续脚本生成 / 再生成使用最新场景内容

### 3.4 建议拆解

#### Task B1：定义 scenario 编辑范围

- 先锁定可编辑字段，例如：
  - 场景名称
  - 描述
  - 前置条件
  - 预期结果
  - 测试数据提示（如当前 schema 支持）

#### Task B2：补 service / repo 能力

- 可能涉及文件：
  - `ai-e2e/src/database/repositories/test-scenario-repository.ts`
  - `ai-e2e/src/services/` 中与分析结果管理相关的服务
- 目标：提供明确的 scenario 更新能力

#### Task B3：补 route API

- 可能涉及文件：
  - `ai-e2e/src/server/routes/project-analysis.ts`
- 目标：增加 scenario 查询 / 更新接口

#### Task B4：补 UI 编辑工作面

- 可能涉及路径：
  - `ai-e2e/ui/src/features/analysis/`
- 目标：让用户在分析阶段能直接人工修订场景内容

#### Task B5：确保脚本生成消费更新后的场景

- 可能涉及文件：
  - `ai-e2e/src/services/script-generator-service.ts`
- 目标：确认脚本生成读取的是最新 scenario 数据，而不是旧快照

#### Task B6：文档同步

- 更新：README / AGENTS / requirements-baseline / 本文档

### 3.5 验收标准

- 用户可以编辑 scenario 核心字段并成功保存
- 重新生成脚本时能反映最新场景内容
- 文档可以明确声明“测试场景支持人工编辑”

---

## 4. Roadmap C：项目级诊断报告 ✅ 已完成

> **实施状态**：已实现。提供 `/api/projects/:id/diagnosis/report` API，支持项目级失败聚合、根因分类统计、JSON/HTML 导出。UI 包含 ReportPanel 和可视化图表。

### 4.1 目标

把当前的 run 级诊断扩展为项目级能力：

- 项目范围失败汇总
- 根因分类 / 分布统计
- 可读报告 / 导出能力

### 4.2 当前问题

当前只有：

- `runId` 级诊断
- `runId` 级 intervention history

没有：

- 项目维度失败聚合
- 根因聚类
- 面向汇报或复盘的报告视图

### 4.3 交付结果

完成后应具备：

1. 按项目汇总某次执行或一批执行失败
2. 给出失败类型分布
3. 提供可读的项目级诊断报告视图
4. 视需求补导出能力（JSON / Markdown / PDF 之一）

### 4.4 建议拆解

#### Task C1：定义“项目级报告”的输入边界

- 是按 project 全量 runs 汇总
- 还是按某次批量执行窗口汇总
- 必须先锁定，否则后端聚合逻辑会反复变动

#### Task C2：补聚合服务

- 可能新增：`ExecutionReportService` 或类似服务
- 负责按项目 / 执行批次归并 diagnosis 与 runs

#### Task C3：补 route API

- 可能新增：
  - `GET /api/projects/:id/execution/report`
  - 或 `GET /api/projects/:id/execution/report/:batchId`

#### Task C4：补 UI 报告页 / 报告面板

- 可能涉及路径：
  - `ai-e2e/ui/src/features/execution/`
- 目标：能在项目层查看失败分布、根因摘要、建议动作

#### Task C5：文档同步

- 一旦实现，必须去掉 README 与基线文档中“项目级报告未实现”的限制描述

### 4.5 验收标准

- 某项目存在多个失败 run 时，能输出项目级失败汇总
- 能区分单次 run 诊断与项目级报告
- 文档中可以安全声明“支持项目级诊断报告”

---

## 5. 实施优先级结论

### 已完成 ✅

1. **URL 绑定强门禁** — 2025-05-15 完成
2. **Scenario 编辑能力** — 2025-05-15 完成
3. **项目级诊断报告** — 2025-05-15 完成

全部 3 个路线图已实现，本文档保留作为实施过程参考。

## 6. 文档约束

在上述 roadmap 任意一项落地后，必须同步更新：

1. `ai-e2e/README.md`
2. `ai-e2e/AGENTS.md`
3. `ai-e2e/docs/requirements-baseline.md`
4. `ai-e2e/docs/gap-analysis.md`
5. 本文档
