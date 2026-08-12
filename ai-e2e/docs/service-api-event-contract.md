# AI E2E 跨服务 API 与事件契约

> 状态：已确认目标设计，部分实现。
> 更新时间：2026-08-12。
> 本文固定 `ai-e2e`、`ai-chat-service` 与 `proxy-adapter` 的目标调用面、事件信封、幂等和恢复语义。`proxy-adapter` 已交付 `/api/v1/capabilities`、browser session/lease/operation query 和 `operation_execute/get/cancel` 核心；browser event/artifact/capture/续租、ai-chat Agent task/capability 与 ai-e2e v1 API/事件仍未实现。现有 `/api/ai/generate`、项目级 SSE 和 15 个兼容浏览器 MCP 工具继续存在；各节必须按实际状态描述。

## 1. 设计目标

- `ai-e2e` 是测试流程、TODO、业务结果、决策与长期证据的唯一权威服务。
- `ai-chat-service` 只执行受限 Agent 任务、模型调用、单次视觉分析和 Skills，不解释 E2E 业务状态。
- `proxy-adapter` 只托管浏览器执行会话、Tab、控制租约、原子操作、实时画面和短期原始产物。
- 所有跨服务写操作可幂等重放，服务重启后可查询事实并收敛，不依赖一次 HTTP/SSE 连接持续存活。
- 现有 Chat SSE、Debug SSE 与项目阶段 SSE 保持兼容；目标 Authoring、Run、Agent task 和 Browser session 四类 SSE 各自 snapshot-first、各自单调序号，不共享业务状态或恢复游标。

## 2. 通用传输规范

### 2.1 版本与编码

- 新接口统一使用 `/api/v1`；MCP 仍通过 `POST /mcp` 暴露。
- JSON 字段使用 camelCase，时间使用 UTC RFC 3339，身份使用不可猜测 UUID。
- Schema ID 使用 `nebula.<domain>/<major>.<minor>`；同一 major 只允许向后兼容新增字段。
- 未知可选字段应忽略，未知枚举值和未知必填字段必须拒绝，不能静默降级。

### 2.2 成功与错误

普通成功响应：

```ts
interface ApiSuccess<T> {
  data: T;
  meta: {
    requestId: string;
    correlationId?: string;
    stateVersion?: number;
  };
}
```

错误响应：

```ts
interface ApiProblem {
  code: string;
  message: string;
  retryable: boolean;
  correlationId: string;
  details?: Record<string, unknown>;
}
```

错误码至少区分：`validation_failed`、`not_found`、`state_conflict`、`idempotency_conflict`、`permission_denied`、`browser_busy`、`lease_expired`、`budget_exceeded`、`dependency_unavailable`、`outcome_unknown`、`side_effect_declaration_required`、`side_effect_bound_invalid`、`side_effect_policy_denied`、`side_effect_approval_required`、`side_effect_approval_stale`、`side_effect_approval_revoked` 和 `internal_error`。响应不得包含 secret、控制租约 token、完整 DOM 或模型原始机密输入。

### 2.3 请求头与并发控制

| 请求头 | 规则 |
|---|---|
| `X-Correlation-ID` | 调用链关联；缺失时入口服务生成并在下游传播。 |
| `Idempotency-Key` | 所有创建、复制、运行命令和外部任务创建必填；同 key 同请求 hash 返回原结果，不同 hash 返回 `409 idempotency_conflict`。 |
| `If-Match` | 修改已有运行状态、回答决策、暂停/恢复/取消时携带当前 `stateVersion`；不匹配返回 `409 state_conflict`。 |

幂等响应必须覆盖所属测试流程全部非终态生命周期，并在终态后默认保留 7 天；被未解决决定、`outcome_unknown` 或人工 pin 引用时继续保留。更长期审计由 `ai-e2e` 的 operation link/evidence manifest 保存，不要求 proxy 热账本与 30 天媒体保留期完全一致；记录不得因进程重启清空。

### 2.4 能力协商

三项服务均目标提供 `GET /api/v1/capabilities`：

