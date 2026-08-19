# AI E2E 代理与浏览器执行契约

> 状态：已确认目标设计，部分实现（proxy 浏览器控制/取证/事件与 ai-chat-service Agent task 命令/事件/Skills 已交付，ai-e2e 编排、跨服务业务事件关联和完整证据链待实现）。
> 更新时间：2026-08-20。
> 本文定义主代理、页面子代理、`ai-chat-service` 与 `proxy-adapter` 之间的运行边界。精确 HTTP/MCP 路由和逻辑 JSON Schema 见 `service-api-event-contract.md`；鉴权与持久化实现可以调整，但所有权、幂等、串行、暂停和证据语义不得弱化。

## 1. 设计目标

目标执行链必须同时满足：

- 一个测试流程由主代理统一编排，任一时刻只有一个执行型页面子代理控制首期共享浏览器会话。
- 页面子代理逐个执行获授权的功能脚本 TODO，固定执行页面重新检查、目标解析、动作和结果验证。
- 所有浏览器观测与动作通过 `proxy-adapter` 进入同一条可视、可关联、可复现的 Playwright/CDP 执行链。
- 模型中断、网络超时或服务重启不能被误判为“浏览器动作一定没有发生”；可能产生副作用的操作不得盲目重试。
- `proxy-adapter` 保持通用浏览器网关，不持有 PRD、业务版本、场景、功能脚本或代理调度概念。

## 2. 三层所有权

| 层 | 权威状态 | 负责 | 不负责 |
|---|---|---|---|
| `ai-e2e` | 业务版本、场景修订、不可变基础运行计划、运行 TODO、执行尝试、运行变量、业务断言、环境/副作用策略、决策与证据索引 | 主代理调度、风险投影、计划级审批、任务授权、依赖传播、结果验收、恢复与修复落版 | 模型 provider、MCP 工具执行、Playwright 对象 |
| `ai-chat-service` | Agent 会话、模型消息、工具调用过程、Skills 与工具授权的运行态 | 分析/决策模型与单次视觉模型调用、页面子代理 tool loop、工具/Skill 白名单、暂停/中断传播 | 业务运行计划、业务断言最终裁决、浏览器生命周期 |
| `proxy-adapter` | 浏览器进程、Context/Page、Tab、原子浏览器操作、原始观测、实时画面和浏览器侧产物 | 通用会话/Tab 控制、目标解析、Playwright 动作、操作结果、浏览器事件与原始证据 | PRD、场景依赖、脚本修复、登录编排、业务通过/失败裁决 |

模型对话不是业务状态源。Agent 会话丢失时，系统必须能仅依赖 `ai-e2e` 的任务包、检查点、运行变量和已固化证据重建执行上下文。

## 3. 执行粒度

目标链采用“一个语义步骤一次受控推进”，不把完整脚本或任意 JavaScript 一次性交给 `proxy-adapter`：

1. 子代理读取当前 TODO 和当前语义步骤。
2. 获取最新页面状态，检查页面身份、登录状态和步骤前置条件。
3. `ai-e2e`/工具包装层核对当前 policy evaluation、风险投影、语义步骤、effectId/数量边界和所需 active grant；不匹配时不提交浏览器操作。
4. 解析目标；必要时发起一次视觉分析，但视觉模型只返回本次分析结果。
5. 向 `proxy-adapter` 提交一个原子动作或观测操作。
6. 消费结构化结果并执行操作后验证。
7. 将步骤结果和证据写入执行尝试；通过后才推进下一步。

一个语义步骤可以包含零个或多个只读观测以及最多一个主要副作用动作；所有操作仍按序独立编号。需要多个副作用动作才能完成的业务过程应拆成多个可检查步骤。不得使用 `dom_script`、任意 `page.evaluate` 或脚本批处理绕开步骤级控制。

业务分支、重复调用、跨脚本变量、登录恢复和清理编排留在 `ai-e2e` 场景运行层。`proxy-adapter` 只执行明确的通用浏览器操作。

## 4. 浏览器执行会话与控制权

### 4.1 首期会话模型

