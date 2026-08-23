# AI E2E 资产生成、复核与局部修复契约

> 状态：`in-progress`。authoring job/task/attempt/event、单版本写锁、结构化 amendment、范围审批、局部 repair Agent 协调、真实浏览器 candidate verification、证据提升与原子激活已交付；完整 PRD bootstrap/recheck 阶段图、coverage 生成和版本 validator 尚未实现。
> 更新时间：2026-08-12。
> 本文把“PRD + 已完成网页从零生成模块级 E2E 资产”和“页面变化后定向修复”定义为可暂停、可恢复、可审计的持久工作流。它不改变功能脚本、场景、浏览器执行和安全审批的既有契约。

## 1. 核心目标

- 首次输入 PRD、部署和入口 URL 后，生成可追溯的页面、模块需求、功能脚本与跨模块场景，并通过真实可视浏览器验证。
- 后续运行前固定重新检查页面；只有确认受影响的资产生成新修订，未受影响资产不重写。
- 生成、修复、验证和激活是不同阶段；模型产出、静态 Schema 通过或“看起来正确”都不等于已验证 current 资产。
- 主代理状态不依赖长对话。服务重启后可从 authoring job/task/attempt、资产修订、决策和证据继续。

## 2. 主代理的运行形态

目标“主代理”是 `ai-e2e` 内的**持久化确定性工作流协调器**，不是单个无限循环的 LLM 会话：

- `ai-e2e` 决定阶段、依赖、任务授权、输入投影、状态转换、重试边界、版本激活和完成条件。
- 需要需求理解、页面解释、方案生成或失败分类时，主代理通过 `ai-chat-service /api/v1/agent-tasks` 发起边界明确的分析任务。
- 需要页面执行时，主代理派发一个 page-scoped child Agent task；首期同一时刻只有一个执行型子代理。
- 视觉模型仍只处理一个指定 snapshot 的单次问题，不持有 authoring job 或连续任务。
- 所有可复用结论进入 revision、version decision 或结构化 job result；模型对话不是恢复源。

## 3. Authoring job

### 3.1 模式

| mode | 触发 | 目标 |
|---|---|---|
| `bootstrap` | 新业务版本首次 PRD + URL | 从零生成并验证完整资产图 |
| `recheck` | copy、部署/Git 变化、定期复核或运行前检查 | 确认页面/脚本是否仍有效，生成影响报告 |
| `repair` | 运行失败、DOM/交互变化或用户指定资产 | 只修复受影响 revision 并验证 |
| `import_conversion` | legacy import candidate | 结合旧来源、PRD 和当前页面重新生成语义资产 |

### 3.2 生命周期与结果

生命周期：

```text
created → planning → running ↔ paused/waiting_decision → completing → completed
                              └→ cancelling → cancelled
                              └→ failed
```

`completed` 表示工作流已封存；结果单独为：

- `succeeded`：所有 required coverage 已生成、静态校验、真实浏览器验证并成功激活。
- `partial`：用户明确接受 optional/out-of-scope 项，required coverage 仍全部满足。
- `failed`：存在未解决 required 缺口、验证失败或不可恢复环境问题。
- `cancelled`：用户取消，已创建的 draft/rejected revision 和证据保留，不激活半成品。

`lifecycle=failed` 只表示协调器、持久化或协议完整性故障导致工作流无法正常封存；可正常收集并封存“required 验证未通过”的作业使用 `lifecycle=completed + outcome=failed`，避免把产品验证失败与系统崩溃混在一起。

### 3.3 阶段

`ingest → requirements → discovery → page_modeling → module_specification → script_generation → scenario_generation → verification → version_validation`

每一阶段展开为依赖明确的 authoring tasks；v1 每个 job 最多一个 running task/外部 Agent task。重试产生新 attempt，不覆盖旧结果。阶段可以因决策、依赖服务、浏览器忙或安全审批暂停。

## 4. 首次从零生成

### 4.1 Ingest

1. 创建 draft business version，冻结本次 PRD document IDs、deployment revision（含 environment）、入口 URL、用户参数和策略版本。
2. 校验 URL 属于 deployment `allowedOrigins`，secret 只保存 ref；任何浏览器动作前完成输入检查。
3. 记录 source fingerprint 和 authoring idempotency key；重复请求返回同一个 job。