```ts
interface ServiceCapabilitiesV1 {
  schema: 'nebula.service-capabilities/1.0';
  service: 'ai-e2e' | 'ai-chat-service' | 'proxy-adapter';
  serviceVersion: string;
  protocols: Record<string, { major: number; minor: number }>;
  features: Record<string, boolean | string | number>;
  limits: Record<string, number>;
  generatedAt: string;
}
```

- `ai-chat-service` 至少声明 agent-task、vision、skill-manifest 协议版本、可用模型角色和逐工具调用的副作用授权校验能力；它不声明环境矩阵，也不签发审批。
- `proxy-adapter` 至少声明 browser-execution/operation 协议、受支持动作/观测、持久账本和可视画面能力；v1 还必须声明 `maxActiveBrowserSessions=1`、`maxBrowserContextsPerSession=1` 且不支持运行中 storage-state 切换。它只执行通用 lease/operation 约束，不解释环境或审批。
- `ai-e2e` 至少声明 `side-effect-policy/1.0`、四类环境矩阵和审批协议；在创建 run 前执行并缓存短期依赖 preflight，确认 major 兼容、所需功能/Skill/hash 可用。不兼容时返回 `503 dependency_unavailable`，不得在同一 run 静默回退旧执行器。
- capability 只说明能力，不包含 provider key、lease token、文件路径或其他机密。

### 2.5 首期信任边界

- v1 控制面按当前产品形态只允许 loopback/local 单用户部署；`ai-e2e`、`ai-chat-service` 与 `proxy-adapter` 的控制路由不得直接暴露到非受信网络。
- capability、Origin 检查、lease 和幂等键都不等同于身份认证。只要需要非 loopback、远程访问或多用户共享，就必须先新增统一身份、项目/版本授权、租户隔离、审计主体和 secret 访问控制协议；在该协议验收前 semantic authoring/run 默认拒绝启动。
- 反向代理若存在，只能位于受信本机边界内，并保持 SSE、请求体限制和不可伪造调用方身份；本文不把“有反向代理”视为已经具备 auth。

## 3. `ai-e2e` 对外业务 API

### 3.1 业务资产

目标路由：

| Method | Path | 语义 |
|---|---|---|
| POST | `/api/v1/projects/:projectId/business-versions` | 创建空白业务版本或由指定来源复制；创建与 copy 都要求幂等键。 |
| GET | `/api/v1/projects/:projectId/business-versions` | 查询业务版本列表。 |
| GET | `/api/v1/business-versions/:versionId` | 读取版本、来源、部署/Git 标识、有效性和 current asset 摘要。 |
| POST | `/api/v1/business-versions/:versionId/copy` | 原子深复制当前有效资产并重建内部 ID。 |
| POST | `/api/v1/business-versions/:versionId/validate` | 执行 Schema、引用、页面签名、调用图和待重检校验，不启动浏览器运行，也不能单独授予可运行 valid。 |
| GET/POST | `/api/v1/business-versions/:versionId/pages` | 列表或创建页面定义。 |
| GET/POST | `/api/v1/business-versions/:versionId/modules` | 列表或创建业务/功能模块。 |
| GET/POST | `/api/v1/business-versions/:versionId/functional-scripts` | 列表或创建稳定脚本身份。 |
| GET/POST | `/api/v1/business-versions/:versionId/scenarios` | 列表或创建稳定场景身份。 |
| GET | `/api/v1/assets/:assetType/:assetId/revisions` | 查询不可变修订历史、current、静态校验和按 scope 派生的验证摘要。 |
| GET | `/api/v1/assets/:assetType/:assetId/revisions/:revisionId` | 读取精确 payload/hash、来源、依赖闭包、验证记录与引用摘要。 |
| POST | `/api/v1/assets/:assetType/:assetId/revisions` | 创建不可变修订；`assetType` 只允许登记的资产类型。 |
| POST | `/api/v1/assets/:assetType/:assetId/revisions/:revisionId/activate` | 校验后切换唯一 current；功能脚本/场景还要求真实验证，copy 的 stale current 只能由系统事务创建；要求 `If-Match`。 |

部署 profile 是 project-scoped 稳定资产，通过 `/api/v1/projects/:projectId/deployment-profiles` 及其 revision 路由管理；业务版本只绑定精确 deployment revision，不复制 secret 值。

