# AI E2E 环境与副作用策略契约

> 状态：`in-progress`。正式 Run 已交付确定性风险投影、policy evaluation、staging 审批/active grant、production 业务写拒绝及逐 effectId/数量/grant 跨服务门禁；Authoring 全流程统一投影与撤销传播仍未完成。
> 更新时间：2026-08-12。
> 本文定义 semantic v1 正式运行与 authoring verification 的环境风险矩阵、副作用投影、计划级审批和跨服务执行门禁。它不授权旧 TypeScript 执行链或人工调试工具访问生产数据。数据表与部分仓储存在不等于安全门禁已启用；ai-chat-service 的预授权步骤包装及 ai-e2e 的 evaluation 账本尚未串成 active grant 与参数级数量交集执行链。

## 1. 目标与边界

环境安全策略必须同时满足：

- 环境来自运行冻结的 immutable deployment revision，客户端、模型和脚本不能自行声明或降级环境。
- 所有可能改变认证会话或业务数据的语义步骤先声明副作用；无法分类、无法确定上限或与实际动作冲突时拒绝执行。
- local/test 可以自动运行边界清楚的已声明副作用；staging 对高风险计划只审批一次；production 只允许认证会话变化和只读行为。
- 审批只授权一个精确 run 或 authoring job 的安全相关计划投影，不是版本、账号或环境的永久通行证。
- 浏览器仍按原子操作推进、保留幂等与 `outcome_unknown` 检查；审批不能替代断言、副作用验证或重试约束。

本策略约束 `semantic_v1` 的 formal run、bootstrap/recheck/repair 中的真实浏览器验证及其嵌套 run。

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

运行计划冻结后，`ai-e2e` 从精确脚本修订、展开 TODO、重复次数、输入约束、actor 和计划修订确定性生成 `SideEffectRiskProjectionV1`：

```ts
interface SideEffectRiskProjectionV1 {
  schema: 'nebula.ai-e2e.side-effect-risk-projection/1.0';
  contextType: 'run' | 'authoring';
  contextId: string;
  businessVersionId: string;
  deploymentRevisionId: string;
  environment: 'local' | 'test' | 'staging' | 'production';
  policyVersion: 'side-effect-policy/1.0';
  effects: PlannedSideEffectV1[];
  containsFileUpload: boolean;
  projectionSha256: string;
}

interface PlannedSideEffectV1 {
  todoKey: string;
  scriptRevisionId: string;
  stepId: string;
  effectId: string;
  kind: 'create' | 'update' | 'delete' | 'auth_change';
  resourceType: string;
  actorKey?: string;
  maxAffectedItems: number;
  reversibility: 'reversible' | 'compensatable' | 'irreversible';
  usesFileUpload: boolean;
}
```

投影按规范 JSON 计算 hash，不包含 secret 值、真实密码、Token、完整上传内容或敏感资源标识。重复/`for_each` 展开后按最坏有界数量聚合；`maxAffectedItems > 1`、集合型动作或同一计划对同类资源执行多个写入时均视为批量。数量无法给出有限上限时，所有环境都拒绝计划。

高风险副作用是任一：

- `delete`；
- 批量写入；
- `irreversible`；
- `set_files`/文件上传；
- 计划或证据无法确认精确资源范围的写入。

最后一类不能仅靠审批放行：范围无法收敛时是无效计划；只有范围已经收敛、但因删除/批量/不可逆/上传而高风险时才进入 staging 审批。

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

当 staging 投影含高风险副作用时，系统在任何控制租约或写操作发出前创建一个 `category=side_effect_approval` 的用户决策请求。审批界面至少展示：

- 业务版本、场景或 authoring job、精确 deployment/Git/build、actor 和策略版本。
- 按资源类型聚合的 create/update/delete 数量上限。
- 删除、不可逆、补偿能力、文件上传和清理脚本摘要。
- 精确受影响 TODO/脚本/步骤以及拒绝后的结果。
- 脱敏证据与 `projectionSha256`。

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

grant 只对当前 run 或 authoring job 有效，不能复制到业务版本、复用于下一次运行、跨 deployment 使用或作为长期版本决定。上下文终态、用户撤销、deployment/policy 改变或安全相关投影扩大时立即失效。服务重启后从持久 grant 恢复，不要求重复点击审批。

### 4.2 计划修订与重新审批

每次 base plan 或 amendment 变化都重新计算风险投影：

