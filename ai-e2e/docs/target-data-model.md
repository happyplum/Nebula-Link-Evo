# AI E2E 目标数据模型

> 状态：`shipped`。纯 semantic migration 001、014–018 已交付项目、资产治理、authoring/run/browser queue、decision/policy/evidence/outbox/external link、结构化 amendment/Chat scope 表与核心仓储；Project/Authoring/Run API/SSE 和跨服务协调器已接入。
> 更新时间：2026-08-24。
> 本文定义 `ai-e2e` 首期最终关系模型、不可变修订、版本复制事务、页面规范化、运行数据与证据存储。迁移编号和物理 SQL 在实施时按现有 SQLite migration 链追加，但不得改变本文的所有权和唯一性约束。

### 当前物理映射

领域资产物理映射为 `semantic_business_modules`、`semantic_functional_modules`、`semantic_test_scenarios` 及对应 revision 表；API 与领域名称使用 business/functional module 和 scenario。

## 1. 存储原则

- `ai-e2e` 继续使用独立 SQLite，不与 `proxy-adapter` 或 `ai-chat-service` 共享数据库或跨库外键。
- 实体 ID 使用 `crypto.randomUUID()` 生成的 UUID v4 字符串。
- 时间统一保存 UTC RFC 3339 文本，应用层输出 ISO 8601；所有终态同时记录明确 `completed_at`。
- JSON 字段在写入前按键稳定排序并规范化，内容资产计算 SHA-256；不得对含秘密明文的对象计算并持久化可反推哈希。
- 稳定资产与不可变 payload 修订分离。运行、copy 和修复引用精确 revision ID + content hash，不引用会变化的“当前内容”。
- 业务版本、资产修订和已存在运行默认软归档，不做普通级联硬删除；硬删除是单独的保留/审计流程。
- 所有运行状态变更、命令幂等记录和 run event 在同一数据库事务中提交。

## 2. 数据域总览

```text
projects
├─ deployment_profiles ── deployment_profile_revisions
├─ business_versions
│  ├─ version_deployment_bindings
│  ├─ version_prd_documents
│  ├─ version_decisions
│  ├─ business_version_validations
│  ├─ authoring_jobs ── authoring_tasks ── authoring_attempts / authoring_commands / authoring_events
│  ├─ page_definitions ── page_definition_revisions
│  │  └─ page_baseline_variants ── page_baseline_revisions
│  ├─ business_modules ── business_module_revisions
│  │  └─ functional_modules ── functional_module_revisions
│  │     ├─ module_requirement_revisions
│  │     ├─ functional_point_coverage
│  │     └─ functional_scripts ── functional_script_revisions
│  ├─ test_scenarios ── test_scenario_revisions
│  ├─ version_variable_definitions
│  ├─ asset_revision_verifications
│  └─ asset_revision_dependencies
└─ test_runs
   ├─ run_plans ── run_plan_amendments
   ├─ run_todos ── run_todo_dependencies
   ├─ page_tasks ── execution_attempts
   ├─ run_variables
   ├─ decision_requests ── decision_answers
   ├─ side_effect_policy_evaluations ── side_effect_approval_grants
   ├─ run_commands
   ├─ run_events
   └─ evidence_manifests ── evidence_items ── artifact_objects

schema_migrations
integration_outbox ── external_task_links
browser_jobs
```

## 3. 通用资产修订规则

页面、业务模块、功能模块、模块需求、功能脚本、测试场景和页面基线使用同一修订语义：

| 字段 | 类型 | 约束/语义 |
|---|---|---|
| `id` | TEXT | UUID PK |
| `<asset>_id` | TEXT | 稳定资产 FK |
| `revision_no` | INTEGER | 从 1 单调递增，`UNIQUE(asset_id, revision_no)` |
| `lifecycle` | TEXT | `draft/current/superseded/rejected` |
| `schema_id` | TEXT | payload Schema ID |
| `payload_json` | TEXT | 规范化 JSON，不可原地修改 |
| `content_sha256` | TEXT | 64 位小写 hex；同一 payload 校验 |
| `validation_status` | TEXT | `pending/valid/invalid` |
| `validation_errors_json` | TEXT NULL | 结构化校验错误，不保存模型自由日志 |
| `supersedes_revision_id` | TEXT NULL | 同一资产的直接前修订 |
| `source_asset_id` | TEXT NULL | copy/迁移来源审计 |
| `source_revision_id` | TEXT NULL | copy/迁移来源精确修订 |
| `change_reason` | TEXT | 生成、人工编辑、修复、copy 或迁移原因 |
| `created_by_type` | TEXT | `user/main_agent/child_agent/system/migration` |
| `created_by_id` | TEXT NULL | 用户或 Agent task reference |
| `created_at` | TEXT | UTC 时间 |
| `validated_at` | TEXT NULL | 最后静态校验时间 |

约束：

- 每个资产最多一个 `lifecycle='current'`，通过 partial unique index 保证。
- `payload_json` 和 `content_sha256` 创建后不可更新；校验状态与 lifecycle 可以在受控事务内变化。
- 激活新修订时，同一事务内校验 `valid`、把旧 current 改为 superseded、把新修订改为 current，并使所有引用旧 asset graph 的业务版本验证失效。功能脚本/场景的普通激活还必须存在与本次 authoring scope 匹配的 `asset_revision_verifications.status='verified'`。
- rejected 修订永不成为 current；需要再次修改时创建新修订。
- 功能脚本/场景的 `current` 表示版本选中的内容；是否 verified 必须结合精确 deployment/build/角色/locale/viewport 验证范围查询独立验证表，不能由 revision 上的单一布尔值表示。copy 是唯一允许在没有目标范围验证记录时创建 current 执行型修订的系统事务，目标版本必须保持 `needs_recheck` 且禁止正式运行。

## 4. 项目、部署与业务版本

### 4.1 `projects`

项目是业务版本、部署和运行的长期容器：

| 字段 | 变化 |
|---|---|
| `id/name/description/created_at/updated_at` | 项目身份与展示信息 |
| `create_request_id/request_hash` | 项目初始化幂等键与请求漂移校验 |
| `created_by` | 创建者审计引用 |

### 4.2 `deployment_profiles`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | UUID PK |
| `project_id` | TEXT | FK projects |
| `profile_key` | TEXT | 项目内稳定 key，`UNIQUE(project_id, profile_key)` |
| `name` | TEXT | 用户可读名称 |
| `archived_at` | TEXT NULL | 软归档 |
| `created_at` | TEXT |  |

`deployment_profile_revisions` 使用通用修订字段，payload 固定为：

```ts
interface DeploymentProfileV1 {
  schema: 'nebula.ai-e2e.deployment-profile/1.0';
  environment: 'local' | 'test' | 'staging' | 'production';
  origin: string;
  basePath?: string;
  allowedOrigins: string[];
  git?: { repository?: string; ref?: string; commit?: string; buildId?: string };
  authSecretRefs?: string[];
  locale?: string;
  timezone?: string;
  viewport?: { width: number; height: number; category: 'desktop' | 'tablet' | 'mobile' };
}
```