- 测试流程开始时，由 `ai-e2e` 控制面申请或绑定一个 `proxy-adapter` 浏览器执行会话；主代理持有生命周期控制权。
- v1 每个 `proxy-adapter` 进程全局最多一个活动浏览器执行会话；authoring verification 和 test run 进入同一个 browser job FIFO，不把 singleton Context 包装成可并行的多个逻辑 session。
- v1 一个浏览器执行会话从创建到释放只能绑定一个 `BrowserContext`；允许在该 Context 内串行切换 Tab，但不能中途换 Context、导入其他 storage state 或同时保留多个认证 Context。
- 页面子代理只获得当前页面任务所需的短期 `control` 租约，不获得 `browser_open`、`browser_close` 或任意 Tab 的全局控制权。主代理需要视觉/页面分析时只在操作安全边界获得 `observe` 租约。
- 首期一个浏览器执行会话只有一个有效写控制租约和一条 FIFO 动作队列。一个操作结束后才接收下一个副作用动作。
- 同一流程可切换多个 Tab，但任一时刻只有一个活动 Tab 操作流；Tab 必须先显式选择再执行，不依赖“当前最后焦点页面”。
- 主代理结束、取消或回收流程时才决定是否释放会话；子代理结束不隐式关闭浏览器。

现有进程内 `BrowserMutex` 只防止同一时刻并发进入浏览器临界区，不等同于任务控制租约、操作幂等或跨服务会话所有权，不能直接承担以上协议。

### 4.2 身份上下文

- `ai-e2e` 为运行维护 `anonymous/authenticated/unknown` 认证状态；`authenticated` 只保存场景内 `actorKey` 和已确认角色，不保存账号凭据。`proxy-adapter` 只持有 Cookie/Storage 等浏览器事实，不解释业务身份。
- 场景为每个调用声明执行前所需 actor，以及执行成功后的 actor 变化。普通功能脚本保持身份不变；登录、退出等 `auth_change` 脚本必须显式形成状态转换。
- 一个会话同一时刻最多一个已确认活动 actor。跨账号或跨角色流程通过显式“退出 → 验证匿名态 → 登录目标 actor → 验证身份/角色”串行切换，不允许隐藏 Context/storage-state 切换。
- 只有认证变化脚本全部硬断言通过，主代理才更新已确认活动 actor；失败、中断或证据冲突将状态置为 `unknown`，恢复前必须重新观测。
- 页面任务包声明所需 actor。子代理发现实际身份不符、意外登出或无法确认时，结束当前尝试并上报；它不得自行执行登录、退出或账号切换。主代理用新增 TODO 或追加式计划修订安排恢复。
- v1 不支持多个登录态并存。未来启用多 Context 或多身份时必须新增隔离、凭据授权、调度、证据归属和恢复协议，不能复用本节的单身份假设直接并发。

### 4.3 跨服务引用

跨服务只传递可序列化引用：

- `browserSessionId`：`proxy-adapter` 托管的浏览器执行会话。
- `tabId`：稳定 Tab 身份，不以数组下标代替。
- `browserLeaseId`：限制 mode（`observe/control`）、有效期、允许 Tab 和操作集合的租约；首期同一会话最多一个 control。
- `operationId`：一次原子浏览器操作的全局唯一身份兼幂等键。
- `snapshotId`：不可变页面观测快照引用。
- `targetRef`：可重解析的目标描述。

`Page`、`Locator`、`ElementHandle`、CDP Session 或内存对象不得跨进程传递。

## 5. 页面任务包与子代理权限

主代理派发的页面任务包是不可变授权边界，至少包含：

- 运行、页面任务、TODO 与执行尝试身份。
- 冻结的业务版本、页面、场景和功能脚本修订。
- 允许调用的 TODO 集合、固定顺序和停止条件。
- 页面运行锚点、允许 Tab、输入变量与可写输出槽。
- 运行计划冻结的所需 actor、当前已确认认证状态和允许的认证状态转换；不含凭据明文。
- 业务前置检查、硬断言、副作用和重试策略。
- 冻结的 environment、policy evaluation、风险投影 hash，以及每个获授权写步骤的 effectId、数量上限和可逆性；staging 高风险任务还包含 active grant 的不透明引用。
- 浏览器会话、`control` 租约及允许的 MCP 工具/Skills 白名单。
- 证据要求、时间/步骤/Token 预算和最近检查点。

子代理可以在一个页面任务中串行完成多个已就绪 TODO，但每个 TODO 必须独立记录开始、步骤、结果、输出、副作用和证据。遇到失败、登出、前置阻塞、待决策或授权范围外需求时，页面任务立即停止并结构化上报。

子代理不得：

