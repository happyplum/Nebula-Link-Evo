# AI E2E 目标数据模型

> 状态：目标技术契约，尚未实现。
> 更新时间：2026-08-12。
> 本文定义 `ai-e2e` 首期最终关系模型、不可变修订、版本复制事务、页面规范化、运行数据与证据存储。迁移编号和物理 SQL 在实施时按现有 SQLite migration 链追加，但不得改变本文的所有权和唯一性约束。

## 1. 存储原则

- `ai-e2e` 继续使用独立 SQLite，不与 `proxy-adapter` 或 `ai-chat-service` 共享数据库或跨库外键。
- 新实体 ID 使用 `crypto.randomUUID()` 生成的 UUID v4 字符串；现有 16 位 hex ID 作为 legacy ID 保留，不要求重写。
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
│  ├─ page_definitions ── page_definition_revisions
│  │  └─ page_baseline_variants ── page_baseline_revisions
│  ├─ business_modules ── business_module_revisions
│  │  └─ functional_modules ── functional_module_revisions
│  │     ├─ module_requirement_revisions
│  │     └─ functional_scripts ── functional_script_revisions
│  ├─ test_scenarios ── test_scenario_revisions
│  └─ version_variable_definitions
└─ test_runs
   ├─ run_plans ── run_plan_amendments
   ├─ run_todos ── run_todo_dependencies
   ├─ page_tasks ── execution_attempts
   ├─ run_variables
   ├─ decision_requests ── decision_answers
   ├─ run_commands
   ├─ run_events
   └─ evidence_manifests ── evidence_items ── artifact_objects
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
- 激活新修订时，同一事务内校验 `valid`、把旧 current 改为 superseded、把新修订改为 current，并把业务版本状态改为 `needs_recheck`。
- rejected 修订永不成为 current；需要再次修改时创建新修订。

## 4. 项目、部署与业务版本

### 4.1 `projects`

保留现有项目作为长期容器。目标上：

| 字段 | 变化 |
|---|---|
| `id/name/created_at/updated_at` | 保留 |
| `status` | 只表示项目工作流/展示阶段，不再表示某次测试流程结果 |
| `target_base_url` | 迁移期只读 legacy；目标部署由 deployment revision 提供 |
| `auth_config_json` | 迁移为 secret reference 结构后废弃明文/自由 JSON |

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
| `copy_request_id` | TEXT NULL | copy 幂等键，项目内唯一 |
| `validation_status` | TEXT | `draft/validating/needs_recheck/valid/invalid/archived` |
| `schema_version` | INTEGER | 初始为 1 |
| `git_metadata_json` | TEXT NULL | 版本声明的可选 Git/部署备注，不替代运行冻结值 |
| `created_by` | TEXT | 用户/系统引用 |
| `created_at/updated_at` | TEXT |  |
| `archived_at` | TEXT NULL |  |

`version_key` 格式与 script key 相同；归档版本只读，可查看、复制和读取历史运行，不能产生新资产修订。

### 4.4 `version_deployment_bindings`

| 字段 | 类型 | 约束 |
|---|---|---|
| `business_version_id` | TEXT | FK |
| `deployment_revision_id` | TEXT | 精确 immutable revision FK |
| `binding_key` | TEXT | `default` 或命名运行目标 |
| `is_default` | INTEGER | 每版本最多一个 true |
| `created_at` | TEXT |  |

同一版本可以绑定多个兼容环境；运行必须显式解析到其中一个精确 revision。copy 复制 binding row，不复制秘密，也不依赖部署 profile 的可变 current。

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

- `id/business_version_id/name/type/sensitivity/constraints_json/default_json/secret_ref/created_at`
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
  inputs: ScenarioInputDefinition[];
  finalAcceptance: ScenarioAssertion[];
  calls: ScenarioCallNode[];
  edges: ScenarioEdge[];
  exports: ScenarioExport[];
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
- scenario revision 引用脚本稳定 ID；run plan 冻结时解析到 current valid script revision。

## 9. 业务版本 copy 事务

### 9.1 原子算法

copy 使用 `copy_request_id` 幂等并执行 `BEGIN IMMEDIATE`：