- `origin` 必须是 `http/https` origin，不含 path/query/fragment；Base URL path 单独放 `basePath`。
- `allowedOrigins` 包含 origin 自身，禁止通配 `*`；跳转超出列表立即停止。
- 项目可以有多套命名部署；业务版本和运行只引用不可变 deployment revision。
- 密钥值不进入 payload，只保存 secret reference。

### 4.3 `business_versions`

| 字段 | 类型 | 约束/语义 |
|---|---|---|
| `id` | TEXT | UUID PK |
| `project_id` | TEXT | FK projects |
| `version_key` | TEXT | 项目内稳定 key，唯一 |
| `name` | TEXT | 用户可读名称 |
| `source_version_id` | TEXT NULL | 来源版本审计，不形成可变共享 |
| `create_request_id` | TEXT NULL | 空白创建幂等键，项目内唯一 |
| `copy_request_id` | TEXT NULL | copy 幂等键，项目内唯一 |
| `request_hash` | TEXT | 幂等请求的规范化 SHA-256；同键不同请求拒绝 |
| `validation_status` | TEXT | `draft/validating/needs_recheck/valid/invalid/archived` |
| `schema_version` | INTEGER | 初始为 1 |
| `git_metadata_json` | TEXT NULL | 版本声明的可选 Git/部署备注，不替代运行冻结值 |
| `created_by` | TEXT | 用户/系统引用 |
| `created_at/updated_at` | TEXT |  |
| `archived_at` | TEXT NULL |  |

`version_key` 格式与 script key 相同；归档版本只读，可查看、复制和读取历史运行，不能产生新资产修订。

`business_versions.validation_status` 表示默认 deployment binding 的聚合就绪状态；多部署的真实就绪状态以 `business_version_validations` 为准，不能因默认环境 valid 推断其他环境可运行。

### 4.4 `version_deployment_bindings`

| 字段 | 类型 | 约束 |
|---|---|---|
| `business_version_id` | TEXT | FK |
| `deployment_revision_id` | TEXT | 精确 immutable revision FK |
| `binding_key` | TEXT | `default` 或命名运行目标 |
| `is_default` | INTEGER | 每版本最多一个 true |
| `is_current` | INTEGER | 同版本 + document key 最多一个 current |
| `source_document_id` | TEXT NULL | copy 来源审计 |
| `created_at` | TEXT |  |

同一版本可以绑定多个兼容环境；运行必须显式解析到其中一个精确 revision。copy 复制 binding row，不复制秘密，也不依赖部署 profile 的可变 current。

### 4.5 `business_version_validations`

- `id/business_version_id/deployment_revision_id/asset_graph_sha256/verification_scope_sha256`。
- `status(validating/valid/needs_recheck/invalid)`、`authoring_job_id`、`validated_at/invalidated_at/reason_json`。
- `verification_scope_json` 只保存脱敏的 Git/build 标识、required roles/locales/viewports/baseline keys 和策略版本；secret 值不进入 scope。
- 每个 version + deployment binding 最多一个 current validation；资产 current、部署绑定、Git/build 声明或 required matrix 改变时使旧记录 `needs_recheck`，但保留历史审计。
- 正式 run 必须命中所选 deployment revision、当前 asset graph 和请求运行矩阵的 `valid` 记录；默认环境的版本聚合状态不能替代该检查。

## 5. PRD、长期决策与变量定义

### 5.1 `version_prd_documents`

| 字段 | 类型 | 语义 |
|---|---|---|
| `id` | TEXT | UUID PK |
| `business_version_id` | TEXT | FK |
| `document_key` | TEXT | 版本内唯一 |
| `format` | TEXT | `markdown/plain_text` |
| `raw_content` | TEXT | 原文 |
| `content_sha256` | TEXT | 内容哈希 |
| `parsed_json` | TEXT NULL | 结构化解析结果 |
| `source_uri` | TEXT NULL | 来源引用，不保存访问 Token |
| `created_at` | TEXT |  |

PRD 变更不覆盖旧记录；新的文档/解析记录成为版本当前输入，并将版本标为 needs_recheck。

### 5.2 `version_decisions`

保存会影响后续运行的长期决定：

| 字段 | 类型 | 语义 |
|---|---|---|
| `id` | TEXT | UUID PK |
| `business_version_id` | TEXT | FK |
| `decision_key` | TEXT | 同一主题稳定 key |
| `status` | TEXT | `active/superseded/withdrawn` |
| `question/category/answer/reason` | TEXT | 结构化语义 |
| `evidence_refs_json` | TEXT | 不可变证据引用 |
| `supersedes_decision_id` | TEXT NULL | 显式替代 |
| `decided_by_type/id` | TEXT | user/main_agent |
| `created_at` | TEXT |  |

同一 `decision_key` 最多一个 active。运行恢复引用精确 decision ID。

### 5.3 `version_variable_definitions`

只保存变量 Schema 和 secret reference 定义，不保存运行值：

- `id/business_version_id/name/type/sensitivity/constraints_json/default_json/secret_ref/source_variable_id/created_at`
- `UNIQUE(business_version_id, name)`。
- secret 类型只能设置 `secret_ref`，`default_json` 必须为空。

## 6. 页面与基线

### 6.1 `page_definitions`

稳定实体字段：

- `id/business_version_id/page_key/created_at/archived_at`
- `UNIQUE(business_version_id, page_key)`。

`page_definition_revisions.payload_json` 使用：

```ts
interface PageDefinitionV1 {
  schema: 'nebula.ai-e2e.page-definition/1.0';
  name: string;
  routeMode: 'path' | 'hash';
  routeTemplate: string;
  identityQuery: Record<string, ParameterSpec>;
  runtimeParams: Record<string, ParameterSpec>;
  ignoredQueryKeys: string[];
  authRequirement: { kind: 'anonymous' | 'authenticated'; roles?: string[] };
  recognition: PageRecognitionRule[];
  allowedTransitionPageIds: string[];
}

interface ParameterSpec {
  location: 'path' | 'query' | 'fragment';
  type: 'string' | 'slug' | 'integer' | 'number' | 'boolean' | 'uuid' | 'date' | 'enum';
  required: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  fixedValue?: string;
  sensitivity?: 'public' | 'sensitive';
}

type PageRecognitionRule =
  | { kind: 'title_contains'; value: string }
  | { kind: 'landmark_present'; role: string; name?: string }
  | { kind: 'element_present'; semantic: string; locatorHint: JsonValue }
  | { kind: 'abnormal_page'; abnormalType: 'login' | 'error' | 'forbidden' };
```

`routeTemplate` grammar：

