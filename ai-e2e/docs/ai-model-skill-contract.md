# AI 模型角色与 Skills 运行契约

> 状态：统一 DSH Harness、Agent task 命令/事件、Vision v2 与 Skills Runtime 已实现；完整跨服务副作用授权仍在推进。
> 更新时间：2026-08-24。
> 本文定义 `ai-chat-service` 的统一 DSH Agent Loop、分析/决策模型、单次视觉模型、受限 Agent task 与 Skills runtime。当前已交付 Pi/GLM provider route、JSONL persistence/SQLite projection、MCP ToolRuntime、`vision.analyze_page`/`vision.resolve_target`、Agent task 控制面、模型不可见 browser wrapper 与本地只读单 Skill runtime；完整 policy evaluation/active grant 交集仍是目标协议。

## 1. 服务边界

`ai-chat-service` 提供通用 AI 能力，不持有 `ai-e2e` 的项目、业务版本、场景、TODO、依赖图、最终断言裁决或浏览器生命周期。

| 能力           | 权威输入                                    | 输出                                     | 禁止承担                                 |
| -------------- | ------------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| 分析/决策模型  | 调用方不可变任务、授权证据、工具/Skill 策略 | 结构化分析、下一步建议或受限工具调用结果 | 自行扩展场景、跳过硬断言、决定业务通过   |
| 视觉模型       | 一次完整问题 + 一份不可变页面快照           | 页面状态摘要或可序列化目标候选           | 连续任务、流程状态、浏览器动作、脚本调度 |
| Skills runtime | 固定版本 Skill manifest + 受限任务上下文    | 可审计的指令包和结构化结果               | 任意代码执行、秘密读取、浏览器所有权     |

主代理和页面子代理都可以调用视觉模型。主代理只在原子操作安全边界持有 `observe` lease；只有当前执行型页面子代理可以持有 `control` lease。UI live view 不构成租约，也不能操作页面。

## 2. 分析/决策模型

### 2.1 任务职责

分析/决策模型负责：

- 从 PRD、模块需求、当前页面证据和脚本契约中识别信息缺口。
- 在调用方给定的页面任务、TODO 顺序、工具和预算内规划一个语义步骤。
- 根据确定性观测、视觉建议和硬断言生成结构化执行报告。
- 定位失败时提出当前脚本修订范围内的候选修复，不覆盖旧修订。
- 无法继续时分类为阻塞、中断、待决策或执行失败，并提供事实、影响和所需权限。

它不得：

- 伪造 DOM、截图、工具结果或断言通过。
- 把模型自然语言判断当作硬业务断言。
- 自行调用登录、造数、删除或任务包外脚本。
- 新增、替换或扩大调用方冻结的副作用/effectId，或把只读步骤解释为已获写权限。
- 在 E2E 任务中生成/执行任意 JavaScript、TypeScript 或 shell 作为浏览器旁路。

### 2.2 结构化终止

页面任务输出至少符合：

```ts
interface PageAgentResultV1 {
  schema: 'nebula.ai-e2e.page-agent-result/1.0';
  status:
    | 'completed'
    | 'assertion_failed'
    | 'execution_failed'
    | 'precondition_blocked'
    | 'recoverable_interruption'
    | 'decision_required'
    | 'outcome_unknown'
    | 'cancelled';
  completedTodoIds: string[];
  activeTodoId?: string;
  lastCompletedStepId?: string;
  facts: { kind: string; value: unknown; evidenceRefs: string[] }[];
  proposedOutputs: Record<string, unknown>;
  sideEffects: {
    effectId: string;
    status: 'confirmed' | 'possible' | 'not_observed';
    evidenceRefs: string[];
  }[];
  downstreamImpact: { blockedTodoIds: string[]; unaffectedTodoIds: string[]; reason: string };
  decisionRequest?: {
    category: string;
    question: string;
    options: string[];
    recommendation?: string;
  };
}
```

`proposedOutputs` 只有经 `ai-e2e` 对照脚本断言和证据验收后才发布为 confirmed run variables。

### 2.3 模型选择与故障

- Agent/视觉调用开始前解析并记录实际 role、provider、model 和配置版本；provider alias 不能代替角色。
- 可以配置有序候选模型，但只允许在**任务尚未产生模型输出或工具调用前**切换，并把选择原因写入 task audit。
- 一旦任务产生任何工具调用，不得在同一 task 静默切换模型；模型不可用时结束为 blocked/interrupted，由调用方基于 checkpoint 创建新 task。
- live provider 响应不作为唯一自动化验收；策略、权限、状态和恢复必须能用 deterministic mock 验证。