- 改变 TODO 顺序、依赖、业务断言或输出契约。
- 调用任务包外的功能脚本、登录流程、造数流程或清理流程。
- 操作未授权 Tab、创建额外浏览器会话或关闭共享浏览器。
- 扩大工具/Skill 权限，或把模型生成的任意代码当作浏览器动作执行。
- 新增、替换或扩大副作用声明/effectId，使用缺失、过期、撤销或投影不匹配的 grant，或把只读任务改成写任务。

## 6. 原子操作信封

每次通用浏览器操作应具有以下逻辑字段组；精确请求、结果与工具投影见 `service-api-event-contract.md`：

| 字段组 | 最低语义 |
|---|---|
| 路由 | `browserSessionId`、`tabId`、`browserLeaseId`（mode 为 `observe/control`） |
| 身份与顺序 | `operationId`、租约内单调序号、提交时间、截止时间 |
| 动作 | 通用动作/观测类型、参数、`targetRef`、是否可能产生副作用 |
| 展示 | 人类可读步骤名称、动画/采集策略；不得包含业务机密 |
| 关联 | 不透明 correlation tags；由 `ai-e2e` 映射到 run/page-task/TODO/attempt/script/step |

结果至少表达：

- 接收、开始和结束时间。
- `succeeded`、`failed`、`cancelled` 或 `outcome_unknown` 结果。
- 操作前后的 URL、标题、Tab 和必要页面状态摘要。
- 最终解析的目标与采用的定位依据。
- 结构化实际值、错误分类及截图/DOM/视频片段等产物引用。

`proxy-adapter` 不解释 correlation tags 的业务含义，以此保持浏览器网关通用性。

`ai-chat-service` 的工具包装层必须在 proxy 调用前验证当前语义步骤与副作用授权交集；`proxy-adapter` 仍只接收通用 lease/Tab/operation/args 约束，不解释 environment、审批、actor 或业务资源。production 业务写计划和缺少 staging grant 的高风险计划不得取得 control lease。

## 7. 幂等、超时与结果不确定

- `operationId` 同时是去重键。调用方因传输失败重试时必须复用同一 ID；`proxy-adapter` 返回已记录结果，不得再次执行动作。
- 同一 `operationId` 携带不同参数时必须拒绝，不能按后一次请求覆盖。
- 只读观测可以用新 ID 重新执行；可能产生副作用的动作只能在已确认未执行或完成副作用检查后生成新 ID。
- 如果服务崩溃、连接中断或 Playwright 返回状态不足以证明动作是否发生，结果必须是 `outcome_unknown`，不能自动归为失败。
- `outcome_unknown` 由主代理安排页面、DOM 和业务数据检查。确认已生效则补做后置验证；确认未生效才允许创建新操作；仍无法确认则暂停或失败。
- 去重记录至少覆盖所属测试流程全部非终态生命周期，终态后默认保留 7 天；被未解决决定、`outcome_unknown` 或 evidence manifest 引用时继续保留。具体账本与清理门禁以 `service-api-event-contract.md` 为准。

这一区分用于阻止“请求超时后重复创建用户、重复提交、重复删除”等隐性数据破坏。

## 8. 目标解析契约

`targetRef` 应同时保留业务目标与候选定位依据，例如：

- 人类可读的目标语义和期望交互类型。
- role/name、test id、label、文本、CSS/XPath 等稳定候选。
- DOM 快照 ID、`data-nebula-id` 或视觉标记提示。
- 预期可见、唯一、可编辑或可点击条件。

执行前由 `proxy-adapter` 基于当前 DOM 重新解析并检查唯一性、可见性和可操作性：

- 快照或 marker 过期时返回 stale-target 与最新观测，不得静默退化为旧坐标点击。
- 多个候选冲突时停止并要求代理重新判断，不选择“最像”的元素继续。
- 坐标只允许作为显式视觉兜底，不能成为持久功能脚本的首选定位器；使用时必须记录截图尺寸、坐标依据并执行严格后置验证。
- 修复后的定位依据要形成新的功能脚本修订，经验证后才成为当前业务版本的有效资产。

## 9. 断言与结果裁决

- `ai-e2e` 持有业务预期、硬断言和功能脚本最终通过/失败裁决。
- `proxy-adapter` 可以提供确定性的通用观测原语，例如 URL、标题、元素存在/可见、文本、值、数量与属性，并返回实际值和证据。
- 页面子代理可以组合观测判断复杂结果，但不能删除、放宽或改写任务包中的业务断言。
- 只有功能脚本全部硬断言通过，`ai-e2e` 才发布声明输出；模型自然语言中的“看起来成功”不构成通过。