- 以 `/` 开头，静态 segment 或 `{paramName}`；首期不允许 `*`、`**`、optional segment 或内嵌正则。
- path 参数必须在 `runtimeParams` 中声明且 `location='path'`。
- hash route 的模板仍只保存 hash 内 path，例如 `/users/{userId}`；`routeMode='hash'` 负责解析 `#/users/42`。
- 身份 query 必须是 fixedValue 或 enum；分页、搜索、排序、资源 ID 默认是 runtime。
- 未声明 query 只有命中项目级追踪参数 allowlist 才可忽略，否则页面匹配返回 unknown-parameter 并要求校正。

### 6.2 页面规范签名

签名输入为以下规范 JSON 的 SHA-256：

```json
{
  "routeMode": "path",
  "routeTemplate": "/users/{userId}",
  "identityQuery": { "tab": { "type": "enum", "enum": ["profile"], "required": true } }
}
```

规范化规则：

1. 使用 WHATWG `URL` 解析实际 URL；不手写字符串切割。
2. Origin、basePath、runtime 值、忽略参数和普通 fragment 不进入签名。
3. query key 按 Unicode code point 稳定排序；enum 去重后排序。
4. path 保留大小写；除根路径外统一去尾斜杠，重复斜杠归一为一个。
5. 不重复 percent-decode；比较使用 URL parser 归一后的 segment。
6. 页面 revision 额外保存 `page_signature_sha256` 索引列；同业务版本的 current page revision 必须签名唯一。同分匹配歧义使版本 invalid。

匹配优先分：静态 segment `+100`、固定身份参数 `+50`、enum 身份参数 `+30`、有类型 path 参数 `+10`、每个泛化参数 `-1`。最高分唯一者匹配；并列即歧义，不用创建顺序破局。

### 6.3 `page_baseline_variants`

稳定字段：`id/page_definition_id/variant_key/created_at/archived_at`，page 内 key 唯一。

baseline revision payload：

```ts
interface PageBaselineV1 {
  schema: 'nebula.ai-e2e.page-baseline/1.0';
  name: string;
  preconditions: { role?: string; locale?: string; viewportCategory?: string; stateTags: string[] };
  capturedUrlRedacted: string;
  deploymentRevisionId: string;
  git?: { commit?: string; buildId?: string };
  domArtifactId: string;
  screenshotArtifactId: string;
  pageSummaryJson: JsonValue;
  locatorHintsJson: JsonValue;
  fingerprint: BaselineFingerprint;
  capturedAt: string;
}

interface BaselineFingerprint {
  domStructureSha256: string;
  interactiveTokens: string[];
  landmarkTokens: string[];
  screenshotPHash?: string;
}
```

fingerprint v1：

- `domStructureSha256`：简化 DOM 结构的精确 hash。
- `interactiveTokens`：visible/interactive 元素的 tag、role、稳定属性 key 与 landmark ancestry；排除文本值、表单值、临时 ID、坐标和 nebula ID。
- `landmarkTokens`：main/nav/form/dialog/table 等区域层级。
- `screenshotPHash`：脱敏截图的感知 hash，可为空。

候选先按 page ID、角色、locale、viewport 和 state tag 过滤，再计算 `0.60 * interactive Jaccard + 0.25 * landmark Jaccard + 0.15 * pHash similarity`；没有截图 pHash 时，前两项按原比例归一到 1：

- `>= 0.85`：可自动选择为参考变体，仍须执行脚本前置条件。
- `0.70–0.85`：交给分析/单次视觉辅助确认。
- `< 0.70`：不匹配，进入探索、修复或决策。

阈值可按项目调整，但调整是版本决策并记录；基线相似度不能替代硬业务断言。

### 6.4 `page_observations`

Explorer 和运行发现的实际页面只作为观察记录，不随版本 copy：

- `id/business_version_id/run_id nullable/observed_url_redacted/title/deployment_revision_id`
- `matched_page_definition_id/match_status(exact/ambiguous/unmatched/abnormal)`
- `snapshot_artifact_id/screenshot_artifact_id/observed_at/source(exploration/run/manual)`。

经确认的 observation 可以生成新页面/基线修订，但不能原地变成版本资产。

## 7. 模块与模块需求

### 7.1 业务模块

`business_modules`：`id/business_version_id/module_key/created_at/archived_at`，版本内 key 唯一。

revision payload：

```ts
interface BusinessModuleV1 {
  schema: 'nebula.ai-e2e.business-module/1.0';
  name: string;
  description?: string;
  sortOrder: number;
  prdSourceRefs: string[];
}
```

### 7.2 功能模块

`functional_modules`：`id/business_version_id/business_module_id/module_key/created_at/archived_at`。

revision payload：

```ts
interface FunctionalModuleV1 {
  schema: 'nebula.ai-e2e.functional-module/1.0';
  name: string;
  description?: string;
  sortOrder: number;
  primaryPageDefinitionId: string;
}
```

一个功能模块只能有一个 primary page；跨页能力由脚本 pageScope 和场景调用表达。

### 7.3 `module_requirement_revisions`

此表直接关联 `functional_module_id`，使用通用修订字段，payload：

```ts
interface ModuleRequirementV1 {
  schema: 'nebula.ai-e2e.module-requirement/1.0';
  purpose: string;
  prdFragments: { documentId: string; start?: number; end?: number; quoteSha256?: string }[];
  pageDefinitionId: string;
  functionalPoints: { key: string; description: string; acceptanceCriteria: string[] }[];
  orderedUserFlows: string[];
  pageEvidenceRefs: string[];
  assumptions: string[];
  decisionRefs: string[];
}
```

脚本生成和修复必须绑定精确 requirement revision；只读 PRD 片段不足以替代真实页面证据。

## 8. 功能脚本与场景资产

### 8.1 `functional_scripts`

- `id/business_version_id/functional_module_id/script_key/name/created_at/archived_at`
- `UNIQUE(business_version_id, script_key)`。

`functional_script_revisions.payload_json` 必须通过 `nebula.ai-e2e.functional-script/1.0`；额外索引列：

- `schema_id`
- `content_sha256`
- `requirement_revision_id`
- `primary_page_revision_id`
- `change_kind(generated/human_edit/ai_repair/migration)`。

### 8.2 `test_scenarios`

- `id/business_version_id/scenario_key/name/created_at/archived_at`
- `UNIQUE(business_version_id, scenario_key)`。

`test_scenario_revisions.payload_json` 使用：