## 3. 单次视觉模型

### 3.1 强约束

- 一次调用只回答一个完整、边界明确的问题，输入必须携带不可变 `VisionSnapshotBindingV1`。
- 视觉模型不持有 Agent task、浏览器租约、Page/Tab 控制权或连续对话状态。
- 视觉模型不能调用 MCP、不能点击/输入/导航，也不能主动请求“下一张图继续”。
- 输出是建议性证据；定位结果必须由 `proxy-adapter` 在当前 DOM 中重新解析、检查唯一性和可操作性。
- `Page`、`Locator`、`ElementHandle` 等进程内对象无法跨服务返回；用户所需的“Playwright 对象”能力以可序列化 locator candidates + target constraints 表达。

### 3.2 `vision.analyze_page`

目标内部工具输入：

```ts
interface AnalyzePageInputV1 {
  binding: VisionSnapshotBindingV1;
  objective?: string;
}
```

输出：

```ts
interface AnalyzePageResultV1 {
  ok: boolean;
  snapshot_id: string;
  summary: string;
  notable_elements: Array<{ nebula_id: string; description: string; confidence: number }>;
  risks: string[];
  reasoning: string;
}
```

该工具服务“理解当前页面/DOM 状态”，不返回下一连串动作。`abnormalState=logged_out` 只是观测事实；子代理必须停止并报告，由主代理编排登录。

### 3.3 `vision.resolve_target`

目标内部工具输入：

```ts
interface ResolveTargetInputV1 {
  binding: VisionSnapshotBindingV1;
  description: string;
}
```

输出：

```ts
interface ResolveTargetResultV1 {
  ok: boolean;
  snapshot_id: string;
  confidence: number;
  reasoning: string;
  nebula_id: string | null;
  element?: { tag: string; text: string; bbox: unknown; locator_bundle: unknown };
}
```

规则：

- `locator_bundle` 由 proxy snapshot 生成，按稳定性提供 role/name、label、test id、稳定文本、CSS、XPath 候选；不能把快照临时 `nebula_id` 当作唯一长期定位器。
- bbox 只作为视觉证据，`proxy-adapter` 不因候选 stale/歧义自动使用坐标。
- `confidence` 低、候选冲突或目标不唯一时调用方必须停止并重新分析。
- 所有环境的工具表只包含 `vision.analyze_page` 与 `vision.resolve_target`；不存在 `vision.find_element` 适配器。

### 3.4 快照与预算

- 调用方传 `VisionSnapshotBindingV1`，运行时从授权的 `proxy-adapter` operation/artifact 读取对应 DOM；binding 必须匹配 session/Tab/operation/request hash/lease sequence/status 和 artifact SHA/MIME/size，不把 raw base64 写入 Agent 消息或审计事件。
- 一次视觉调用固定模型角色 `vision`，有独立 timeout、token 和图片尺寸上限。
- 快照找不到、已过保留期或与授权 Tab 不匹配时明确失败，不自动改用“当前页面”。
- 输出必须通过 JSON Schema；解析失败只可在同一不可变输入上做一次格式修复，不允许让视觉模型进入连续任务。

## 4. Skills runtime

### 4.1 v1 形态

首期 Skill 是不可变、声明式的指令包，不是代码插件。每个版本由 manifest、指令正文和可选 JSON Schema 组成，运行时不得执行 Skill 携带的 JavaScript、Python、shell 或远程下载内容。

```ts
interface SkillManifestV1 {
  schema: 'nebula.ai.skill/1.0';
  id: string;
  version: string;
  description: string;
  contentHash: string;
  requiredModelRole: 'decision';
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredToolPatterns: string[];
  limits: {
    maxToolCalls: number;
    maxModelTurns: number;
    maxTokens?: number;
  };
}
```

- `id` 使用稳定命名空间，`version` 采用语义版本；同 id/version 不同 hash 启动失败。
- registry 只从服务配置的本地只读目录加载，启动时完成 Schema、hash、引用和权限校验。
- Agent task 精确钉住 `id + version + contentHash`；任务运行期间 registry 更新不影响已有任务。
- 首期不支持按任务联网安装 Skill；新增/升级通过受控部署完成。