1. 读取并锁定来源业务版本；archived 来源允许只读复制，invalid、结构不完整或缺少可选中 current valid 修订的来源拒绝复制。
2. 固化来源 current revision ID、hash 和版本 deployment bindings 清单。
3. 创建目标 business_version，状态 `needs_recheck`，记录 source version 和 copy request。
4. 为页面、模块、脚本、场景、基线、变量定义和版本决策生成新稳定 ID，建立事务内 old→new map。
5. 为每项资产创建 revision_no=1 的目标修订，payload 中所有版本内部 ID 使用 map 重写，并记录 source asset/revision。
6. 复制 PRD、deployment binding、current decisions 和基线 manifest；不复制运行、事件、证据 manifest、实际变量、会话或密钥值。
7. 对内容寻址 artifact 只新增独立 evidence/baseline item 引用并增加 ref count；blob 不物理复制，但不可变内容和生命周期不能受来源版本编辑影响。
8. 执行全图引用校验、Schema 校验、hash 校验、无环检查和唯一页面签名检查。
9. 校验失败整体 rollback；成功 commit 并返回目标版本/资产数量与需要重新检查的页面清单。

SQLite `BEGIN IMMEDIATE` 防止 copy 期间来源 current 指针变化。重复相同 `copy_request_id` 返回第一次结果，不产生第二份版本。

### 9.2 独立性判定

copy 后必须满足：

- 目标任一稳定 asset ID 与来源不同。
- 目标 payload 内不存在指向来源版本可变资产的 FK/ID。
- 修改、修复、归档或删除目标资产不改变来源 current revision。
- 共享只允许项目级 immutable deployment revision 和 content-addressed immutable blob。
- 来源审计字段不参与运行解析。

## 10. 运行与编排表

### 10.1 `test_runs`

| 字段 | 类型 | 约束/语义 |
|---|---|---|
| `id` | TEXT | UUID PK |
| `project_id/business_version_id` | TEXT | FK |
| `scenario_revision_id` | TEXT | 精确修订 |
| `deployment_revision_id` | TEXT | 精确修订 |
| `lifecycle` | TEXT | created/planning/ready/running/paused/completing/completed/cancelling/cancelled |
| `outcome` | TEXT NULL | passed/failed/cancelled，仅终态 |
| `state_version` | INTEGER | optimistic concurrency，从 1 递增 |
| `next_event_seq` | INTEGER | 下一 run event 序号 |
| `browser_session_id` | TEXT NULL | proxy opaque ref |
| `active_page_task_id` | TEXT NULL | 首期最多一个 |
| `pause_reason_json` | TEXT NULL | 结构化暂停原因 |
| `summary_json` | TEXT NULL | 终态统计，不是状态源 |
| `started_at/completed_at/created_at` | TEXT |  |

约束：首期同一 run 最多一个 active page task；同一 browser session 最多一个 active run 写租约，由服务和 proxy 双重校验。

### 10.2 `run_plans`

每个 run 恰好一个不可变基础计划：

- `id/run_id/schema_id/payload_json/content_sha256/created_at`
- `UNIQUE(run_id)`。
- payload 冻结版本、deployment/Git、场景/脚本/页面/需求精确修订、展开 TODO、输入定义和最终验收。

`run_plan_amendments`：

- `id/run_id/sequence/reason/category/decision_id nullable/payload_json/content_sha256/created_by/created_at`
- `UNIQUE(run_id, sequence)`。
- category：`script_repair/recovery/login/cleanup/operator_decision`。
- amendment 只追加替换/新增指令，不改写 base payload 或旧 amendment。

### 10.3 `run_todos`

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
| `published_outputs_json` | TEXT NULL | 仅成功或主代理显式确认 |
| `partial_outputs_json` | TEXT NULL | 只供证据/恢复，标记未确认 |
| `side_effect_summary_json` | TEXT NULL |  |
| `block_reason_json/skip_reason_json` | TEXT NULL | 含传播链 |
| `current_attempt_id` | TEXT NULL |  |
| `started_at/completed_at` | TEXT NULL |  |

`run_todo_dependencies`：`run_id/from_todo_id/to_todo_id/mode/requires_outputs_json`，复合唯一；写入前无环校验。

### 10.4 `page_tasks`