资产生成/复核/修复使用独立耐久工作流：

| Method | Path | 语义 |
|---|---|---|
| POST | `/api/v1/business-versions/:versionId/authoring-jobs` | 创建 bootstrap/recheck/repair/import_conversion job。 |
| GET | `/api/v1/authoring-jobs/:jobId` | 读取 authoring snapshot、coverage 和 active task。 |
| POST | `/api/v1/authoring-jobs/:jobId/commands` | `start/pause/resume/cancel`。 |
| GET | `/api/v1/authoring-jobs/:jobId/events` | snapshot-first authoring SSE。 |
| GET | `/api/v1/authoring-jobs/:jobId/event-log?afterSeq=N&limit=M` | 持久 authoring event log。 |
| POST | `/api/v1/authoring-jobs/:jobId/decisions/:decisionId/answer` | 回答 authoring decision；长期影响同步 version decision。 |

完整阶段、coverage、candidate 验证和激活规则见 `asset-authoring-repair-contract.md`。

`parentRunId` 只允许 `mode=repair` 且必须引用同业务版本的非终态 formal run。普通 UI/API 请求不能把任意 run 伪装成嵌套修复；run-triggered repair 由服务端根据 preflight/失败事实创建或签发一次性关联授权。

### 3.2 测试流程

```ts
interface CreateRunRequestV1 {
  schema: 'nebula.ai-e2e.create-run/1.0';
  businessVersionId: string;
  scenarioRevisionId: string;
  deploymentRevisionId: string;
  inputs: Record<string, unknown>;
  secretRefs?: Record<string, string>;
  evidencePolicy?: 'default' | 'extended' | 'minimal';
}
```

公开 CreateRun 只创建 `purpose=formal`：必须确认所选 deployment revision + 当前 asset graph + Git/build/角色/locale/viewport scope 存在 `business_version_validations.status=valid`，所引用 current 脚本/场景均 static valid 且有匹配的 `asset_revision_verifications.status=verified`，并冻结精确 revision/hash。`needs_recheck`、stale 或 candidate 资产只能由 authoring coordinator 创建内部 `purpose=authoring_verification` run，不能经正式 Run API 绕过门禁。

创建事务还必须冻结 `side-effect-policy/1.0` 风险投影并持久化 evaluation：local/test 与 staging 低风险计划进入 `ready`；staging 高风险计划创建一次 `side_effect_approval` 决策并进入 `paused(approval_required)`，且不申请 browser job/control；production 业务写计划直接封存为 `cancelled(side_effect_policy_denied)`，不创建审批、不申请 browser job/control。策略拒绝是可审计的运行终止原因，不是业务断言失败。

verification scope 由服务端从精确 deployment revision、冻结的 Git/build、场景/角色要求、locale、viewport、baseline 与策略 major 确定性生成；客户端不能直接提交 scope hash 冒充已验证环境。

场景 actor、初始认证态和每个调用的认证前置/结果状态来自精确场景修订；`secretRefs` 只解析显式登录脚本所需的凭据输入。创建计划时必须证明认证变化节点形成单一依赖链并可从初始态到达，不能由客户端传一个“当前已登录”标志绕过页面复检。

| Method | Path | 语义 |
|---|---|---|
| POST | `/api/v1/projects/:projectId/runs` | 创建流程、冻结计划并展开 TODO；不隐式开始。 |
| GET | `/api/v1/runs/:runId` | 返回权威 `RunSnapshotV1`。 |
| GET | `/api/v1/runs/:runId/plan` | 返回基础计划和追加式 amendments。 |
| GET | `/api/v1/runs/:runId/todos` | 返回 TODO、依赖、尝试和下游影响投影。 |
| GET | `/api/v1/runs/:runId/decisions` | 返回决策请求和答案。 |
| GET | `/api/v1/runs/:runId/evidence` | 返回 manifest 和授权后的产物链接，不内联大媒体。 |
| POST | `/api/v1/runs/:runId/commands` | 提交 `start/pause/resume/cancel/close_browser` 命令。 |
| POST | `/api/v1/runs/:runId/decisions/:decisionId/answer` | 回答一次开放决策；影响需求的答案应用时追加版本决定。 |
| GET | `/api/v1/runs/:runId/events` | Run SSE；每次连接先发完整 snapshot，再发 live event。 |
| GET | `/api/v1/runs/:runId/event-log?afterSeq=N&limit=M` | 审计和补洞读取持久事件，不替代 snapshot bootstrap。 |