```ts
interface ScenarioDefinitionV1 {
  schema: 'nebula.ai-e2e.scenario/1.0';
  scenarioKey: string;
  name: string;
  purpose: string;
  prdSourceRefs: string[];
  actors: ScenarioActorDefinition[];
  initialAuth: AuthActorRef;
  inputs: ScenarioInputDefinition[];
  finalAcceptance: ScenarioAssertion[];
  calls: ScenarioCallNode[];
  edges: ScenarioEdge[];
  exports: ScenarioExport[];
}

interface ScenarioActorDefinition {
  actorKey: string;
  name: string;
  requiredRoles: string[];
  description: string;
}

type AuthActorRef =
  | { kind: 'anonymous' }
  | { kind: 'actor'; actorKey: string };

interface AuthContextContract {
  before: AuthActorRef;
  after: AuthActorRef | { kind: 'unchanged' };
}

interface ScenarioInputDefinition {
  name: string;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'uuid' | 'date' | 'enum' | 'object' | 'array' | 'artifact_ref' | 'secret_ref';
  required: boolean;
  sensitivity: 'public' | 'sensitive' | 'secret';
  constraints?: JsonValue;
}

type ConfirmedValueRef =
  | { kind: 'scenario_input'; name: string }
  | { kind: 'call_output'; callKey: string; outputId: string }
  | { kind: 'call_result'; callKey: string };

interface ScenarioAssertion {
  id: string;
  left: ConfirmedValueRef;
  op: 'exists' | 'not_exists' | 'eq' | 'ne' | 'in' | 'gt' | 'gte' | 'lt' | 'lte';
  right?: JsonScalar | JsonScalar[];
  message: string;
}

interface ScenarioExport {
  name: string;
  from: ConfirmedValueRef;
  sensitivity: 'public' | 'sensitive' | 'secret';
}

type InputBinding =
  | { kind: 'literal'; value: JsonValue }
  | { kind: 'scenario_input'; name: string }
  | { kind: 'version_variable'; name: string }
  | { kind: 'call_output'; callKey: string; outputId: string }
  | { kind: 'secret'; secretRef: string }
  | { kind: 'generated'; generator: 'uuid' | 'unique_string'; prefix?: string; maxLength?: number };

interface ScenarioCallNode {
  callKey: string;
  functionalScriptId: string;
  authContext: AuthContextContract;
  inputBindings: Record<string, InputBinding>;
  outputAliases: Record<string, string>;
  repeat?:
    | { kind: 'count'; count: number }
    | { kind: 'for_each'; scenarioInput: string; maxItems: number };
  runWhen?: ScenarioCondition;
  role: 'normal' | 'cleanup';
  sortOrder: number;
}

interface ScenarioEdge {
  fromCallKey: string;
  toCallKey: string;
  mode: 'requires_success' | 'requires_completion';
  requiredOutputs?: string[];
}

type ScenarioCondition =
  | { op: 'exists' | 'not_exists' | 'truthy' | 'falsy'; ref: ConfirmedValueRef }
  | { op: 'eq' | 'ne' | 'in'; left: ConfirmedValueRef; right: JsonScalar | JsonScalar[] };

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };
```

规则：

- `count` 1–100；`for_each.maxItems` 1–100，实际集合不能超过。
- condition 只能读取场景输入、已确认上游输出或上游终态，不能读取 DOM、模型文本或任意代码。
- `requires_completion` 只允许 cleanup/汇总节点；普通节点必须 `requires_success`。
- 静态校验用 Kahn 拓扑排序确认无环；`sortOrder` 只稳定同层顺序。
- `actorKey` 在场景内唯一，`initialAuth` 和每个 `authContext` 引用必须存在；actor 只描述非秘密别名与角色，凭据继续通过受控输入/secret reference 绑定。
- `authContext.after` 与 `before` 不同的调用必须引用声明 `auth_change` 的脚本；声明 `auth_change` 的调用不得把结果写成 `unchanged`。
- 全部认证变化调用必须由依赖边形成单一顺序；展开计划时沿该顺序模拟唯一活动身份，任何 TODO 的 `before` 无法由 `initialAuth` 或已验证前序变化到达时拒绝计划。
- scenario revision 引用脚本稳定 ID；run plan 冻结时解析到 current valid script revision。

## 9. 业务版本 copy 事务

### 9.1 原子算法

copy 使用 `copy_request_id` 幂等并执行 `BEGIN IMMEDIATE`：

1. 读取并锁定来源业务版本；archived 来源允许只读复制，invalid、结构不完整或缺少可选中 current valid 修订的来源拒绝复制。
2. 固化来源 current revision ID、hash 和版本 deployment bindings 清单。
3. 创建目标 business_version，状态 `needs_recheck`，记录 source version 和 copy request。
4. 为页面、模块、脚本、场景、基线、变量定义、版本决策和 coverage row 生成新 ID，建立事务内 old→new map。
5. 为每项资产创建 revision_no=1 的目标修订，payload 中所有版本内部 ID 使用 map 重写，并记录 source asset/revision。复制的功能脚本/场景保持目标版本 current 选择，但不复制 `asset_revision_verifications` 或 `business_version_validations`；UI/API 由此派生为 stale。
6. 复制 PRD、deployment binding、current decisions、current functional-point coverage 和基线 manifest；coverage 内 requirement/script/decision 引用使用目标 ID 重写。不复制运行、事件、验证记录、证据 manifest、实际变量、会话或密钥值。
7. 对内容寻址 artifact 只新增独立 evidence/baseline item 引用并增加 ref count；blob 不物理复制，但不可变内容和生命周期不能受来源版本编辑影响。
8. 执行全图引用校验、Schema 校验、hash 校验、无环检查和唯一页面签名检查。
9. 校验失败整体 rollback；成功 commit 并返回目标版本/资产数量、stale 执行资产与需要重新检查的页面清单。目标版本只有完成 recheck 并在目标 deployment revision 上重新验证后才能转为 `valid`。

SQLite `BEGIN IMMEDIATE` 防止 copy 期间来源 current 指针变化。重复相同 `copy_request_id` 返回第一次结果，不产生第二份版本。

### 9.1.1 当前已实现范围

- `BusinessVersionRepository` 已实现空白创建和 copy 幂等 hash、来源 `valid/archived` 门禁、事务回滚、全图 hash/引用/场景 DAG 校验和目标 `needs_recheck`。
- 已复制并重建当前 PRD/解析结果、变量定义、页面、业务模块、功能模块、功能脚本、场景及其 current revision ID；部署 binding 引用项目级 immutable deployment revision，Git 元数据可继承或覆盖。
- migration 015–018 已交付 decision、coverage、baseline、scoped verification/dependency、authoring、run、evidence/outbox 与结构化 amendment/Chat scope 表。copy 已重建 current decision/baseline/requirement/coverage/dependency 引用，内容寻址 artifact 只增加引用计数；不复制 verification、business version validation、run、authoring thread/amendment 或 evidence manifest。
- copy 后功能脚本/场景 revision 的 `readiness_status=stale` 仅是目标版本待复核投影；真实授权以 scoped `asset_revision_verifications` 与 `business_version_validations` 为准，不能据此创建 semantic formal run。

### 9.2 独立性判定

copy 后必须满足：

- 目标任一稳定 asset ID 与来源不同。
- 目标 payload 内不存在指向来源版本可变资产的 FK/ID。
- 修改、修复、归档或删除目标资产不改变来源 current revision。
- 共享只允许项目级 immutable deployment revision 和 content-addressed immutable blob。
- 来源审计字段不参与运行解析。

## 10. 资产生成、复核与依赖索引

### 10.1 `authoring_jobs`