- `id/run_id/task_no/state(created/running/paused/completed/failed/interrupted/cancelled)`
- `todo_ids_json`（固定有序、至少一个）
- `page_definition_revision_id/browser_session_id/tab_id`
- `control_lease_ref_hash`（不存 capability 明文）
- `ai_task_id/ai_session_id nullable`
- `tool_policy_hash/task_payload_sha256/budget_json/checkpoint_json/result_json`
- `started_at/completed_at/created_at`。

### 10.5 `execution_attempts`

- `id/run_id/todo_id/page_task_id/attempt_no`
- `script_revision_id/result(succeeded/assertion_failed/execution_failed/precondition_blocked/recoverable_interruption/decision_required/outcome_unknown/cancelled)`
- `reason_class/last_checkpoint_json/actual_page_json`
- `confirmed_outputs_json/partial_outputs_json/side_effects_json/downstream_impact_json`
- `evidence_manifest_id/agent_task_id`
- `started_at/completed_at`
- `UNIQUE(todo_id, attempt_no)`。

尝试终态字段不可更新；后续恢复创建新的 attempt_no。

### 10.6 `run_variables`

- `id/run_id/namespace/name/type/sensitivity/status(confirmed/unconfirmed/revoked)`
- `value_json` 仅 public/sensitive 脱敏值；secret 保存 `secret_ref`
- `source_todo_id/source_attempt_id/source_output_id`
- `created_at/revoked_at`
- confirmed 变量 `UNIQUE(run_id, namespace, name)`；不可原地覆盖，变更用新 namespace 或 revoke + 新记录。

## 11. 决策、命令与事件

### 11.1 `decision_requests`

- `id/run_id/todo_id/attempt_id nullable/status(open/answered/applied/withdrawn/expired)`
- `category/required_authority/question/facts_json/evidence_refs_json/options_json/recommendation_key/impact_json`
- `state_version/created_by/created_at/answered_at/applied_at`。

`decision_answers`：

- `id/decision_request_id/answer_key/custom_answer/reason/answered_by_type/id/created_at`
- 每个 request 最多一个有效 answer；变更决定创建 superseding request，不覆盖答案。

### 11.2 `run_commands`

所有 create/start/pause/resume/cancel/answer/apply 命令记录：

- `id` = 调用方 command ID，PK。
- `run_id/type/request_sha256/status(accepted/completed/rejected)/result_json/error_json/created_at/completed_at`。
- 同 ID 同 hash 返回原结果；同 ID 不同 hash 拒绝冲突。

### 11.3 `run_events`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | UUID PK |
| `run_id` | TEXT | FK |
| `seq` | INTEGER | `UNIQUE(run_id, seq)`，从 1 递增 |
| `schema_version` | INTEGER | 初始 1 |
| `type` | TEXT | 领域事件 token |
| `entity_type/entity_id` | TEXT | run/todo/attempt/page_task/decision/evidence/browser_operation |
| `state_version` | INTEGER NULL | 实体更新后版本 |
| `correlation_id/causation_id` | TEXT NULL | 链路因果 |
| `payload_json` | TEXT | 脱敏结构化数据 |
| `occurred_at` | TEXT | 事实发生时间 |
| `created_at` | TEXT | 入库时间 |

分配 seq、更新实体和插入 event 在同一事务中；SSE 只读取此表/内存投影，不自行创造业务状态。

## 12. 证据与产物

### 12.1 `artifact_objects`

内容寻址对象：

- `id/sha256/size_bytes/media_type/storage_backend/storage_key`
- `sensitivity(public/sensitive/restricted)/redaction_status(not_required/pending/redacted/failed)`
- `encryption_key_ref nullable/ref_count/created_at/expires_at/pinned_at/deleted_at`
- `UNIQUE(sha256, storage_backend, sensitivity)`。

默认本地 backend 使用 `artifacts/objects/<sha256[0..1]>/<sha256>`；DB 不保存大截图、DOM、video 或 trace base64。

### 12.2 `evidence_manifests`

- `id/run_id/todo_id/attempt_id nullable/schema_id/status(open/sealed)/supersedes_manifest_id nullable`
- `completeness(complete/partial/failed)/manifest_json/manifest_sha256`
- `retention_class(success_7d/failure_30d/pinned/custom)`
- `sealed_at/created_at`。