输入在 job 开始后不可变。用户补充 PRD、部署或范围时创建新 job/amendment，不静默改写已执行任务。

### 4.2 Requirements

使用 `document.requirements_extract` 等通用 Skill 生成候选：

- L1 业务模块和 L2 功能模块。
- 每个功能模块的目的、功能点、验收标准、角色/前置条件、页面提示和有序用户流程。
- 跨模块业务流程、数据依赖、副作用和显式清理需求。
- PRD 缺口、矛盾、无法验证描述和需要决策的范围。

规则：

- 每个 functional point 有稳定 key。
- 每个验收标准必须能映射到确定性断言或显式标记 `manual/out_of_scope` 并附 version decision。
- PRD 不足时不能让模型补写业务事实；任务进入 waiting decision。

### 4.3 Discovery 与页面观察

- 主代理申请全局唯一的首期 browser execution session；所有探索/验证动作进入同一可视队列。
- 先访问用户入口与 PRD 明确页面，再在允许 Origin、页面/深度/时长预算内发现候选路由。
- SPA 路由发现可读取渲染后 DOM、History/hash 观察和可访问 router 信息，但每个候选必须实际导航/观测后才登记。
- 登录、造数或跨角色前置由主代理显式安排已有脚本；子代理遇到登出立即停止。
- 每次观察保存 URL redacted、title、snapshot/artifact、页面摘要、角色/locale/viewport/state tags 和发现来源。
- 弹窗、抽屉、Tab panel 是页面区域/状态，不因视觉差异自动创建 Page。

探索不自动点击未知写操作。发现按钮无法判断副作用时只观测并提出决策；production 只允许只读探索和显式认证会话变化，不为业务写候选申请例外。

### 4.4 Page modeling

1. 按 WHATWG 规范化和页面匹配规则把 observations 聚类为逻辑页面候选。
2. 决策模型结合 PRD/DOM 提议 route template、identity/runtime/ignored 参数和页面用途。
3. 静态规则检查歧义、Origin 泄漏、动态值、参数类型与 allowed transition。
4. 对每个角色/locale/viewport/state 需要的变体采集 DOM + 截图并生成 baseline fingerprint。
5. 歧义候选、相似度中间区间和无法判断的参数进入 decision，不按创建顺序猜测。

页面 revision 必须在重复导航中稳定匹配，才能供脚本生成引用。

### 4.5 Module specification

- 每个功能模块绑定一个 primary page；跨页过程通过 script pageScope 和 scenario 调用表达。
- 模块需求 revision 合并 PRD fragments、页面证据、functional points、acceptance criteria、ordered flows、assumptions 和 decisions。
- 一个页面可有多个功能模块；一个功能模块应拆出多个单一职责功能脚本，而不是把整个模块压成一个大脚本。
- 每个 functional point 必须建立 coverage disposition：`covered_by_script/manual/out_of_scope/blocked`。
- required functional point 只有 `covered_by_script` 才允许版本完成；其他结果必须由用户/产品决定是否降为 optional。
- coverage 必须逐 functional point 保存 requirement revision、目标 script revision、disposition、原因和 applied decision；汇总百分比只由这些 current rows 聚合，不能由模型直接填写。

### 4.6 Script generation

对每个计划功能脚本创建独立 task：

1. 只投影当前 module requirement、page/baseline、显式输入/输出、相关 decisions 和允许的动作/断言。
2. 生成新的 draft `nebula.ai-e2e.functional-script/1.0` revision。
3. 依次执行 Schema、引用、secret、动作、断言、副作用数量/可逆性、pageScope 和 hash 静态校验；未声明、无界或动作与副作用不一致的 candidate 直接失效。
4. 静态失败可以在同一 task 预算内只修格式/引用；改变需求、断言或副作用必须 waiting decision。
5. 静态 valid 后进入 `unverified`，不得直接成为可用于正式 run 的 current revision。copy 可由系统事务保留 `current + stale` 的目标版本选择，但版本仍为 `needs_recheck` 且不能创建正式 run。

脚本任务彼此使用干净上下文；跨脚本数据只通过声明的输入输出契约，不靠对话记忆。

### 4.7 Scenario generation