- 只改变 locator、等待、证据采集或其他不影响副作用的字段，`projectionSha256` 不变，可继续使用原 grant。
- 删除已批准高风险步骤或缩小数量可以继续使用原 grant，但投影和审计必须显示实际子集。
- 新增副作用、扩大数量/资源/actor、增加上传、从可补偿变为不可逆或改变 deployment/policy 时，原 grant 变为 `expired`，运行在安全边界暂停并重新请求一次计划级审批。
- 用户拒绝审批时，不派发任何未开始的浏览器写操作；formal run 取消并记录 `approval_denied`，authoring job 取消或以未验证结果结束。已经发生的副作用不自动回滚。

审批不是逐步骤确认。grant 有效期间，投影内各步骤按正常串行执行；每次派发仍校验当前 TODO、effectId、数量边界和 grant 状态。

## 5. 运行与 authoring 行为

### 5.1 Formal run

1. 创建 run 并冻结 base plan。
2. 生成风险投影并读取 deployment revision 的 environment。
3. 无效/production 禁止计划写入 denied evaluation，将 run 封存为 `cancelled(side_effect_policy_denied)`，不申请 browser job/control；该结果是策略拒绝，不是业务测试失败。
4. staging 高风险计划进入 `paused(approval_required)`；批准后转 `ready`，拒绝后取消。
5. local/test 或 staging 低风险计划直接转 `ready`。
6. 每次 amendment 与写步骤派发前重新评估；grant 不匹配时停止在安全边界。

计划级审批发生在 TODO 执行前，不把某个 TODO 伪装成业务失败。中途新增高风险 amendment 时，受影响 TODO 使用 `waiting_decision`，run 进入 `paused`；独立分支也不继续写浏览器，直到全局安全投影收敛。

### 5.2 Authoring verification

- bootstrap/recheck/repair 的只读探索遵循各环境通用门禁，不点击无法判断副作用的控件。
- local/test 可以自动真实验证已声明、有界副作用；staging 高风险 verification plan 先做一次 job 级审批。
- production 只允许生成、静态校验和只读探索/断言。包含业务写入或上传的 candidate 可以保留为静态资产，但不能在 production scope 标记 `verified`，也不能让对应正式场景在该 scope 变为可运行。
- run-triggered repair 若只修改定位且风险投影不变，沿用父 run grant；改变副作用契约或扩大影响面时暂停父 run 并重新审批。

## 6. 跨服务执行门禁

`ai-e2e` 是环境策略与 grant 的唯一权威：

1. 规划阶段拒绝未声明/无界/production 写计划。
2. 页面任务包只投影当前已授权 TODO、语义步骤、effectId、风险摘要和 grant 引用；不包含凭据或审批者敏感信息。
3. `ai-chat-service` 的 task/tool wrapper 每次调用前取 task allowlist、当前语义步骤、browser lease 和副作用授权的交集；模型不能新增步骤、替换 effectId 或把只读任务改成写任务。
4. `proxy-adapter` 不理解 environment、actor、场景或审批，只按 lease 的通用 operation/Tab/target/args 约束和幂等账本执行。
5. `ai-e2e` 在写回 attempt 前核对 Agent tool summary、proxy operation ledger、脚本声明和 grant；不一致时结果失败或 `outcome_unknown`，不能发布输出。

v1 控制面是 loopback/local 单用户信任边界，但仍采用默认拒绝。未来开放远程/多用户后，`approvedBy` 和 `requiredAuthority` 必须接入统一身份、项目授权与租户隔离；不能把本地单用户决定记录当作远程认证。

## 7. 状态、API、事件与证据

- run 规划可走 `planning → paused(approval_required) → ready`；authoring job 使用 `waiting_decision`。恢复命令必须引用 applied 决策和 active grant。
- API 错误至少区分 `side_effect_declaration_required`、`side_effect_bound_invalid`、`side_effect_policy_denied`、`side_effect_approval_required`、`side_effect_approval_stale` 和 `side_effect_approval_revoked`。
- Run/Authoring 事件至少增加 `side_effect_policy.evaluated`、`side_effect_approval.requested/granted/revoked/expired`；事件只含脱敏投影摘要和 hash。
- snapshot 展示当前环境、策略版本、风险汇总、审批状态、批准范围和投影是否 stale。
- policy evaluation、决策、grant、每次使用的 TODO/effectId、最终副作用和证据 manifest 形成同一审计链。
- approval/grant 不进入业务版本 copy；运行删除时保留脱敏审批墓碑的规则与其他决策一致。

## 8. 验收原则

1. local/test 的已声明、有界副作用无需人工点击即可执行；未声明或无界写入在浏览器动作前被拒绝。
2. staging 的单项非不可逆 create/update 自动运行；删除、批量、不可逆或上传只出现一次计划级审批，不逐步骤重复询问。
3. staging 计划增加高风险影响后旧 grant 失效；纯 locator 修复不触发重复审批。
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