`POST /commands` 请求：

```ts
interface RunCommandRequestV1 {
  schema: 'nebula.ai-e2e.run-command/1.0';
  commandId: string;
  action: 'start' | 'pause' | 'resume' | 'cancel' | 'close_browser';
  reason?: string;
}
```

`cancel` 不隐式关闭浏览器；`close_browser` 是独立破坏性命令。`start/resume` 必须先重新检查浏览器会话、页面、登录状态、未决副作用、当前 policy evaluation 和所需 active grant；审批缺失、过期、撤销或投影不匹配时拒绝命令并停在安全边界。

## 4. `ai-chat-service` 受限 Agent 任务 API

### 4.1 创建任务

目标路由：

| Method | Path | 语义 |
|---|---|---|
| POST | `/api/v1/agent-tasks` | 创建并开始一个受限任务。 |
| GET | `/api/v1/agent-tasks/:taskId` | 读取任务状态、预算、结构化结果和终止原因。 |
| POST | `/api/v1/agent-tasks/:taskId/commands` | `pause/resume/interrupt/cancel`；不推断浏览器操作回滚。 |
| GET | `/api/v1/agent-tasks/:taskId/events` | Agent 任务 SSE；先发 `agent_task.snapshot`。 |
| GET | `/api/v1/agent-tasks/:taskId/event-log?afterSeq=N&limit=M` | 读取持久 Agent 审计事件。 |

```ts
interface CreateAgentTaskRequestV1 {
  schema: 'nebula.ai.agent-task/1.0';
  clientTaskId: string;
  modelRole: 'decision';
  input: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  toolPolicy: {
    allow: string[];
    constraints?: Record<string, Record<string, unknown>>;
  };
  skillPolicy: {
    allow: { skillId: string; version: string; contentHash: string }[];
  };
  budgets: {
    maxDurationMs: number;
    maxModelTurns: number;
    maxToolCalls: number;
    maxTokens?: number;
  };
  browserBinding?: {
    browserSessionId: string;
    tabId: string;
    browserLeaseId: string;
    browserLeaseToken: string;
    access: 'observe' | 'control';
  };
  correlation?: Record<string, string>;
}
```

约束：

- `input` 在任务开始后不可变；业务输入和页面任务包由 `ai-e2e` 生成。
- 页面任务 `input` 必须包含所需 actor、派发时已确认认证态和本任务允许的认证状态变化；只包含 actorKey/角色和 secret reference，不包含凭据值。子代理不得据此自行扩展登录或切换身份。
- 任何可能写浏览器的页面任务 `input` 还必须包含策略版本、policy evaluation 引用、风险投影 hash、当前脚本步骤对应的 effectId/数量边界，以及 staging 高风险时的 active grant 引用；这些字段不可由模型生成或覆盖。
- `correlation` 对 `ai-chat-service` 不透明，只允许受限字符串；不能决定业务流程。
- `responseSchema` 必须受平台大小、深度和关键字白名单约束，防止任意递归 Schema。
- `browserBinding` 是模型不可见的执行能力；`observe` 只能读取 snapshot/页面状态，`control` 才能提交 act。租约 token 只存在于受限任务运行态或 secret store，不进入模型消息、普通日志、事件 payload 或数据库明文字段。
- 工具包装层注入 session、Tab、租约、operation/correlation 元数据，并在每次调用前校验“task allowlist ∩ 当前语义步骤 ∩ effectId/数量边界 ∩ active grant ∩ browser lease”；模型不能覆盖、替换 effectId 或把只读步骤改为写步骤。
- 默认每个页面任务创建新 Agent task。恢复只接受调用方提供的显式 checkpoint，不依赖旧对话隐式记忆。