## 10. 可视事件与操作动画

`proxy-adapter` 目标上发布与业务无关的通用事件：

- 会话和 Tab 创建、切换、关闭。
- 操作接收、排队、开始、完成、失败、取消和结果不确定。
- 目标解析成功、过期、歧义或不可操作。
- 截图、DOM 快照和其他产物生成。
- 动画开始和结束。

`ai-e2e` 以 correlation tags 将这些事件映射为场景、TODO、功能脚本和语义步骤时间线，并补充人类可读的业务说明。用户界面至少同时展示实时画面、当前步骤、操作状态和最近验证结果。

高亮、鼠标移动、点击波纹、输入、滚动与断言提示属于表现层：

- 动画延迟不能替代 Playwright 的可操作性等待和业务后置验证。
- 动画可配置速度或在快速模式跳过，但跳过动画不能改变执行语义和证据关联。
- 重放以已记录的语义步骤、原子操作结果和媒体时间信息为依据，不通过重新执行副作用动作模拟历史。

## 11. 暂停、中断与取消

| 控制 | 语义 |
|---|---|
| 暂停 | 主代理停止派发新操作；已开始的原子操作允许完成、明确失败或超时，然后生成检查点。恢复前必须重新检查页面、登录状态和可能副作用。 |
| 中断 | 终止当前 Agent 推理/工具循环；这不证明已经下发的浏览器动作未发生，仍需读取操作结果或进入 `outcome_unknown` 检查。 |
| 取消 | 取消未开始的 TODO 和排队操作；已完成的浏览器副作用不回滚。是否执行显式清理由主代理根据场景策略决定。 |
| 关闭浏览器 | 独立且具有破坏性的生命周期操作，只能由流程控制面显式执行；暂停、子代理结束或普通取消不自动等同于关闭。 |

现有 `ai-chat-service` 会话控制可以作为 Agent 层基础，但其 pause/interrupt/cancel 状态不能直接替代 E2E 的 TODO、执行尝试和浏览器操作状态。

## 12. Agent 上下文与恢复

- 默认每个页面任务创建干净的 `ai-chat-service` Agent 会话，显式注入任务包和获授权证据。
- 登出等可恢复中断后，只有主代理确认原会话仍有效、未越过恢复时限且页面/副作用检查通过，才可续用原会话；否则创建新会话并加载检查点。
- Agent 会话恢复不等同于浏览器操作重试。所有未决操作必须先按 `operationId` 查询结果。
- 页面任务完成后，模型对话只作为运行审计材料；可复用结论必须写入业务版本文档、页面资产或功能脚本修订。
- 视觉模型始终是单次调用：输入完整截图/DOM/问题，返回一次结构化分析，不持有任务租约或连续控制权。

## 13. 脚本修复闭环

当定位或交互因页面变化失效时：

1. 子代理保存失败步骤和当前页面证据。
2. 在任务授权范围内提出新的定位或交互方案。
3. 生成当前业务版本内的新功能脚本修订，不覆盖已执行修订。
4. `ai-e2e` 追加运行计划修订，将新的尝试绑定到新脚本修订。
5. 从已确认的语义检查点重新执行并验证。
6. 通过后更新当前有效修订及必要页面基线；失败则保留两个尝试的证据。

`proxy-adapter` 不感知“修复”语义，只执行新操作并返回观测与证据。

## 14. 当前实现差距

- `proxy-adapter` 已交付 application session、稳定 Tab、observe/control lease、`operationId` 去重、queued cancel、持久结果查询、重启 `outcome_unknown` 和 legacy 门禁；当前 MCP Server 共 15 个兼容工具 + 3 个受控 operation 工具。
- proxy 已交付受控 dom_snapshot、before/after screenshot、失败截图、内容寻址短期 artifact、完整性校验、browser session SSE/event-log 与会话范围 artifact GET；set_files、video、操作动画、control 原地续租、脱敏与保留清理 worker仍未实现。
- browser execution 事件已按 session 持久化单调 seq 并采用 snapshot-first SSE；ai-e2e 尚未消费并写入自身业务关联事件，因此跨服务业务时间线仍不完整。
- `ai-chat-service` 已交付独立受限 Agent task POST/GET/commands、持久状态、精确工具白名单、预算、结构化结果、模型不可见 browser binding、snapshot-first events/event-log 与单 Skill runtime；普通 Chat 继续过滤 3 个受控 operation 工具。ai-e2e 页面任务消费仍未实现。
- `ai-e2e` 当前主要调用 `/api/ai/generate`，旧 `ExecutorService` 仍通过 `npx tsx` 执行脚本，尚未进入上述 Agent + MCP 可视执行链。
- `ai-chat-service` 已实现调用方冻结的 `stepId/kind/operation/effectId` 门禁和 observe/control 检查；三服务仍未贯通风险投影、policy evaluation/active grant 与参数级数量交集。