- `id/project_id/business_version_id/mode(bootstrap/recheck/repair)`。
- `parent_run_id nullable`；仅 run-triggered repair 使用，并复用父 run 的 browser job/session 槽位。
- `browser_job_id nullable`；需要真实页面时绑定一个 root browser job，嵌套 repair 必须与 parent run 相同。
- `lifecycle(created/planning/running/paused/waiting_decision/completing/completed/cancelling/cancelled/failed)`。
- `outcome(succeeded/partial/failed/cancelled) nullable`。
- `stage/strategy_version/source_fingerprint/input_sha256/state_version/next_event_seq`。
- `active_task_id/coverage_summary_json/result_json/pause_reason_json`。
- `current_policy_evaluation_id/active_approval_grant_id nullable`；只保存当前 job 的引用，grant 不进入资产或版本 copy。
- `created_by/started_at/completed_at/created_at`。
- partial unique index：每个 business version 最多一个非终态写 authoring job。

`lifecycle=failed` 仅用于协调器/持久化/协议完整性故障；正常封存但 required coverage 或验证不通过使用 `lifecycle=completed,outcome=failed`。

### 10.2 `authoring_tasks` 与 `authoring_attempts`

`authoring_tasks`：

- `id/job_id/task_key/type/state/dependencies_json/target_type/target_id nullable`。
- `type(ingest_prd/extract_requirements/discover_page/model_page/specify_module/generate_script/generate_scenario/verify_script/verify_scenario/analyze_impact/validate_version/activate_assets)`。
- `state(pending/ready/running/waiting_decision/blocked/succeeded/failed/skipped/cancelled)`。
- `input_sha256/input_json_redacted/tool_policy_hash/skill_policy_hash/budget_json`。
- `current_attempt_id/decision_id nullable/started_at/completed_at/created_at`。
- `UNIQUE(job_id, task_key)`；依赖必须无环；partial unique 保证每个 job 最多一个 running task/外部 Agent task。

`authoring_attempts`：

- `id/job_id/task_id/attempt_no/agent_task_id/page_task_ref nullable`。
- `status(succeeded/failed/blocked/interrupted/decision_required/cancelled)`。
- `candidate_asset_type/candidate_asset_id/candidate_revision_id nullable`。
- `input_sha256/result_json/evidence_manifest_id/error_json/started_at/completed_at`。
- `UNIQUE(task_id, attempt_no)`；终态不可更新。

### 10.3 `authoring_commands`

- `id` = 命令幂等键，PK；`job_id/type(start/pause/resume/cancel/answer_decision)`。
- `expected_state_version/request_sha256/status(accepted/completed/rejected)`。
- `result_json/error_json/created_by/created_at/completed_at`。
- 同 ID 同 hash 返回原结果；同 ID 不同 hash 拒绝。命令状态改变和 authoring event 在同一事务。

### 10.4 `authoring_events`

与 run event 同样使用 job-scoped 单调 seq、stateVersion、entity、correlation/causation 和脱敏 payload。job 状态更新、seq 分配和 event 插入同事务；SSE 只投影持久事件。

### 10.5 结构化 amendment 与 Chat scope

- `authoring_context_threads` 冻结 job/version、当前 URL、页面、模块、base revision hash 与可见场景；每个 job 最多一个 active thread。创建不同 scope 时旧 thread 及其非终态候选原子标为 stale。
- `authoring_amendments` 保存幂等 request hash、`draft → candidate_ready → waiting_decision/queued_at_safe_boundary → verifying → activated` 状态及 `rejected/failed/stale` 终态、原因、影响范围和验证计划。
- `authoring_amendment_changes` 按 sequence 冻结 asset type/id、exact current base revision/hash、valid draft candidate revision、目标页面/模块/URL、结构化 diff、依赖边和可选 verification scope/dependency closure hash；资产归属从数据库反查，不信任 Agent 声明。
- `authoring_amendment_decisions` 把同页其他模块或跨 URL 的 scope expansion 与 `decision_requests` 关联；所有关联 decision `applied` 前禁止进入安全边界。
- `authoring_chat_messages` 只保存 thread-scoped user/assistant/system 审计文本及可选 amendment 引用；Chat 文本本身不改变候选或资产状态。
- 浏览器 operation 仍非终态时 apply 进入 `queued_at_safe_boundary`；上下文或 base current 变化后禁止应用。多候选激活先校验全部 revision/verification，再在一个 `BEGIN IMMEDIATE` 内切换全部 current；任一校验失败不改变任一 current。

### 10.6 `functional_point_coverage`

- `id/business_version_id/functional_module_id/module_requirement_revision_id/functional_point_key`。
- `required`、`disposition(covered_by_script/manual/out_of_scope/blocked)`。
- `functional_script_id/functional_script_revision_id nullable`；只有 `covered_by_script` 时必填，且引用同版本 static-valid revision。
- `decision_id nullable`；required point 使用 manual/out_of_scope 时必须引用已 applied 的版本长期决策，blocked 不得计入完成。
- `lifecycle(current/superseded)`、`source_authoring_job_id/reason_json/created_at`；partial unique 保证同版本 + requirement revision + point key 最多一个 current。

coverage row 是逐功能点的可审计投影，summary 只能由 current rows 聚合。requirement revision、script current 或适用 decision 变化时，相关 coverage 失效并由 authoring 生成新 row；不能原地把 blocked 改成 covered。required coverage 全部 `covered_by_script`，或经用户决策明确降级为 optional，版本才可通过验证。

### 10.7 `asset_revision_verifications`

- `id/business_version_id/asset_type(functional_script/test_scenario)/asset_id/asset_revision_id`。
- `deployment_revision_id/verification_scope_sha256/verification_scope_json/dependency_closure_sha256`。
- `status(verified/stale/revoked)`、`verification_run_id/authoring_job_id/evidence_manifest_id`。
- `verified_at/stale_at/stale_reason_json/created_at`；同 revision + scope 最多一个 current 状态记录，状态变化受控且尝试历史由 run/authoring attempt 保留。

scope 至少冻结 deployment revision、Git/build 标识、角色、locale、viewport、baseline keys 和会影响动作/断言的策略 major；`dependency_closure_sha256` 冻结该资产实际引用的页面/需求/脚本/决策修订闭包。脚本/场景“verified/stale”均是相对于 scope + 依赖闭包的派生结果；不能把环境 A 的验证用于环境 B，也不能因无关资产变更让本记录失效。场景引用的脚本修订改变时，其闭包 hash 必然改变并需重验。

### 10.8 `asset_revision_dependencies`

- `id/business_version_id/from_asset_type/from_asset_id/from_revision_id`。
- `to_asset_type/to_asset_id/to_revision_id nullable`。
- `relation(page_scope/requirement_source/scenario_call/output_binding/assertion_input/baseline_target/decision_source)`。
- `source_pointer` 指向已校验 payload 内字段，`created_at`。
- 复合唯一覆盖 from revision + relation + to identity + source pointer。

依赖边只能由 valid payload 确定性生成，并在 revision 激活事务中更新；模型不能直接写边。impact analyzer 使用该索引计算受影响闭包，具体重验范围仍按 change kind 裁剪。