- 根据 PRD flow 把已生成 functional script stable IDs 编排为无环调用图。
- 重复有界展开规则、输入输出映射、requires_success/completion、cleanup 和最终验收使用场景 Schema。
- 每个 required script 至少被一个验证 scenario 或专用单脚本验证场景覆盖。
- 不在场景中嵌入浏览器动作、任意表达式或模型指令。
- 场景 revision 静态 valid 后仍是 `unverified`。

### 4.8 Verification

验证使用正常 semantic runner/页面子代理执行链，但创建 `purpose=authoring_verification` 的内部 run 并绑定 candidate revisions：

- 每个脚本先做职责内验证，再运行 required scenarios 验证跨脚本数据和最终验收。
- 验证 run 只能由 authoring coordinator 创建，必须关联 authoring job、精确 deployment revision、Git/build、角色、locale、viewport、baseline、candidate revision 和其依赖闭包 hash；不得通过公开正式 Run API 绕过门禁。
- 运行前固定页面/登录/输入/副作用重新检查，并从 candidate、验证调用和有界输入冻结 job 级风险投影；所有动作可视且带 operation ID。
- 验证失败产生新 attempt。定位/交互问题可生成新 candidate revision；业务预期冲突必须决策。
- 只有 candidate 的硬断言全部通过，且输出/副作用与声明一致，才能写入该精确 verification scope 的 `asset_revision_verifications.status=verified`。
- local/test 自动验证已声明、有界副作用；staging 单项非不可逆 create/update 自动验证，删除、批量、不可逆或上传在取得 browser job/control 前只请求一次 job 级审批。
- production 只允许静态校验、只读探索/断言和显式认证会话变化；业务写 candidate 可以保留为静态 valid/unverified，但不能获得 production verification，也不能使该 scope 的版本变为可运行。
- 未授权或被硬策略拒绝的副作用不允许用 mock/shadow pass 代替真实验证；job 必须等待审批、取消或以未验证结果封存。

模型自然语言、只读 shadow plan、其他 deployment/scope 或旧 run 的 pass 都不能授予当前 scope verified。

### 4.9 Version validation 与激活

业务版本成为 `valid` 前必须：

- 页面签名唯一且 required baseline 可用。
- 所有 required functional points 有 script coverage。
- 所有 required scripts/scenarios 的 current candidate 静态 valid，且在目标 deployment/build/角色/locale/viewport scope 上存在 verified 记录。
- scenario graph 无环、输入输出闭合、secret refs 可解析但不泄漏。
- required decisions 已 applied，没有 open blocking issue。
- 修订依赖索引、content hash、证据引用和 copy 独立性检查通过。

激活在一个事务中按依赖顺序切换 current revision，更新 dependency index、版本状态和 authoring event。事务失败不留下半激活版本。

## 5. 每次运行前重新检查

创建 test run 后、任何副作用动作前执行固定 preflight：

1. 三服务 capability、deployment/Git、allowed Origin、secret refs 和 browser session。
2. 入口页面身份、登录/角色、关键 baseline fingerprint 和脚本 preconditions。
3. 每个 target 在当前 DOM 的唯一性/可操作性；不复用旧坐标或 stale marker。
4. 若页面相似度 `>=0.85` 且关键目标/前置条件通过，继续正常 run。
5. `0.70–0.85` 或局部目标失配进入影响分析；`<0.70`、页面歧义、登出或错误页停止当前派发。

“页面相似”只决定是否需要分析，不替代脚本硬断言。重新检查结果写入 run evidence；不因检查成功修改 asset revision。

## 6. 影响分析

影响分析输入固定为：旧/current revision、最新 observation/baseline、失败 step/operation/assertion、PRD/decision 和依赖索引。

变化分类：

| 类型 | 判定 | 最小修复/验证范围 |
|---|---|---|
| `none` | 页面结构变化但 target/precondition/assertion 仍通过 | 不生成 revision，继续 run |
| `locator_only` | 只需修改 target candidates，输入/输出/断言/副作用/pageScope 不变 | 当前 script candidate + 单脚本验证 + 原 TODO 新 attempt |
| `interaction` | 线性步骤/等待/页面转换变化，业务契约不变 | 当前 script + 引用它的场景调用验证 |
| `contract` | 输入、输出、断言、副作用或 pageScope 改变 | script + 全部直接/传递依赖 scenario；必须主代理决策 |
| `requirement` | PRD/验收含义变化或页面不再实现原功能 | 暂停并要求产品/用户决定，不能自动修复 |
| `environment` | 登出、权限、部署、网络或服务异常 | 不修改脚本；主代理恢复前置或终止 |