任务状态为 `created/running/paused/completed/failed/interrupted/cancelled/blocked`。终态结果至少包含 `status`、`terminationReason`、符合 `responseSchema` 的 `output`、工具调用摘要、Skill 版本/hash 和预算消耗。Agent task 的 `completed` 只表示结构化任务完成，不等于 E2E TODO 通过。

现有 `POST /api/ai/generate` 继续服务纯文本生成；它不得被扩展为隐式拥有无限工具的 E2E 执行入口。

## 5. `proxy-adapter` 浏览器执行控制面

### 5.1 HTTP 生命周期与查询

| Method | Path | 语义 |
|---|---|---|
| POST | `/api/v1/browser-execution/sessions` | 创建或绑定一个可视浏览器执行会话；v1 会话固定一个 BrowserContext。 |
| GET | `/api/v1/browser-execution/sessions/:sessionId` | 读取会话、Tab、active observe/control lease 和画面能力摘要。 |
| DELETE | `/api/v1/browser-execution/sessions/:sessionId` | 显式关闭；需要生命周期权限与幂等键。 |
| POST | `/api/v1/browser-execution/sessions/:sessionId/leases` | 签发 `observe/control` 租约，限制 Tab、操作与期限；首期最多一个 control。 |
| DELETE | `/api/v1/browser-execution/sessions/:sessionId/leases/:leaseId` | 撤销租约；已开始操作继续到安全边界。 |
| GET | `/api/v1/browser-execution/sessions/:sessionId/events` | 浏览器会话 SSE；先发 `browser_session.snapshot`。 |
| GET | `/api/v1/browser-execution/sessions/:sessionId/event-log?afterSeq=N&limit=M` | 查询持久操作事件。 |
| GET | `/api/v1/browser-execution/operations/:operationId` | 查询原子操作账本和最终/不确定结果。 |
| GET | `/api/v1/browser-execution/artifacts/:artifactId` | 读取受授权的短期原始产物或下载链接。 |

当前实现状态：session 创建/读取/关闭、lease 签发/撤销和 operation 查询已交付；session SSE、event-log 与 artifact GET 仍为 pending。当前 observe/control 创建、opaque token hash/process epoch、单 session 门禁和 SQLite operation ledger 已生效，control 原地续租与账本保留清理尚未实现。

浏览器执行会话是应用层身份，与当前 stateless StreamableHTTP MCP transport session 无关。MCP 传输可以每个请求新建 server，仍必须依据 application-level session、lease 和 operation ledger 执行。

首期 `ai-e2e` 通过持久 `browser_jobs.queue_seq` 持有 authoring/test browser job 的公平 FIFO，只把队首提交给 proxy；重启后从队列状态和外部 session link 收敛，不靠内存重新排序。`proxy-adapter` 不解释业务 job 类型，只用通用独占门禁保证每进程全局最多一个活动 browser execution session，并在 capability 声明 `maxActiveBrowserSessions=1`。其他创建请求返回 `browser_busy`，不能创建逻辑多 session 共享 singleton Context。observe lease 只能在原子操作安全边界供主代理分析；UI 实时画面是无控制权的只读流。

v1 每个 application session 从创建到释放只能绑定一个 `BrowserContext`。同一 Context 可串行操作多个 Tab，但 API 不提供运行中 Context 切换、storage-state 导入/替换或并存认证 Context；业务 actor 由 `ai-e2e` 根据登录/退出脚本的确定性断言维护，不能下沉给 proxy 解释。

活动 application session 期间，现有兼容 MCP/debug 写工具必须返回 `browser_busy`，不能绕过 lease 操作同一 Context。MJPEG/LiveKit/事件等只读实时流继续可用；直接 DOM/截图观测只能走受控 observe operation，或返回最近一次已封存的安全快照。session 释放后 legacy 工具恢复原行为。

正式 run 触发的 repair 作为关联 `parentRunId` 的嵌套 authoring job，在安全边界沿用父 run 当前 browser job/session，不创建第二个活动 session，也不排入父 run 自己后方；无关 job 仍留在 FIFO。父 run 暂停并释放 control 后，内部 verification run 才可取得 control；repair 验证成功并释放子租约后，由 `ai-e2e` 追加精确 revision 的 run plan amendment。

租约与账本首期固定实现：