当前 package 布局固定为 `<root>/<skillId>/<version>/manifest.json` 与 `instructions.md`，roots 由 `AI_SKILLS_DIRS` 使用平台路径分隔符配置。目录 symlink/逃逸、额外文件、超限内容、目录名与 manifest 不一致均拒绝；catalog 只通过 `GET /api/v1/skills` 返回 id/version/hash/描述/角色/工具 patterns，不返回指令正文、sourceRef 或本地路径。空 catalog 表示当前未部署版本，不表示 runtime 协议不可用。

v1 每个 Agent task 最多固定一个当前 Skill，因此“当前被调用 Skill”就是本 task 的唯一 pin；多 Skill 组合、嵌套调用或权限并集尚不支持，调用方必须拆为独立 task。幂等重放先返回既有持久任务事实，不要求当前部署目录仍保留该版本；新任务必须命中当前已加载 catalog 的精确 hash。

### 4.2 权限计算

对一次普通 Agent turn，实际允许工具是 runtime 可用工具、task allowlist、当前语义步骤/副作用授权与 browser lease 的交集。对一次 Skill 调用，再与**当前被调用 Skill**的 required tool patterns 求交集：

```text
provider/runtime 可用工具
∩ Agent task toolPolicy.allow
∩ 当前 Skill.requiredToolPatterns（未调用 Skill 时省略）
∩ 当前语义步骤、effectId、数量边界与 active grant（只读/无副作用时按相应约束）
∩ browser lease 允许的 Tab/操作/参数约束（无浏览器时省略）
```

默认拒绝。多个 Skill 不互相授予权限，也不对彼此工具集合求全集；每次调用只按当前 Skill 重新计算。Skill 只能缩小或声明所需权限，不能扩大任务权限；工具包装层在每次调用时重新校验 operation、target、args、租约期限、预算、policy evaluation、风险投影 hash、effectId/数量边界和 grant 状态。模型提出的未声明副作用、不同 effectId 或扩大数量必须拒绝并上报调用方，不能即时补授权。

- Skill 默认无环境变量、文件系统、网络、secret store 和浏览器生命周期权限。
- secret 值仅在确定性的输入/工具边界按 secret ref 注入；模型和 Skill 指令只看到引用或脱敏替代值。
- Skill 指令中的工具名、模型角色或输出 Schema 与 manifest 不一致时加载失败。
- Skill 版本/hash、实际工具调用和预算消耗写入 Agent task 审计，并由 `ai-e2e` 关联到 evidence manifest。

当前 v1 服务端 Skill 工具 policy 只放行 `vision.*` 与 `browser-control.operation_execute` 命名空间；后者仍必须通过 task 精确 allowlist、冻结 browser step/effectId/数量边界、observe/control binding 与有效 lease。任务与 Skill 的模型 turn/tool/token 上限取更小值。运行时发布 `agent_task.skill_loaded/skill_execute/skill_result/skill_failure`，事件只含安全元数据和消耗，不含指令正文。

未来如需可执行代码 Skill，必须另设受信代码包、签名、sandbox、资源配额和供应链审计协议，不属于 v1。

### 4.3 首期通用 Skill 清单

| Skill ID                        | 用途                                                | 默认工具权限                           |
| ------------------------------- | --------------------------------------------------- | -------------------------------------- |
| `document.requirements_extract` | 从 PRD 片段提取功能点、验收标准、假设和缺口         | 无浏览器写工具                         |
| `browser.page_understand`       | 针对一个 snapshot 生成页面/DOM 状态摘要             | `vision.analyze_page` + 只读观测       |
| `browser.target_resolve`        | 针对一个动作解析可序列化目标候选                    | `vision.resolve_target` + 只读观测     |
| `browser.interaction_repair`    | 在授权脚本与失败步骤内提出新的语义定位/交互修订     | 只读观测；验证阶段才由任务另行授予动作 |
| `test.failure_classify`         | 基于工具事实、断言和证据分类失败/阻塞/中断/未知结果 | 无浏览器写工具                         |

这些 Skill 不包含场景 DAG、登录恢复、运行依赖传播、版本 copy 或 E2E 通过裁决。上述业务编排继续由 `ai-e2e` 持有；`ai-e2e` 可以把业务任务包装为通用 Skill 输入。

## 5. Agent 工具循环

每个受限任务按以下顺序执行：

