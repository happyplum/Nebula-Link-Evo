# AI E2E 环境与副作用策略契约

> 状态：`in-progress`。Run/Authoring 已共用纯策略 evaluator 与唯一 policy repository，交付精确冻结、持久审批/grant、派发与恢复重验及终态失效；跨上下文复用、公共撤销 API、集合/上传执行与完整 repair 编排仍 pending。
> 更新时间：2026-10-03。
> 本文定义 semantic v1 正式运行与 authoring verification 的环境风险矩阵、副作用投影、计划级审批和跨服务执行门禁。它不授权旧 TypeScript 执行链或人工调试工具访问生产数据。逐调用执行门禁已贯通：ai-chat-service 预授权步骤包装在每次 dispatch 前校验 policy evaluation、风险投影 hash、active grant 与参数级数量交集并持久化操作记录（见 `service-api-event-contract.md` §4.1）。

## 1. 目标与边界

环境安全策略必须同时满足：

- 环境来自运行冻结的 immutable deployment revision，客户端、模型和脚本不能自行声明或降级环境。
- 所有可能改变认证会话或业务数据的语义步骤先声明副作用；无法分类、无法确定上限或与实际动作冲突时拒绝执行。
- local/test 可以自动运行边界清楚的已声明副作用；staging 对高风险计划只审批一次；production 只允许认证会话变化和只读行为。
- 审批只授权一个精确 run 或 authoring job 的安全相关计划投影，不是版本、账号或环境的永久通行证。
- 浏览器仍按原子操作推进、保留幂等与 `outcome_unknown` 检查；审批不能替代断言、副作用验证或重试约束。

本策略约束 `semantic_v1` 的 formal run、bootstrap/recheck/repair 中的真实浏览器验证；嵌套 verification run 的完整编排仍为目标。

## 2. 副作用与风险投影

### 2.1 脚本声明

每个副作用声明至少包含：

- `kind`：`create/update/delete/auth_change`。
- `resourceType` 与可验证 `identityFrom`。
- `affectedItems`：单项，或由输入解析且有静态上限的集合。
- `reversibility`：`reversible/compensatable/irreversible`。
- `verifyApplied`、`retryPolicy` 和可选清理脚本。

`auth_change` 只表示登录、退出或刷新认证会话，不包括修改密码、MFA、账号权限或用户资料；后者属于 `update`。`reversible` 需要能够确定性验证的逆向/清理能力；只有补偿动作或无法恢复完全一致状态时是 `compensatable`；其余必须声明 `irreversible`。

任何以下情况都不能进入运行计划：

- 可能提交表单、上传文件或改变服务端状态，却没有关联副作用声明。
- `identityFrom`、最大影响数量或副作用应用检查无法解析。
- 动作、PRD/模块需求、场景用途和副作用声明相互冲突。
- 使用“未知”“不限数量”或模型临时判断代替可计算影响边界。

静态检查无法证明一个点击绝不产生服务端写入；authoring 必须结合控件语义、PRD、网络/页面结果和真实验证检查声明。发现未声明写入时，candidate 失效并生成安全缺口，不能继续自动执行。

### 2.2 计划级风险投影

Run 与 Authoring 复用 `src/policy/side-effect-policy.ts` 的纯 evaluator；上下文各自按实际执行计划构建投影：

- Run 从冻结脚本修订与展开调用生成 effect，`affectedItems.single` 为 1，其他声明使用有限 `maxItems`，再乘固定 scenario repeat。每个 effect 保留 callKey、scriptRevisionId、stepId、effectId、kind、resourceType、maxAffectedItems、reversibility、usesFileUpload。
- Authoring 在 candidate 创建时冻结当前 amendment、candidate revision、实际验证 steps 与 deployment 的 hash。候选脚本与候选 scenario 引用的脚本按 script ID 去重，各执行一次，不展开 scenario repeat；声明只与实际脚本关联，不读取无关 workspace effect。
- 投影按规范 JSON 计算 hash；持久投影仅含脱敏风险字段和身份/hash，实际步骤参数仅参与 source plan hash，不复制 secret 或敏感原始参数到风险投影。