- 租约使用 32-byte CSPRNG opaque bearer token，不使用自包含 JWT。响应只返回一次明文 token；proxy 仅持久化 SHA-256 hash、policy、expiry 和 process epoch，其他服务只保存 secret binding/ref 或受限任务内存。
- `observe` 默认最长 30 秒，限定一次指定 snapshot/观测集合；`control` 单次最长 5 分钟，由 `ai-e2e` 在原子操作安全边界续租。续租不能扩大 Tab、operation 或参数策略，扩大授权必须撤销后重发并记录决策。
- proxy 重启递增 process epoch，使全部旧租约失效；持久 session/operation 事实仍可查询，但不能凭旧 token 恢复 Context/Cookie。
- operation ledger 使用 proxy 自有 SQLite WAL（不与其他服务共享）：动作前事务写入 operation ID、request hash、lease/session/Tab、queued 状态和 sequence，状态/结果/产物引用追加更新。崩溃后 started 且无充分完成证据的记录收敛为 `outcome_unknown`。
- 清理遵循第 2.3 节保留规则；任何被非终态流程、未知结果、决策或 evidence manifest 引用的记录不得提前删除。

### 5.2 MCP 工具

现有 15 个 `browser-control.*` 工具继续服务调试/兼容调用。以下 3 个受控工具已在 proxy MCP Server 交付；`ai-chat-service` 普通 Chat 明确过滤它们，E2E 受限任务必须等待模型不可见 wrapper 注入 browser binding 后才能调用：

| MCP tool | 语义 |
|---|---|
| `browser-control.operation_execute` | 执行一次白名单观测或动作，使用 `operationId` 幂等。 |
| `browser-control.operation_get` | 查询已提交操作，恢复时必须先查账本。 |
| `browser-control.operation_cancel` | 只取消尚未开始的 queued 操作；已开始操作返回不可取消。 |

`operation_execute` 的逻辑输入：

```ts
interface BrowserOperationRequestV1 {
  schema: 'nebula.browser.operation/1.0';
  operationId: string;
  leaseSequence: number;
  deadlineAt: string;
  kind: 'observe' | 'act';
  operation: string;
  target?: TargetRefV1;
  args?: Record<string, unknown>;
  capture?: {
    beforeScreenshot?: boolean;
    afterScreenshot?: boolean;
    domSnapshot?: boolean;
    videoSegment?: boolean;
  };
  presentation?: {
    label?: string;
    animation: 'normal' | 'fast' | 'off';
  };
}
```

上述是 proxy 接收的完整逻辑输入。E2E 模型可写投影还要移除 `operationId`：session、Tab、lease mode/token、operation ID 和关联标签均由 `ai-chat-service` 的受限工具包装层注入；operation ID 由稳定 task/tool-call identity 派生或生成，并与原 tool call 绑定，模型不能覆盖。`observe` 租约只能使用观测集合，`control` 才能使用动作集合。`operation` 只允许：

- 观测：`page_state/dom_snapshot/target_state/url/title/text/value/attribute/count/tabs`。
- 动作：语义脚本 `1.0` 的 `navigate/click/fill/type_text/press/select_option/check/uncheck/focus/blur/hover/scroll/set_files/switch_tab/close_tab`。

禁止 `evaluate/dom_script/任意 JavaScript/裸坐标/任意 CDP 命令`。目标、参数和文件引用必须再通过租约策略及 JSON Schema 校验。

当前 proxy capability 已开放除 `dom_snapshot` 外的其余 9 种观测，以及除 `set_files` 外的 14 种动作；`dom_snapshot`、`set_files`、capture/artifact 和 presentation animation 在短期产物协议实现前保持关闭，调用方必须按 capability 协商，不能把目标全集当作当前全集。

结果：

```ts
interface BrowserOperationResultV1 {
  schema: 'nebula.browser.operation-result/1.0';
  operationId: string;
  status: 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown';
  acceptedAt: string;
  startedAt?: string;
  completedAt?: string;
  before?: PageStateRefV1;
  after?: PageStateRefV1;
  resolvedTarget?: ResolvedTargetV1;
  actual?: unknown;
  artifacts: BrowserArtifactRefV1[];
  error?: ApiProblem;
}
```