### 10.9 `browser_jobs`

- `id/root_context_type(run/authoring)/root_context_id/queue_seq`；`queue_seq` 由 ai-e2e 全局单调分配。
- `state(queued/acquiring/active/releasing/completed/cancelled/failed)`。
- `browser_session_id nullable/capability_snapshot_sha256/created_at/acquired_at/released_at/error_json`。
- partial unique 保证全库最多一个 `state in (acquiring,active,releasing)`；队首按 queue_seq，取消只影响尚未 active 的 job。
- standalone authoring 和 formal run 各创建一个 root browser job；run-triggered nested repair 复用 parent run 的 `browser_job_id`，不创建新的 queue_seq。

队列及业务状态在同一 ai-e2e SQLite 中恢复；proxy 只接收队首的 opaque session request 并实施 `maxActiveBrowserSessions=1` 独占门禁，不存储或解释 run/authoring 类型。

完整 authoring 阶段、coverage、验证与局部修复规则见 `asset-authoring-repair-contract.md`。

## 11. 运行与编排表

### 11.1 `test_runs`

| 字段 | 类型 | 约束/语义 |
|---|---|---|
| `id` | TEXT | UUID PK |
| `project_id/business_version_id` | TEXT | FK |
| `engine` | TEXT | 固定 `semantic_v1` |
| `purpose` | TEXT | `formal/authoring_verification`；验证 run 不计作正式业务通过 |
| `authoring_job_id` | TEXT NULL | purpose=authoring_verification 时必填，formal 时为空 |
| `browser_job_id` | TEXT | standalone verification/formal run 的 root job，嵌套 verification 与 parent run 相同 |
| `scenario_revision_id` | TEXT | 精确修订 |
| `deployment_revision_id` | TEXT | 精确修订 |
| `lifecycle` | TEXT | created/planning/ready/running/paused/completing/completed/cancelling/cancelled |
| `outcome` | TEXT NULL | passed/failed/cancelled，仅终态 |
| `state_version` | INTEGER | optimistic concurrency，从 1 递增 |
| `next_event_seq` | INTEGER | 下一 run event 序号 |
| `browser_session_id` | TEXT NULL | proxy opaque ref |
| `active_page_task_id` | TEXT NULL | 首期最多一个 |
| `auth_context_state` | TEXT | `anonymous/authenticated/unknown`；浏览器事实复检后的业务投影 |
| `active_actor_key` | TEXT NULL | 仅 `authenticated` 时指向冻结计划 actor；不保存账号凭据 |
| `side_effect_policy_version` | TEXT | 固定运行使用的策略版本 |
| `side_effect_projection_sha256` | TEXT | 当前安全相关风险投影 hash |
| `current_policy_evaluation_id` | TEXT | 最近一次策略评估 |
| `active_approval_grant_id` | TEXT NULL | 仅 staging 高风险且 grant active 时存在 |
| `pause_reason_json` | TEXT NULL | 结构化暂停原因 |
| `termination_reason_json` | TEXT NULL | 取消/终态原因；区分用户取消、approval_denied 与 side_effect_policy_denied |
| `summary_json` | TEXT NULL | 终态统计，不是状态源 |
| `started_at/completed_at/created_at` | TEXT |  |

约束：首期同一 run 最多一个 active page task；同一 browser session 全局最多一个 control lease/持有者，由服务和 proxy 双重校验。run 创建时认证状态固定为 `unknown`，启动后先通过只读页面检查与场景 `initialAuth` 收敛；不匹配时只能由主代理追加显式认证任务或停止，客户端不能直接写 `active_actor_key`。formal run 只能冻结当前 asset graph 中、目标 scope 已验证的 current revision；authoring_verification run 只能由 authoring coordinator 创建，可以冻结同版本 static-valid candidate revision，但其输出不发布为正式业务结果。

### 11.2 `run_plans`

每个 run 恰好一个不可变基础计划：

- `id/run_id/schema_id/payload_json/content_sha256/created_at`
- `UNIQUE(run_id)`。
- payload 冻结版本、deployment/Git、场景/脚本/页面/需求精确修订、actor 定义与初始认证态、展开 TODO、输入/secret reference 绑定、最终验收、策略版本和 `SideEffectRiskProjectionV1`。

`run_plan_amendments`：

- `id/run_id/sequence/reason/category/decision_id nullable/payload_json/content_sha256/created_by/created_at`
- `UNIQUE(run_id, sequence)`。
- category：`script_repair/recovery/login/cleanup/operator_decision`。
- amendment 只追加替换/新增指令，不改写 base payload 或旧 amendment。
- 每个 amendment 写入新的安全投影 hash；纯非安全字段变化可以保持原投影，扩大副作用时旧 grant 立即 expired。

### 11.3 `run_todos`

| 字段 | 类型 | 语义 |
|---|---|---|
| `id/run_id/todo_key` | TEXT | run 内唯一 |
| `origin_call_key/repeat_index` | TEXT/INTEGER | 展开来源 |
| `functional_script_revision_id` | TEXT | 精确修订 |
| `page_definition_revision_id` | TEXT | 入口页面 |
| `state` | TEXT | waiting_dependencies/ready/running/waiting_decision/blocked/interrupted/passed/failed/skipped/cancelled |
| `state_version` | INTEGER | optimistic concurrency |
| `input_json_redacted` | TEXT | 非秘密冻结输入 |
| `input_secret_refs_json` | TEXT | 引用，不含值 |
| `auth_context_json` | TEXT | 冻结的执行前/成功后 actor 契约，不含凭据 |
| `published_outputs_json` | TEXT NULL | 仅成功或主代理显式确认 |
| `partial_outputs_json` | TEXT NULL | 只供证据/恢复，标记未确认 |
| `side_effect_summary_json` | TEXT NULL | effectId/kind/resource/最大影响数/可逆性/上传标记与策略判定，不含秘密 |
| `block_reason_json/skip_reason_json` | TEXT NULL | 含传播链 |
| `current_attempt_id` | TEXT NULL |  |
| `started_at/completed_at` | TEXT NULL |  |

`run_todo_dependencies`：`run_id/from_todo_id/to_todo_id/mode/requires_outputs_json`，复合唯一；写入前无环校验。

### 11.4 `page_tasks`

- `id/run_id/task_no/state(created/running/paused/completed/failed/interrupted/cancelled)`
- `todo_ids_json`（固定有序、至少一个）
- `page_definition_revision_id/browser_session_id/tab_id`
- `required_auth_context_json`（所需 actor 与派发前已确认状态，不含凭据）
- `side_effect_authorization_json`（当前 TODO 允许的 effectId、policy evaluation、可选 grant 引用与投影 hash）
- `browser_lease_ref_hash`（不存 capability 明文）
- `ai_task_id/ai_session_id nullable`
- `tool_policy_hash/task_payload_sha256/budget_json/checkpoint_json/result_json`
- `started_at/completed_at/created_at`。

### 11.5 `execution_attempts`