manifest sealed 后不可修改；补充证据创建新的 manifest revision 或追加 manifest item set，并显式引用前 manifest。

### 12.3 `evidence_items`

- `id/manifest_id/item_type(screenshot/annotated_screenshot/dom_snapshot/operation_result/assertion_result/console_meta/network_meta/video_segment/trace/agent_audit/decision)`
- `artifact_object_id nullable/inline_json nullable`
- `step_id/browser_operation_id/captured_at/source_service`
- `redaction_status/integrity_sha256/metadata_json`
- 每项必须二选一引用 artifact 或小型 inline JSON。

### 12.4 `browser_operation_links`

- `operation_id` PK（proxy operation ID）
- `run_id/page_task_id/todo_id/attempt_id/step_id`
- `proxy_result_status/operation_type/request_sha256/result_ref/evidence_item_id`
- `started_at/completed_at`。

此表只做业务关联；幂等操作账本权威仍在 `proxy-adapter`。

## 13. 删除、归档与保留

- business version 有 run 引用时只能 archive；不能通过删除版本级联删除历史运行。
- asset current 修订不可删除；可 archive 稳定资产并保留 revision。
- 删除运行先写审计命令，标记 deleting，再按 evidence policy 删除 blob；manifest/决策可保留脱敏墓碑用于审计。
- artifact ref_count 归零且超过 retention 后才物理删除；pin 优先于 TTL。
- secret reference 的撤销由密钥提供方负责，数据库只记录引用已 revoked。

## 14. 一致性与事务边界

以下操作必须单事务：

- 激活资产修订并使版本失效待重检。
- 业务版本 copy 及全图引用校验。
- 冻结 run plan、展开 TODO/依赖和初始化 run variables。
- TODO/attempt 状态转换、输出发布、依赖传播和 run event。
- 接受/应用决策与追加 plan amendment。
- seal evidence manifest 与写 completeness/hash。

跨服务调用不能纳入 SQLite 事务，采用 outbox/状态机：先记录 intent/command，再调用外部服务，最后以幂等回调/查询收敛。不得在持有 SQLite write transaction 时等待模型或浏览器网络调用。

## 15. 当前实现差距

- 现有项目级表没有 business version；module、URL、scenario 和 script 均直接归项目链路。
- 现有 `scripts` 把 scenario 级 TypeScript 文本与可变 status 放在同表，没有稳定功能脚本身份、不可变 revision payload 或 content hash。
- 现有 `execution_runs` 只关联 script，无法表达 run plan、TODO、page task、attempt、变量、决策、事件或 evidence manifest。
- 现有截图路径和日志直接挂在 execution run，没有内容寻址、完整度、脱敏、保留和跨服务产物提升。
- 现有 URL 表把实际 URL、单快照和逻辑页面混为一个实体。

## 16. 验收原则

1. 任一运行能解析到精确 version/deployment/page/requirement/script/scenario revision 与 hash。
2. current asset revision 唯一，payload 不可原地修改；修复产生新 revision。
3. copy 在单事务内重建全部内部 ID，失败不留半版本，相同 request ID 不重复复制。
4. copy 后目标不含指向来源可变资产的引用，只可共享 immutable deployment revision 和 content-addressed blob。
5. 页面签名不含 Origin 或 runtime 值；同分歧义阻止版本 valid。
6. 场景图无环、重复有界、条件不含任意表达式，run plan 能确定性展开 TODO。
7. 状态更新、event seq 和输出发布原子一致，重复命令不产生重复效果。
8. execution attempt 和 sealed evidence 不被重试覆盖。
9. 大媒体不进入 SQLite，秘密值不进入资产、运行变量、事件或证据。
10. 跨服务等待不占用 SQLite 写事务。

## 17. 关联文档

- `version-page-asset-contract.md`：业务版本、页面和 copy 产品语义。
- `semantic-script-schema.md`：功能脚本 revision payload。
- `scenario-orchestration-contract.md`：场景、运行计划、TODO 和尝试语义。
- `run-state-decision-evidence-contract.md`：状态、决策、事件和证据语义。
- `agent-browser-execution-contract.md`：浏览器会话、页面任务和操作关联。
- `requirements-baseline.md`：总体需求基线。