同 `operationId` 不同请求 hash 拒绝；连接丢失、服务崩溃或结果不足以证明副作用时返回/收敛为 `outcome_unknown`，不得自动再次执行。

## 6. 事件信封

### 6.1 Run 事件

```ts
interface RunEventV1 {
  schema: 'nebula.ai-e2e.run-event/1.0';
  id: string;
  runId: string;
  seq: number;
  stateVersion?: number;
  type: string;
  entity: { type: string; id: string };
  correlationId?: string;
  causationId?: string;
  occurredAt: string;
  data: Record<string, unknown>;
}
```

最低事件集：`run.snapshot/run.lifecycle_changed/run.completed`、`todo.state_changed`、`attempt.started/attempt.completed`、`page_task.started/page_task.completed`、`decision.requested/decision.answered/decision.applied`、`side_effect_policy.evaluated`、`side_effect_approval.requested/granted/revoked/expired`、`browser.operation_linked`、`evidence.manifest_sealed` 和 `run.command_rejected`。

### 6.2 Agent 与浏览器事件

- `AgentTaskEventV1` 使用 task-scoped `seq`，最低事件集：`agent_task.snapshot/state_changed/model_turn/tool_call/tool_result/skill_loaded/budget_updated/completed`。
- `BrowserEventV1` 使用 browser-session-scoped `seq`，最低事件集：`browser_session.snapshot`、`tab.created/selected/closed`、`lease.issued/revoked/expired`、`operation.queued/started/completed`、`target.resolved/stale/ambiguous`、`artifact.created`、`animation.started/completed`。
- Agent/浏览器事件只有过程事实；`ai-e2e` 写入自己的关联事件后才成为业务时间线的一部分。

### 6.3 Authoring 事件

`AuthoringEventV1` 使用 authoring-job-scoped `seq/stateVersion` 和同一通用因果字段。最低事件集：`authoring.snapshot/lifecycle_changed/stage_changed/completed`、`authoring_task.state_changed`、`authoring_attempt.completed`、`asset.candidate_created/validated/verified/activated/rejected`、`coverage.changed`、`decision.requested/applied`、`side_effect_policy.evaluated` 和 `side_effect_approval.requested/granted/revoked/expired`。

### 6.4 SSE 重连

- 每次连接第一条非 heartbeat 事件必须是当前完整 snapshot，snapshot 带当前 `seq` 和 `stateVersion`。
- 后续事件严格递增；发现缺号、旧 seq 或客户端状态版本倒退时，客户端丢弃本地投影并重新获取 snapshot。
- `Last-Event-ID` 可以作为网络优化提示，但不是正确性契约；服务可以忽略。
- `event-log?afterSeq=` 供审计、诊断和受控补洞，不允许只靠增量重建未知起点状态。
- heartbeat 不占业务 seq，不写持久事件表。
- 现有 Chat SSE 的 `session.snapshot → live` 行为保持不变；现有项目 SSE 和 Debug SSE 在目标 UI 迁移完成前继续兼容。

## 7. 跨服务编排与恢复

目标调用链：

```text
ai-e2e 持久化 intent/outbox
  → proxy-adapter 创建/查询浏览器会话与租约
  → ai-chat-service 创建受限 Agent task
  → Agent 通过受限 MCP wrapper 提交 proxy 原子操作
  → ai-e2e 查询/接收任务结果并核对 proxy operation ledger
  → ai-e2e 单事务更新 TODO/attempt/output/event
  → ai-e2e 提升必要原始产物并封存 evidence manifest
```

不使用跨服务数据库事务。`ai-e2e` 必须维护 `integration_outbox` 和 `external_task_links`：

- outbox 记录目标服务、命令类型、幂等键、脱敏 payload hash、状态、尝试次数、下次重试时间和结果引用。
- external link 按 run 或 authoring 上下文记录 page-task/attempt 或 authoring-task/attempt 与 agent task、browser session、lease、operation 的 opaque ref 和最后核对状态。
- 外部调用完成但本地确认丢失时，以相同幂等键查询/重放；禁止生成新任务或新副作用操作掩盖未知结果。
- outbox worker 不能在 SQLite write transaction 内等待网络。

重启恢复：