模型可以提出分类，最终由确定性 diff、Schema、实际观测和 `ai-e2e` 规则裁决。

## 7. 局部修复闭环

1. 为受影响 asset 建 repair authoring job，冻结 current/failed revision 和证据。
2. 通过 dependency index 计算候选影响集；不把同页面全部脚本默认重写。
3. page child Agent 在授权范围内生成一个新 draft revision，不覆盖 current。
4. 静态校验后按第 6 节最小范围执行真实验证。
5. 失败则保留 candidate/attempt/evidence；允许在预算内生成下一 revision。
6. 通过后原子激活新 current，并追加 run plan amendment，让失败 TODO 创建新 attempt。
7. 若 contract/requirement 变化，先更新 module requirement/scenario/decision，再按依赖顺序修订，不能只改脚本。

修复只写当前 business version；copy 来源或其他版本不共享可变引用。

## 8. 依赖索引与覆盖率

revision 激活事务同步维护 `asset_revision_dependencies`，关系至少包括：

- page/requirement → functional script。
- functional script → scenario call。
- script output → downstream call input/scenario assertion/export。
- page transition/baseline → script step。
- decision → requirement/page/script/scenario revision。

索引由已校验 payload 确定性生成，不接受模型直接写边。impact analyzer 可以从索引计算传递闭包，但仍按 change kind 缩小实际重验范围。

覆盖率至少报告：

- required/optional functional point 总数及 disposition。
- 静态 valid、verified、stale、blocked 的脚本/场景数。
- 未映射 PRD acceptance criteria。
- 页面/角色/基线覆盖和最后验证 deployment/Git/time。

进度来自持久任务与 coverage，不以模型 token 或 UI 本地百分比计算。

## 9. 并发、锁与浏览器调度

- 同一 business version 同时最多一个写 authoring job；其他 recheck/repair 请求复用、排队或因 stateVersion 冲突拒绝。
- 已冻结 test run 可以继续引用旧 revision；authoring 激活新 current 不改写该 run。页面已显著漂移时主代理仍可按运行安全规则中断旧 run。
- v1 由 `ai-e2e` 以持久 `browser_jobs.queue_seq` 维护 authoring verification/test run 的公平 FIFO，只把队首交给 proxy；重启不改变已排顺序。`proxy-adapter` 用通用独占门禁保证每进程全局最多一个活动 browser execution session，不解释两类业务 job，也不允许 legacy 写工具在会话期间旁路控制。
- formal run 在 preflight/失败后触发的 repair 是该 run 的嵌套 authoring job：关联 `parentRunId`，在原子操作安全边界复用父 run 已占用的 browser job/session 槽位，不排到自己后面，也不允许无关 authoring/run 插队。父 run 先暂停并释放 control lease，内部 verification run 才取得 control；repair 完成后释放子租约，再通过精确 revision 的 run plan amendment 恢复父 run。
- run-triggered repair 只修改 locator/等待/证据且副作用投影不变时可沿用父 run grant；新增或扩大副作用、资源/actor/数量、上传、不可逆性或 deployment/policy 时，旧 grant 失效，父 run 在安全边界重新审批。production 业务写修复仍硬拒绝。
- session 暂停且保留页面时仍占用全局浏览器；只有显式结束/关闭或主代理接受丢失 Context 的释放，下一 job 才可进入。
- UI live view 是只读旁路；主代理视觉观测只能在原子操作安全边界使用 observe lease，不能与 child 写操作竞争 snapshot。
- v1 新控制面只允许 loopback/local 单用户部署；非本机或多用户拓扑在统一身份、授权与租户隔离协议验收前拒绝 authoring/run。

后期多 Context/多 Tab 并发必须另行版本化 capability 和调度协议。

## 10. Authoring API 与事件

目标业务 API：

| Method | Path | 语义 |
|---|---|---|
| POST | `/api/v1/business-versions/:versionId/authoring-jobs` | 创建 bootstrap/recheck/repair/import_conversion job，要求幂等键。 |
| GET | `/api/v1/authoring-jobs/:jobId` | 返回权威 authoring snapshot、coverage 和 active task。 |
| POST | `/api/v1/authoring-jobs/:jobId/commands` | `start/pause/resume/cancel`，要求 `If-Match`。 |
| GET | `/api/v1/authoring-jobs/:jobId/events` | snapshot-first SSE，job-scoped 单调 seq。 |
| GET | `/api/v1/authoring-jobs/:jobId/event-log` | 持久事件审计/补洞。 |
| POST | `/api/v1/authoring-jobs/:jobId/decisions/:decisionId/answer` | 回答并应用 authoring decision；长期影响同步 version decision。 |