高风险为任一 effect 的 `delete`、`maxAffectedItems > 1`、`irreversible` 或 `usesFileUpload=true`。缺声明、数量非正整数或无有限上限时 fail closed。当前没有按相同资源汇总多个不同 effect 的全局聚合规则；该聚合属于 pending 目标。

`set_files` 与非 `single` 的 affectedItems 仍由 browser step builder 拒绝，当前不能实际执行上传或集合动作。纯 evaluator 的矩阵可评估上传风险和有界数量，这不代表执行能力已经开放。`runWhen`、`repeat.for_each` 同样未开放。

## 3. v1 环境矩阵

| 环境 | 认证会话变化 | 单项、非不可逆 create/update | 删除、批量、不可逆、上传 | 未声明/无界副作用 |
|---|---|---|---|---|
| `local` | 自动允许 | 自动允许 | 自动允许 | 拒绝 |
| `test` | 自动允许 | 自动允许 | 自动允许 | 拒绝 |
| `staging` | 自动允许 | 自动允许 | 运行/验证开始前一次计划级用户审批 | 拒绝 |
| `production` | 仅显式登录/退出/刷新会话 | 拒绝 | 拒绝 | 拒绝 |

共同门禁：

- “自动允许”仍要求脚本 static valid、目标 scope verified、allowed Origin、secret reference、actor、前置条件、幂等和副作用检查全部通过。
- production 可以导航、切换 Tab、填写显式认证脚本所需字段、执行只读观测和硬断言；禁止 create/update/delete、`set_files` 以及会提交业务数据的 click/press/select/check 等步骤。
- production 拒绝是硬策略，不创建审批请求，不提供 v1 临时越权或 break-glass。需要业务写入必须改用 local/test/staging 的精确 deployment revision。
- 环境标签不能由请求覆盖。修改 deployment profile 会产生新 revision，并使既有验证和审批投影失效。

## 4. staging 计划级审批

### 4.1 审批对象

当 staging 投影含高风险副作用时，系统在任何控制租约或写操作发出前创建一个 `category=side_effect_approval` 的用户决策请求。当前 Authoring 既有审批界面展示：环境、deployment revision、policy version、candidate revision、逐 effect 的 kind/resourceType/数量上限/可逆性/上传标记/stepId，以及 source plan/projection SHA-256。Run 继续展示其既有 decision 与脱敏 impact。

按资源跨 effects 聚合的数量、完整 Git/build/actor/清理脚本与证据摘要是待交付展示目标；当前不据此宣称全局聚合或额外执行能力。

用户批准后生成 `SideEffectApprovalGrantV1`：

```ts
interface SideEffectApprovalGrantV1 {
  schema: 'nebula.ai-e2e.side-effect-approval-grant/1.0';
  grantId: string;
  contextType: 'run' | 'authoring';
  contextId: string;
  businessVersionId: string;
  deploymentRevisionId: string;
  policyVersion: 'side-effect-policy/1.0';
  approvedProjectionSha256: string;
  decisionRequestId: string;
  decisionAnswerId: string;
  status: 'active' | 'revoked' | 'expired';
  approvedBy: string;
  approvedAt: string;
}
```

grant 只对当前 run 或 authoring job 有效，不能复制到业务版本、复用于下一次运行、跨 deployment 使用或作为长期版本决定。上下文终态、grant 非 active、deployment/policy、source plan 或投影变化时拒绝执行并失效。Authoring grant 精确绑定 amendment/candidate，不能借 scope approval 或同 job 的其他 candidate 授权。服务重启后从持久 grant 恢复，不要求重复点击审批。

> 当前实现：`SemanticPolicyRepository` 唯一持有 evaluation/grant 的创建、查询与失效 SQL，复用 migration 017，无 schema 变化。业务生命周期 owner 在同一事务使终态 grant 过期；policy 调用显式复用调用方事务，不开启嵌套 BEGIN，也不在 SQLite 事务内等待网络。没有公共 revoke API 或 TTL；持久 `revoked/expired` 均不能执行。重启恢复同一精确 grant；同 hash 重新批准创建独立 decision/answer/grant，保留 immutable evaluation 与旧 audit，重复旧 answer 不复活失效 grant。