- `id/run_id/todo_id/page_task_id/attempt_no`
- `script_revision_id/result(succeeded/assertion_failed/execution_failed/precondition_blocked/recoverable_interruption/decision_required/outcome_unknown/cancelled)`
- `reason_class/last_checkpoint_json/actual_page_json/actual_auth_before_json/actual_auth_after_json`
- `confirmed_outputs_json/partial_outputs_json/side_effects_json/downstream_impact_json/policy_evaluation_id/approval_grant_id nullable`
- `evidence_manifest_id/agent_task_id`
- `started_at/completed_at`
- `UNIQUE(todo_id, attempt_no)`。

尝试终态字段不可更新；后续恢复创建新的 attempt_no。

### 11.6 `run_variables`

- `id/run_id/namespace/name/type/sensitivity/status(confirmed/unconfirmed/revoked)`
- `value_json` 仅 public/sensitive 脱敏值；secret 保存 `secret_ref`
- `source_todo_id/source_attempt_id/source_output_id`
- `created_at/revoked_at`
- confirmed 变量 `UNIQUE(run_id, namespace, name)`；不可原地覆盖，变更用新 namespace 或 revoke + 新记录。

## 12. 决策、命令与事件

### 12.1 `decision_requests`

- `id/context_type(run/authoring)/context_id/run_id/authoring_job_id/todo_id/attempt_id nullable/status(open/answered/applied/withdrawn/expired)`；run_id 与 authoring_job_id 恰有一个非空。
- `category/required_authority/question/facts_json/evidence_refs_json/options_json/recommendation_key/impact_json`；staging 高风险使用 `category=side_effect_approval,required_authority=user`，production 拒绝不创建可批准 decision。
- `state_version/created_by/created_at/answered_at/applied_at`。

`decision_answers`：

- `id/decision_request_id/answer_key/custom_answer/reason/answered_by_type/id/created_at`
- 每个 request 最多一个有效 answer；变更决定创建 superseding request，不覆盖答案。

### 12.2 `side_effect_policy_evaluations` 与 `side_effect_approval_grants`

`side_effect_policy_evaluations` 是 append-only 策略事实：

- `id/context_type(run/authoring)/context_id/run_id/authoring_job_id`；两类上下文恰有一个有效。
- `business_version_id/deployment_revision_id/environment/policy_version/source_plan_sha256`。
- `projection_json_redacted/projection_sha256/result(auto_allowed/approval_required/denied)/reason_codes_json`。
- `supersedes_evaluation_id nullable/decision_request_id nullable/created_at`。
- 同一 source plan + projection + policy 重算返回既有 evaluation；安全投影变化创建新 row，不覆盖旧结论。

`side_effect_approval_grants` 只由已 applied 的 staging 用户决策生成：

- `id/evaluation_id/context_type/context_id/business_version_id/deployment_revision_id/policy_version`。
- `approved_projection_json_redacted/approved_projection_sha256/decision_request_id/decision_answer_id`。
- `status(active/revoked/expired)/approved_by/approved_at/revoked_at/expired_at/reason_json`。
- partial unique 保证每个 context 最多一个 active grant；run/authoring 终态、用户撤销、deployment/policy 改变或投影扩大时失效。
- 只删减高风险 effect/数量时当前投影可以按确定性“子集”规则使用原 grant；任一资源、actor、数量或可逆性扩大都不能使用。grant 永不跨 context、copy 或下一次运行复用。

policy evaluation、decision answer、grant 状态变化和对应 Run/Authoring event 必须同事务提交。浏览器 outbox intent 只有在 evaluation 允许且所需 grant active 时才能写入。

### 12.3 `run_commands`

所有 create/start/pause/resume/cancel/answer/apply 命令记录：

- `id` = 调用方 command ID，PK。
- `run_id/type/request_sha256/status(accepted/completed/rejected)/result_json/error_json/created_at/completed_at`。
- 同 ID 同 hash 返回原结果；同 ID 不同 hash 拒绝冲突。

### 12.4 `run_events`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | UUID PK |
| `run_id` | TEXT | FK |
| `seq` | INTEGER | `UNIQUE(run_id, seq)`，从 1 递增 |
| `schema_version` | INTEGER | 初始 1 |
| `type` | TEXT | 领域事件 token |
| `entity_type/entity_id` | TEXT | run/todo/attempt/page_task/decision/side_effect_approval/evidence/browser_operation |
| `state_version` | INTEGER NULL | 实体更新后版本 |
| `correlation_id/causation_id` | TEXT NULL | 链路因果 |
| `payload_json` | TEXT | 脱敏结构化数据 |
| `occurred_at` | TEXT | 事实发生时间 |
| `created_at` | TEXT | 入库时间 |

分配 seq、更新实体和插入 event 在同一事务中；SSE 只读取此表/内存投影，不自行创造业务状态。

### 12.5 `integration_outbox`

跨服务 intent 使用持久 outbox：

- `id` = 跨服务幂等键，PK。
- `context_type(run/authoring)/context_id`，以及 `run_id/page_task_id/attempt_id` 或 `authoring_job_id/authoring_task_id/authoring_attempt_id` nullable；两类上下文恰有一组有效。
- `target_service(ai_chat_service/proxy_adapter)/command_type/endpoint_or_tool`。
- `request_sha256/payload_json_redacted/secret_binding_ref nullable`；不保存租约 token 或 secret 值。
- `status(pending/dispatching/confirmed/retryable_failed/terminal_failed/cancelled)`。
- `attempt_count/next_attempt_at/last_error_json/result_ref/created_at/updated_at/confirmed_at`。
- 同 id 同 request hash 返回已有结果；不同 hash 拒绝。

业务事务只写 outbox intent，不等待网络。worker 通过相同幂等键派发；超时后先查询外部结果再决定重放。

### 12.6 `external_task_links`

跨服务 opaque ref 与最后核对状态：

- `id/context_type(run/authoring)/context_id`，以及 `run_id/page_task_id/attempt_id` 或 `authoring_job_id/authoring_task_id/authoring_attempt_id` nullable；两类上下文恰有一组有效。
- `service(ai_chat_service/proxy_adapter)`。
- `kind(agent_task/browser_session/browser_lease/browser_operation/artifact)`。
- `external_id/external_state/last_external_seq nullable`。
- `request_sha256/result_sha256/result_ref nullable`。
- `created_at/last_reconciled_at/terminal_at nullable`。
- `UNIQUE(service, kind, external_id)`。

浏览器租约只保存 `external_id` 和 token hash/secret ref；明文 capability 不进入数据库。`browser_operation_links` 继续提供 step 级业务关联，`external_task_links` 提供通用恢复索引。

## 13. 证据与产物

### 13.1 `artifact_objects`

内容寻址对象：

- `id/sha256/size_bytes/media_type/storage_backend/storage_key`
- `sensitivity(public/sensitive/restricted)/redaction_status(not_required/pending/redacted/failed)`
- `encryption_key_ref nullable/ref_count/created_at/expires_at/pinned_at/deleted_at`
- `UNIQUE(sha256, storage_backend, sensitivity)`。