最低事件：`authoring.snapshot/lifecycle_changed/stage_changed/completed`、`authoring_task.state_changed`、`authoring_attempt.completed`、`asset.candidate_created/validated/verified/activated/rejected`、`coverage.changed` 和 `decision.requested/applied`。

所有外部 Agent/browser 调用继续通过 integration outbox；job state/event 同事务，SSE 不是状态源。

## 11. 当前实现差距

- 当前项目状态机是准备阶段枚举，没有 authoring job/task/attempt/event、版本写锁或可恢复主代理。
- 当前 PRDAnalyzer/Explorer/ScriptGenerator 直接围绕项目旧表和纯文本生成工作，不能产出不可变 revision/coverage/dependency index。
- 当前脚本生成后即可进入旧执行器，没有 candidate static-valid/verified/current 分层。
- 当前自动修复按旧 run 修改 scenario 级 TypeScript，不能分类 locator/interaction/contract/requirement 或计算 revision 影响集。
- 当前浏览器 singleton 有进程内 mutex，但没有跨 authoring/run 的全局 application session 调度。
- 当前没有 environment 固定、风险投影、policy evaluation、job 级审批或逐 effectId 授权门禁。

## 12. 验收原则

1. PRD + URL 能从空版本生成页面、模块需求、多功能脚本和跨模块场景，所有 required coverage 可追溯。
2. 任一模型/服务中断后可从 authoring snapshot 重建，不依赖对话历史。
3. 脚本/场景只有静态 valid + 真实浏览器 verified 后才激活；未授权副作用不会被 mock pass 绕过。
4. 页面不变或仅非关键 DOM 变化不会产生无意义 revision。
5. locator-only 修复不重写同页面其他脚本；contract/requirement 变化会扩大依赖验证并暂停决策。
6. 激活事务不会留下部分 current，已冻结 run 不被新 revision 偷换。
7. 首期全局只有一个 browser execution session/写任务，主代理 observe 与子代理 act 不竞争页面状态。
8. 登出只产生 environment interruption，子代理不自行登录、不修改脚本。
9. 每个 candidate、attempt、decision、激活和失败证据都可审计，secret 不进入模型/事件/资产。
10. copy 后 repair 只改变目标版本，来源版本 current/hash 保持不变。
11. 同一资产在不同 deployment/build/角色/locale/viewport 下分别验证；任一范围的 pass 不会误授权其他范围。
12. run-triggered repair 复用父 run 槽位且不形成自等待，无关 browser job 不能在中间取得 control。
13. local/test 与 staging 低风险验证无需人工审批；staging 高风险验证在 browser job/control 前只审批一次，纯定位修复不会重复审批。
14. production 写 candidate 只能保留为 static valid/unverified，不能取得 verified 或让对应 scope 变为可运行，也不存在审批绕过。
15. repair 扩大副作用投影时父 grant 失效并暂停重新审批；缩小范围或不改变投影时审计可证明授权仍匹配。

## 13. 关联文档

- `requirements-baseline.md`：总体需求和首次/复用目标。
- `version-page-asset-contract.md`：业务版本、页面、baseline 和 copy。
- `functional-script-contract.md`、`semantic-script-schema.md`：脚本生成目标。
- `scenario-orchestration-contract.md`：场景 DAG、运行计划和 TODO。
- `agent-browser-execution-contract.md`：页面子代理、租约和可视执行。
- `run-state-decision-evidence-contract.md`：运行状态、决策和证据。
- `target-data-model.md`：authoring/依赖索引与资产/run 关系模型。
- `service-api-event-contract.md`：API、Agent/browser 调用、事件和 outbox。
- `ai-model-skill-contract.md`：模型、视觉和 Skills 边界。
- `migration-compatibility-acceptance-contract.md`：legacy import 和发布验收。
- `environment-side-effect-policy-contract.md`：authoring 环境矩阵、job 级审批和修复投影规则。