### 4.2 计划修订与重新审批

当前授权要求 exact context、business version、deployment、source plan、projection 与 policy version 全部一致：

- locator、等待、证据步骤、数量缩小或删除步骤也可能改变 source plan；不复用旧候选 grant，不以投影子集或“任意已批准 decision”替代精确绑定。
- 范围扩展批准仅授权 scope，不代表副作用批准；两个 category 在既有 amendment decision API 与 UI 中分别展示/回答。
- Run grant 失效时暂停并创建新一轮精确审批；漂移到不同冻结身份的计划不能批准旧 decision。Authoring 调度/派发失效封存明确 failure，新的 candidate 使用独立冻结审批。
- 用户拒绝可以关闭已经漂移的旧审批；拒绝或取消不受执行授权检查阻拦，已发生副作用不自动回滚。
- Authoring 候选拒绝、失败（含硬策略 deny）、stale 或激活时，在生命周期事务内将该候选所有仍为 `open` 的决策置为 `withdrawn` 并递增 state version；保留已回答/已应用决策与 answer 审计，不关闭其他候选的审批。上下文切换逐候选收束，base revision 漂移的 stale 与 grant 失效同事务提交。
- 旧 amendment 的迟到校验只失效对应 evaluation/grant，不撤销新 amendment 的有效授权。

授权在 queue、verification scheduling、start/resume、lease 与 Agent dispatch 前重新验证；重启后的 create/resume outbox 同样重验持久 task 绑定。pause/cancel/revoke/close 清理继续执行。lease 已返回后任何重验异常均先持久化本次撤销意图并回收 token；撤销失败保留 secret 与 retryable outbox 供恢复。未派发 Agent 的已开始 attempt 由原工作流 owner 收束，不能留下永久 running 任务。

跨 locator/缩小计划复用及跨 context 父 Run grant 继承均仍 pending，当前不授权这些目标。

## 5. 运行与 authoring 行为

### 5.1 Formal run

1. 创建 run 并冻结 base plan。
2. 生成风险投影并读取 deployment revision 的 environment。
3. 无效/production 禁止计划写入 denied evaluation，将 run 封存为 `cancelled(side_effect_policy_denied)`，不申请 browser job/control；该结果是策略拒绝，不是业务测试失败。
4. staging 高风险计划进入 `paused(approval_required)`；批准后转 `ready`，拒绝后取消。
5. local/test 或 staging 低风险计划直接转 `ready`。
6. start/resume、TODO/lease/Agent 派发及 outbox 重放前核对精确 evaluation/grant；不匹配时停止在安全边界。

计划级审批发生在 TODO 执行前，不把审批拒绝伪装成业务测试失败。Run plan amendment 的完整修复编排仍 pending。

### 5.2 Authoring verification

- bootstrap/recheck/repair 的只读探索遵循各环境通用门禁，不点击无法判断副作用的控件。
- local/test 可以自动真实验证已声明、有界副作用；staging 高风险 verification plan 先做一次 job 级审批。
- production 只允许生成、静态校验和只读探索/断言。包含业务写入或上传的 candidate 可以保留为静态资产，但不能在 production scope 标记 `verified`，也不能让对应正式场景在该 scope 变为可运行。
- run-triggered repair 的父 grant 复用为 pending；当前 Authoring 使用自己的 exact job/amendment/source plan 授权，不继承父 Run grant。

## 6. 跨服务执行门禁

`ai-e2e` 是环境策略与 grant 的唯一权威：

1. 规划阶段拒绝未声明/无界/production 写计划。
2. 页面任务包只投影当前已授权 TODO、语义步骤、effectId、风险摘要和 grant 引用；不包含凭据或审批者敏感信息。
3. `ai-chat-service` 的 task/tool wrapper 每次调用前取 task allowlist、当前语义步骤、browser lease 和副作用授权的交集；staging 整体计划为 `approval_required` 时，即使当前 task 子集只含单项低风险动作，也必须携带 active 且 same-hash grant；当前子集高风险仍要求整体 `approval_required`。模型不能新增步骤、替换 effectId 或把只读任务改成写任务。
4. `proxy-adapter` 不理解 environment、actor、场景或审批，只按 lease 的通用 operation/Tab/target/args 约束和幂等账本执行。
5. `ai-e2e` 在写回 attempt 前核对 Agent tool summary、proxy operation ledger、脚本声明和 grant；不一致时结果失败或 `outcome_unknown`，不能发布输出。