默认本地 backend 使用 `artifacts/objects/<sha256[0..1]>/<sha256>`；DB 不保存大截图、DOM、video 或 trace base64。

### 13.2 `evidence_manifests`

- `id/context_type(run/authoring)/context_id/run_id/authoring_job_id/todo_id/attempt_id nullable/schema_id/status(open/sealed)/supersedes_manifest_id nullable`；run_id 与 authoring_job_id 恰有一个非空。
- `completeness(complete/partial/failed)/manifest_json/manifest_sha256`
- `retention_class(success_7d/failure_30d/pinned/custom)`
- `sealed_at/created_at`。

manifest sealed 后不可修改；补充证据创建新的 manifest revision 或追加 manifest item set，并显式引用前 manifest。

### 13.3 `evidence_items`

- `id/manifest_id/item_type(screenshot/annotated_screenshot/dom_snapshot/operation_result/assertion_result/console_meta/network_meta/video_segment/trace/agent_audit/decision)`
- `artifact_object_id nullable/inline_json nullable`
- `step_id/browser_operation_id/captured_at/source_service`
- `redaction_status/integrity_sha256/metadata_json`
- 每项必须二选一引用 artifact 或小型 inline JSON。

### 13.4 `browser_operation_links`

- `operation_id` PK（proxy operation ID）
- `run_id/page_task_id/todo_id/attempt_id/step_id`
- `proxy_result_status/operation_type/request_sha256/result_ref/evidence_item_id`
- `started_at/completed_at`。

此表只做业务关联；幂等操作账本权威仍在 `proxy-adapter`。

## 14. 删除、归档与保留

- business version 有 run 引用时只能 archive；不能通过删除版本级联删除历史运行。
- asset current 修订不可删除；可 archive 稳定资产并保留 revision。
- 删除运行先写审计命令，标记 deleting，再按 evidence policy 删除 blob；manifest/决策可保留脱敏墓碑用于审计。
- artifact ref_count 归零且超过 retention 后才物理删除；pin 优先于 TTL。
- secret reference 的撤销由密钥提供方负责，数据库只记录引用已 revoked。

## 15. 一致性与事务边界

以下操作必须单事务：

- 激活资产修订并使版本失效待重检。
- 业务版本 copy 及全图引用校验。
- 冻结 run plan、展开 TODO/依赖和初始化 run variables。
- TODO/attempt 状态转换、输出发布、依赖传播和 run event。
- 接受/应用决策与追加 plan amendment。
- 写入 side-effect policy evaluation、应用审批并生成/revoke/expire grant、更新上下文状态和事件。
- seal evidence manifest 与写 completeness/hash。
- 记录一次已完成的 authoring 静态校验或外部验证结果、证据引用和 authoring event。
- current 激活、dependency index、coverage、business version validation 和 authoring event；浏览器/模型验证本身已在事务外完成。

跨服务调用不能纳入 SQLite 事务，采用 outbox/状态机：先记录 intent/command，再调用外部服务，最后以幂等回调/查询收敛。不得在持有 SQLite write transaction 时等待模型或浏览器网络调用。

纯 semantic migration 001、014–018 在独立数据库中按固定顺序执行；015+ 使用 checksum/状态账本覆盖失败 rollback 与 checksum 漂移拒绝。

## 16. 当前实现差距

- semantic v1 已有 business version、独立 current asset graph、稳定功能脚本身份、不可变 revision payload/hash、独立功能脚本 Schema validator、scoped verification、dependency index、verified-scope 激活事务、公开 Authoring API 和可视语义执行。
- `test_runs` 从 verified scenario 原子冻结 base plan、TODO/依赖和初始变量，并通过乐观命令、page task/attempt、Agent/browser 协调、精确依赖传播、恢复/决策应用、持久 seq event 和公开 API/SSE 驱动状态。
- 持久 outbox、opaque external task link 与确定性协调器已接入网络派发、启动恢复和跨服务状态核对；lease token 只进入本机加密 secret store，不写数据库明文。
- 内容寻址 artifact、append-only evidence item 和 sealed manifest 已由协调器接入 proxy 截图/DOM/operation 自动提升；保留清理、脱敏完成和 UI 证据时间线尚未实现。
- 页面 revision 已保存 Origin 无关签名；运行匹配器、完整参数 Schema 和基线采集仍待实现。
- 持久 authoring job/task/attempt/command/event、candidate verification/activation、coverage/dependency 和跨 authoring/run 的 browser FIFO 已接入 bootstrap/recheck/repair。
- 风险投影 hash、policy evaluation/grant/decision、staging 高风险审批、production 业务写硬拒绝和逐 effectId 跨服务参数门禁已交付。

## 17. 验收原则

1. 任一运行能解析到精确 version/deployment/page/requirement/script/scenario revision 与 hash。
2. current asset revision 唯一，payload 不可原地修改；修复产生新 revision。
3. copy 在单事务内重建全部内部 ID，失败不留半版本，相同 request ID 不重复复制。
4. copy 后目标不含指向来源可变资产的引用，只可共享 immutable deployment revision 和 content-addressed blob。
5. 页面签名不含 Origin 或 runtime 值；同分歧义阻止版本 valid。
6. 场景图无环、重复有界、条件不含任意表达式，run plan 能确定性展开 TODO。
7. 状态更新、event seq 和输出发布原子一致，重复命令不产生重复效果。
8. execution attempt 和 sealed evidence 不被重试覆盖。
9. 大媒体不进入 SQLite，秘密值不进入资产、运行变量、事件或证据。
10. 跨服务等待不占用 SQLite 写事务，outbox 可用原幂等键恢复，外部引用可查询收敛。
11. required 脚本/场景未真实验证时版本不能宣称 authoring succeeded；局部修复依赖索引可解释且不重写无关资产。
12. authoring/run 公平队列在 ai-e2e 重启后保持 queue_seq，proxy 只允许队首取得唯一活动 session；嵌套 repair 不产生自等待。
13. 策略评估与 grant 可在重启后恢复，不能跨 context/deployment/policy 复用；production 写计划和缺少有效 staging grant 的高风险计划不能产生浏览器 outbox intent。

## 18. 关联文档

- `version-page-asset-contract.md`：业务版本、页面和 copy 产品语义。
- `semantic-script-schema.md`：功能脚本 revision payload。
- `scenario-orchestration-contract.md`：场景、运行计划、TODO 和尝试语义。
- `run-state-decision-evidence-contract.md`：状态、决策、事件和证据语义。
- `agent-browser-execution-contract.md`：浏览器会话、页面任务和操作关联。
- `service-api-event-contract.md`：outbox、外部任务引用、API 与事件恢复协议。
- `asset-authoring-repair-contract.md`：authoring job、coverage、candidate 验证、影响分析与局部激活。
- `requirements-baseline.md`：总体需求基线。
- `environment-side-effect-policy-contract.md`：风险投影、环境矩阵、policy evaluation 与 approval grant 语义。