1. `ai-e2e` 扫描非终态 run/authoring job、未确认 outbox 和活动 page/authoring task。
2. 先重算/核对当前 policy evaluation、风险投影 hash 与所需 grant；不满足时在安全边界暂停或按硬策略终止，不派发新 outbox/browser control。
3. 查询 `ai-chat-service` task 状态与 `proxy-adapter` operation ledger。
4. 已完成事实按原 correlation 写回；执行中任务重新订阅事件；丢失的 Agent task 进入 `interrupted/blocked`，由主代理重建。
5. 所有 `outcome_unknown` 先生成副作用检查 TODO；没有检查结果不得重试。
6. 控制租约失效后由主代理重新签发；子代理不能自行扩大授权。

## 8. 兼容与迁移边界

- `ai-e2e` 当前 `/api/projects/:id/events` 只发布易失项目阶段事件；目标运行 UI 必须迁移到 `/api/v1/runs/:runId/events` 后才能依赖断线恢复。
- 当前 `/api/projects/:projectId/execution/*` 和 `ExecutorService` 是旧 scenario-level TypeScript 执行面；在语义运行链验收前继续存在，但新业务版本不得生成新的不可视旁路依赖。
- `ai-chat-service` 当前 `/api/ai/generate` 是无工具的纯文本调用；目标 Agent API 应作为独立路由和持久任务模型实现。
- `proxy-adapter` 当前 MCP transport 无会话，浏览器服务是进程级实例；目标应用层 session/lease/operation ledger 不得依赖 MCP transport session。
- 新 API 与旧 API 并存期间，UI 必须按项目/业务版本能力标志选择整条执行链，禁止在同一 run 中混用新旧执行器。

## 9. 验收原则

1. 任一跨服务创建或命令请求可用同一幂等键安全重放；参数冲突明确拒绝。
2. `ai-e2e` 无需依赖 Agent 对话历史或 SSE 内存即可恢复 run 权威状态。
3. 模型无法读取或覆盖控制租约 token、browser session/Tab 注入值和业务 correlation 映射。
4. 相同 `operationId` 不会产生第二次浏览器副作用，未知结果必须先检查。
5. 四类目标 SSE 均能从各自 snapshot 恢复；Authoring/Run 的持久 seq 与业务状态更新同事务。
6. 一个 browser session 任一时刻最多一个活动 control lease；一个 run 任一时刻最多一个执行型页面任务。
7. 旧执行面不会与新执行面在同一 run 中交叉调用。
8. 跨服务超时、重启和事件缺号均有可重复的查询与收敛路径。
9. 首期控制面保持 loopback/local 单用户边界；非本机或多用户部署在统一认证授权协议落地前不能启动 semantic authoring/run。
10. v1 browser session 只绑定一个 BrowserContext；跨账号/角色只能通过场景内显式认证脚本串行切换，Agent task 或 proxy API 不能暗换 storage state。
11. local/test 已声明有界副作用和 staging 低风险写入无需人工审批；staging 删除、批量、不可逆或上传在 browser job/control 前只产生一次计划级审批。
12. production 只允许显式认证会话变化与只读行为；业务 create/update/delete、上传及业务提交在租约/操作前硬拒绝，且没有 v1 审批绕过。
13. Agent、Skill、页面内容或视觉结果无法改变风险投影、effectId 或 grant；proxy 保持通用浏览器网关，不持有环境策略。

## 10. 关联文档

- `agent-browser-execution-contract.md`：主/子代理、页面任务和浏览器控制权。
- `run-state-decision-evidence-contract.md`：状态、命令、决策和证据语义。
- `target-data-model.md`：run、outbox、外部引用和事件持久化。
- `ai-model-skill-contract.md`：双模型、视觉输出和 Skills 执行隔离。
- `semantic-script-schema.md`：原子动作与目标引用白名单。
- `asset-authoring-repair-contract.md`：从零生成、复核、candidate 验证、影响分析和局部修复。
- `migration-compatibility-acceptance-contract.md`：旧资产导入、版本级切流、回滚与发布验收。
- `environment-side-effect-policy-contract.md`：环境风险矩阵、计划级审批和逐调用副作用门禁。