v1 控制面是 loopback/local 单用户信任边界，但仍采用默认拒绝。未来开放远程/多用户后，`approvedBy` 和 `requiredAuthority` 必须接入统一身份、项目授权与租户隔离；不能把本地单用户决定记录当作远程认证。

## 7. 状态、API、事件与证据

- run 规划可走 `planning → paused(approval_required) → ready`（`planning` 为创建事务内瞬态、不独立落库，见 `run-state-decision-evidence-contract.md` §2.2 注记）；authoring job 使用 `waiting_decision`。恢复命令必须引用 applied 决策和 active grant（重查语义见 §4.1 注记）。
- API 错误至少区分 `side_effect_declaration_required`、`side_effect_bound_invalid`、`side_effect_policy_denied`、`side_effect_approval_required`、`side_effect_approval_stale` 和 `side_effect_approval_revoked`。其中 5 个（declaration_required/bound_invalid/approval_required/approval_stale/approval_revoked）已在 ai-e2e 路由层作为 ApiProblem code 发射；`side_effect_policy_denied` 保持 run 终止原因 JSON code 语义（创建返回 201+cancelled）。
- Run/Authoring 事件发射 `side_effect_policy.evaluated`；审批生命周期不使用独立 `side_effect_approval.*` token，而由 `category=side_effect_approval` 的 decision 承载（与 `service-api-event-contract.md` §6 的实际事件集一致：attempt 级决策发射 `decision.requested/applied`；run 创建时的审批请求由 snapshot bootstrap 与 `run.lifecycle_changed` 承载、不发射 `decision.requested`；authoring 侧仅发射 `decision.applied`）。事件只含脱敏投影摘要和 hash。
- snapshot 展示当前环境、策略版本、风险汇总、审批状态、批准范围和投影是否 stale。
- policy evaluation、决策、grant、每次使用的 TODO/effectId、最终副作用和证据 manifest 形成同一审计链。
- approval/grant 不进入业务版本 copy；运行删除时保留脱敏审批墓碑的规则与其他决策一致。

## 8. 验收原则

1. local/test 的已声明、有界副作用无需人工点击即可执行；未声明或无界写入在浏览器动作前被拒绝。
2. staging 的单项非不可逆 create/update 自动运行；删除、批量、不可逆或上传只出现一次计划级审批，不逐步骤重复询问。
3. staging 精确 source plan/projection/context/deployment/policy 不一致时旧 grant 无法使用；新 candidate（包括 locator 修订）需要自己的精确审批。
4. production 可以完成登录、导航、只读检查和断言，任何业务 create/update/delete 或文件上传都在 control lease/写操作前被硬拒绝，且不存在审批绕过。
5. deployment revision、policy version、context 或 projection 不匹配的 grant 无法恢复或执行。
6. 用户拒绝/撤销后没有新的写操作被派发；已开始原子操作按安全边界收敛，既有副作用不会被伪装回滚。
7. authoring verification 与 formal run 使用同一矩阵；mock、shadow plan 或其他环境通过不能替代当前 scope 的真实授权验证。
8. Agent、Skill、页面内容或视觉结果无法扩大副作用授权；proxy 保持通用且不持有 E2E 环境策略。

## 9. 关联文档

- `requirements-baseline.md`：总体产品边界与执行原则。
- `semantic-script-schema.md`：副作用、数量边界、可逆性和静态校验字段。
- `scenario-orchestration-contract.md`：风险投影、计划修订和 TODO 状态。
- `run-state-decision-evidence-contract.md`：审批决策、暂停、证据和人工控制。
- `target-data-model.md`：policy evaluation、grant、run 与 authoring 持久化。
- `service-api-event-contract.md`：API、事件和跨服务门禁。
- `asset-authoring-repair-contract.md`：真实验证与局部修复复用/重新审批。
- `agent-browser-execution-contract.md`：页面任务、工具授权和 proxy 通用边界。