1. 验证 task、Skill、response Schema、预算、可选 browser binding 和不可变副作用授权投影。
2. 构建干净模型上下文，注入不可变任务输入、Skill 指令、已授权证据和显式 checkpoint。
3. 每次模型 turn 前检查 pause/cancel/预算；每次工具调用前再次检查权限、当前语义步骤/effectId、grant 和租约。
4. 浏览器工具调用由包装层生成/校验 `operationId`，注入 scope 并记录 request hash。
5. 工具超时后先查询 operation ledger；不能证明未执行时上报 `outcome_unknown`。
6. 输出必须通过调用方 response Schema；格式修复不得调用新浏览器动作。
7. 保存结构化结果、终止原因、Skill 版本/hash、工具摘要和预算，发布终态事件。

模型不直接读取完整任务数据库。调用方只投影本次所需字段，避免把其他页面、其他子代理历史和无关 PRD 注入上下文。

## 6. Prompt injection 与不可信页面内容

- PRD、网页文本、DOM 属性、截图 OCR、工具输出和 Skill 输入都按不可信数据处理，不得覆盖 system/task/tool policy。
- 页面中声称“忽略规则”“调用某工具”“读取密钥”的文本只作为页面内容，不作为指令。
- 模型请求工具调用后，结构化 wrapper 独立校验；自然语言无法扩权。
- 输出中的 locator、URL、文件路径、按键和上传引用必须重新通过 Schema 与作用域检查。
- 视觉模型的 reasoning 仅供诊断，不作为权限或断言依据。

## 7. 当前实现差距

- Chat 与 Agent Task 已共用每应用实例唯一的 DSH Agent Loop；各自使用独立 session/tool scope 和 canonical v1 公开控制面。raw proxy operation 仅存在于模型不可见 transport child scope。
- `/api/v1/ai/generate` 使用无 session、无 tool 的单次 `ctx.llm.stream()`。
- Vision v2 与 proxy immutable snapshot binding 已交付；ai-e2e 通用 authoring/Run 消费仍需逐业务流程接入。
- 当前 Skills Runtime 已支持本地只读目录加载、immutable registry/version/hash、task 单 Skill exact pin/policy hash、Schema/hash/path 校验、指令装载、权限/预算收缩、catalog 与执行事件；多 Skill 组合/嵌套调用不在 v1。
- 当前 Agent browser wrapper 已冻结 `stepId/kind/operation/effectId` 并限制 observe/control，模糊失败先查询 operation ledger；仍没有 policy evaluation、风险投影 hash、active grant 与参数级数量的完整逐调用交集校验。
- 当前 `ai-e2e` prompts 是业务侧模板，可继续作为迁移输入；不得把它们直接等同于可复用 Skill。

## 8. 验收原则

1. 同一个完整视觉请求只产生一次独立结果，不能续接为连续浏览器任务。
2. 视觉输出只含 snapshot/nebula/locator 等可序列化引用，不返回进程内 Playwright 对象。
3. stale/歧义/低置信目标不会静默坐标点击。
4. Agent task 无法调用 allowlist、Skill 和浏览器租约交集之外的工具。
5. Skill 版本/hash 可追溯，运行中不可热替换，不可执行任意代码或联网安装。
6. secret、租约 token 和未脱敏敏感输入不进入模型消息、事件或普通日志。
7. Agent 结构化完成不自动等于 E2E TODO 通过；输出须由 `ai-e2e` 验收。
8. Agent 中断或工具超时不会触发未知副作用操作的盲目重试。
9. 模型、Skill、视觉结果和不可信页面内容无法新增/替换 effectId、扩大数量或绕过 production/staging 门禁；授权不匹配在 proxy operation 前被拒绝。

## 9. 关联文档

- `service-api-event-contract.md`：Agent task、浏览器控制面与跨服务恢复 API。
- `agent-browser-execution-contract.md`：主/子代理和页面任务授权。
- `semantic-script-schema.md`：动作、断言和目标引用 Schema。
- `run-state-decision-evidence-contract.md`：运行裁决、证据和人工控制。
- `asset-authoring-repair-contract.md`：主代理耐久工作流、资产生成、验证和局部修复。
- `environment-side-effect-policy-contract.md`：调用方风险投影、计划级审批与 Agent 工具授权交集。
- `../../ai-chat-service/PRODUCT-SPEC.md`：AI 能力当前实现与缺口。