## 15. 仍待实现设计

- Agent task、browser event/artifact、剩余动作/观测和跨服务证据关联已在 `service-api-event-contract.md` 锁定；proxy 的 session/lease/operation、真实截图/DOM artifact 与 browser event API，以及 ai-chat-service Agent task POST/GET/commands/events/event-log/capability/Skill catalog/runtime 已实现。ai-e2e 页面任务消费、Authoring/Run API/SSE 和跨服务业务关联仍未实现。
- proxy 已实现短期 opaque token + SHA-256 hash/process epoch 和自有 SQLite WAL operation ledger；不扩权续租、7 天保留、pin/引用保护和清理任务仍待实现。
- 动画媒体协议、播放速度和重放索引格式。
- 同时多身份、多 BrowserContext 与多 Tab 并发需要的隔离和调度模型；v1 单 Context、单活动身份不依赖该扩展。

## 16. 验收原则

1. 子代理无法操作任务包外的 Tab、工具、脚本或浏览器生命周期。
2. 首期任一浏览器执行会话最多只有一个有效写控制租约和一个活动副作用动作。
3. 同一 `operationId` 重放不会重复产生浏览器副作用；参数冲突会被拒绝。
4. 无法确认是否生效的动作进入 `outcome_unknown`，经副作用检查后才能决定下一步。
5. stale 或歧义目标不会退化为静默坐标点击。
6. 暂停、Agent 中断和取消不会被错误解释为浏览器动作回滚。
7. 每个步骤都能从 `ai-e2e` 时间线关联到 Agent 工具调用、`proxy-adapter` 原子操作和浏览器证据。
8. 动画开关不改变动作、断言和输出结果。
9. Agent 会话丢失后能从任务包、运行变量、检查点和操作账本重建，不依赖对话记忆恢复业务真相。
10. 修复产生新脚本修订和追加式运行计划修订，不覆盖既有尝试及其证据。
11. 首期同一 proxy 进程最多一个活动浏览器执行会话；observe 不与写操作竞争快照，UI live view 无控制权。
12. 首期一个会话只绑定一个 BrowserContext 和一个活动身份；跨角色切换必须由主代理显式编排认证脚本，子代理发现身份异常时停止上报。
13. 缺失、过期、撤销或投影不匹配的副作用授权不能获得 control 或发出写 operation；模型、Skill 与页面内容无法替换 effectId。
14. production 业务写在 proxy operation 前硬拒绝；staging 高风险计划只有当前 context/projection 的 active grant 才能执行，proxy 本身不持有环境策略。

## 17. 关联文档

- `requirements-baseline.md`：总体产品边界。
- `functional-script-contract.md`：语义步骤、输入输出、副作用与恢复契约。
- `scenario-orchestration-contract.md`：运行计划、TODO、尝试和依赖传播。
- `version-page-asset-contract.md`：业务版本、页面运行锚点和基线资产。
- `run-state-decision-evidence-contract.md`：运行/TODO/尝试状态、决策、证据与人工控制。
- `semantic-script-schema.md`：语义步骤、动作/断言白名单和目标引用机器格式。
- `target-data-model.md`：页面任务、执行尝试、操作关联、事件和证据引用的持久化结构。
- `service-api-event-contract.md`：三服务 API、Agent task、MCP 原子操作、事件与恢复协议。
- `ai-model-skill-contract.md`：双模型、视觉定位包和 Skills 权限协议。
- `asset-authoring-repair-contract.md`：authoring verification、运行前复核、影响分析和局部修复。
- `environment-side-effect-policy-contract.md`：环境矩阵、风险投影、计划级审批和跨服务门禁。
- `../PRODUCT-SPEC.md`：当前实现状态和目标缺口。
- `../../docs/PRODUCT-SPEC-INDEX.md`：跨包契约索引。
