# AI E2E 语义功能脚本 Schema v1

> 状态：目标技术契约，尚未实现。
> Schema ID：`nebula.ai-e2e.functional-script/1.0`。
> 本文锁定首期可持久化脚本的字段、动作/断言白名单、引用规则和静态校验。数据库修订结构见 `target-data-model.md`；浏览器原子操作协议见 `agent-browser-execution-contract.md`。

## 1. 设计约束

- 脚本是纯 JSON 数据，不包含 TypeScript、JavaScript、模板代码或可执行表达式。
- 一个脚本只完成一个功能模块内的业务目的，步骤线性有序，不调用其他脚本。
- 每个步骤最多包含一个主要动作，动作前后检查分别由断言表达。
- 输入、输出、页面和目标全部显式声明；未声明的运行变量不可见。
- 业务断言是不可静默降级的资产。修复可以改目标定位和交互参数，不能删除或弱化断言。
- Schema 使用 camelCase；持久化状态 token、ID 和引用值使用小写 snake_case 或 UUID 字符串。

## 2. 顶层结构

```ts
interface FunctionalScriptDefinitionV1 {
  schema: 'nebula.ai-e2e.functional-script/1.0';
  scriptKey: string;
  name: string;
  purpose: string;
  moduleId: string;
  pageScope: PageScope;
  inputs: InputDefinition[];
  preconditions: Assertion[];
  steps: SemanticStep[];
  finalAssertions: Assertion[];
  outputs: OutputDefinition[];
  sideEffects: SideEffectDeclaration[];
  executionPolicy?: ExecutionPolicy;
  tags?: string[];
}
```

脚本修订号、数据库 revision ID、作者、变更理由、内容哈希和激活状态属于修订元数据，不重复写入定义 JSON。运行计划同时冻结 revision ID 与内容哈希。

### 2.1 通用限制

- `scriptKey` 在一个业务版本内唯一，格式为 `^[a-z][a-z0-9_.-]{2,63}$`。
- `name` 长度 1–120，`purpose` 长度 1–1000。
- `steps` 数量 1–100；所有输入、步骤、断言、输出和副作用 ID 在各自作用域内唯一。
- 任意单个字符串字面量不超过 16 KiB；定义 JSON 不超过 1 MiB。
- 未声明字段默认拒绝；Schema 升级必须使用新的 `schema` 值，不能在 1.0 下改变语义。

## 3. 页面范围

```ts
interface PageScope {
  entryPageId: string;
  allowedTransitions: PageTransition[];
  successPageId?: string;
}

interface PageTransition {
  fromPageId: string;
  toPageId: string;
  reason: string;
  mayOpenNewTab?: boolean;
}
```

- `entryPageId`、`successPageId` 和转换页面必须属于同一业务版本。
- 未声明的跨页导航使当前尝试停止并上报，不由子代理临时扩展范围。
- 弹窗、抽屉和普通页面内 Tab 不作为 `PageTransition`；它们由目标和断言描述。

## 4. 输入定义与值引用

```ts
type ValueType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'uuid'
  | 'date'
  | 'enum'
  | 'object'
  | 'array'
  | 'artifact_ref'
  | 'secret_ref';

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

interface InputDefinition {
  id: string;
  name: string;
  type: ValueType;
  required: boolean;
  sensitivity: 'public' | 'sensitive' | 'secret';
  description: string;
  constraints?: ValueConstraints;
  default?: JsonValue;
}

interface ValueConstraints {
  enum?: JsonScalar[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  itemType?: Exclude<ValueType, 'array'>;
  requiredProperties?: string[];
}
```

- `secret` 输入的类型必须是 `secret_ref`，不能有真实默认值。
- 页面子代理只看到 secret reference；任务工具适配层在提交浏览器原子操作前解析真实值并直接注入参数，模型消息、普通日志和运行变量不接触明文。
- `object` 和 `array` 必须声明约束；未知自由对象不通过版本校验。
- 动态测试数据在运行计划阶段生成并冻结为输入，不允许脚本运行中读取当前时间或随机数。

动作参数和断言期望值使用受控值表达式：

```ts
type ValueExpression =
  | { kind: 'literal'; value: JsonValue }
  | { kind: 'input'; inputId: string }
  | { kind: 'step_output'; stepId: string; outputId: string }
  | { kind: 'concat'; values: ValueExpression[] };
```

- `concat` 只接受最终可转为字符串的值，最多 20 段。
- 不支持数学表达式、函数调用、属性路径、模板执行或任意代码。
- `step_output` 只能引用当前步骤之前已声明的临时提取结果。

场景到脚本的输入绑定使用另一层受控来源：

```ts
type InputBinding =
  | { kind: 'literal'; value: JsonValue }
  | { kind: 'scenario_input'; name: string }
  | { kind: 'version_variable'; name: string }
  | { kind: 'call_output'; callKey: string; outputId: string }
  | { kind: 'secret'; secretRef: string }
  | { kind: 'generated'; generator: 'uuid' | 'unique_string'; prefix?: string; maxLength?: number };
```

`call_output` 在运行计划展开时解析为具体上游 TODO；`generated` 值在浏览器动作开始前由主代理生成并写入冻结 TODO 输入，相同 TODO 重派沿用原值，避免重复造数。

## 5. 目标引用

```ts
interface TargetDefinition {
  semantic: string;
  candidates: LocatorCandidate[];
  expected: TargetExpectation;
  baselineHint?: {
    pageBaselineVariantId?: string;
    snapshotId?: string;
    nebulaId?: string;
  };
}

type LocatorCandidate =
  | { strategy: 'role'; role: string; name?: ValueExpression; exact?: boolean }
  | { strategy: 'test_id'; value: ValueExpression }
  | { strategy: 'label'; value: ValueExpression; exact?: boolean }
  | { strategy: 'placeholder'; value: ValueExpression; exact?: boolean }
  | { strategy: 'text'; value: ValueExpression; exact?: boolean }
  | { strategy: 'css'; value: string }
  | { strategy: 'xpath'; value: string };

interface TargetExpectation {
  cardinality: 'exactly_one' | 'at_least_one' | 'zero_or_one';
  visible?: boolean;
  enabled?: boolean;
  editable?: boolean;
}
```

规则：

- `semantic` 必填，是视觉分析、日志和修复的业务目标说明。
- 浏览器动作只允许 `exactly_one`；`at_least_one` 用于集合观察，`zero_or_one` 只用于 not-exists/hidden 等负向断言。
- 候选按稳定性排序保存；执行时 `proxy-adapter` 基于当前 DOM 重新解析，不直接信任旧 snapshot/marker。
- `css` 和 `xpath` 只能作为较低优先级候选；新脚本至少还应提供一个语义候选，除非版本决策显式豁免。
- 持久脚本不保存坐标。坐标视觉兜底属于单次执行尝试，必须记录现场且不能自动写回脚本。
- 目标歧义、不可见或已过期时返回结构化解析失败，不静默选择第一个。

## 6. 语义步骤

```ts
interface SemanticStep {
  id: string;
  name: string;
  intent: string;
  preconditions?: Assertion[];
  action: BrowserAction;
  postconditions: Assertion[];
  captures?: StepCapture[];
  checkpoint?: 'none' | 'after_verified';
  sideEffectId?: string;
  timeoutMs?: number;
}
```

- `id` 格式 `^step_[a-z0-9_.-]{1,48}$`，修复定位时保持不变；业务步骤含义变化时创建新 ID。
- `postconditions` 可以为空的只有纯只读观测步骤；有副作用动作至少有一项操作后断言。
- `checkpoint: after_verified` 只在 postconditions 全部通过后形成恢复检查点。
- `sideEffectId` 必须引用脚本顶层副作用声明；无业务写入时省略。

## 7. 动作白名单

```ts
type BrowserAction =
  | { type: 'navigate'; pageAnchor: PageAnchorExpression; waitFor: 'commit' | 'domcontentloaded' | 'load' }
  | { type: 'click'; target: TargetDefinition; button?: 'left' | 'middle' | 'right'; clickCount?: 1 | 2 }
  | { type: 'fill'; target: TargetDefinition; value: ValueExpression }
  | { type: 'type_text'; target: TargetDefinition; value: ValueExpression; delayMs?: number }
  | { type: 'press'; target?: TargetDefinition; key: AllowedKey }
  | { type: 'select_option'; target: TargetDefinition; values: ValueExpression[] }
  | { type: 'check'; target: TargetDefinition }
  | { type: 'uncheck'; target: TargetDefinition }
  | { type: 'focus'; target: TargetDefinition }
  | { type: 'blur'; target: TargetDefinition }
  | { type: 'hover'; target: TargetDefinition }
  | { type: 'scroll'; target?: TargetDefinition; direction: 'up' | 'down' | 'left' | 'right'; amount: number }
  | { type: 'set_files'; target: TargetDefinition; artifacts: ValueExpression[] }
  | { type: 'switch_tab'; match: TabMatch }
  | { type: 'close_tab'; tab: 'active'; returnTo: TabMatch };

type BaseKey =
  | 'Enter'
  | 'Tab'
  | 'Escape'
  | 'Space'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown';

type AllowedKey =
  | BaseKey
  | { key: BaseKey; modifiers: ('Alt' | 'Control' | 'Meta' | 'Shift')[] };
```

### 7.1 动作规则

- `navigate` 只接收页面锚点表达式，不接受任意完整 URL；Origin 来自冻结部署。
- `fill` 清空后设置最终值，是普通表单默认动作；`type_text` 只用于必须模拟逐字键入的控件。
- `delayMs` 范围 0–100，属于可视输入节奏，不用作正确性等待。
- `press` 的 `AllowedKey` 首期为 `Enter`、`Tab`、`Escape`、`Space`、方向键、`Home`、`End`、`PageUp`、`PageDown` 及带受控 modifier 的组合；不接收任意键盘宏。
- `scroll.amount` 为 1–5000 CSS pixels，动作后仍通过断言判断是否到达目标。
- `set_files` 只接收运行 artifact reference；模型不能提供本地文件路径。
- `switch_tab`/`close_tab` 只能操作控制租约内的 Tab，并验证目标页面锚点。
- 不允许 `dispatch`、`page.evaluate`、`dom_script`、任意 JS、Shell、坐标点击或裸 CSS 操作作为动作类型。
- 不提供固定 sleep。等待由断言轮询和 Playwright actionability 完成；禁止 `networkidle` 作为完成条件。

### 7.2 Tab 匹配

```ts
interface TabMatch {
  pageId?: string;
  openerStepId?: string;
  titleContains?: ValueExpression;
}
```

Tab 匹配至少声明 `pageId` 或 `openerStepId`。多个 Tab 同时匹配时停止并上报歧义。

## 8. 断言白名单

```ts
interface Assertion {
  id: string;
  kind: AssertionKind;
  target?: TargetDefinition;
  expected?: ValueExpression | PageAnchorExpression;
  comparator?: Comparator;
  attribute?: string;
  baselineVariantId?: string;
  timeoutMs?: number;
  message: string;
}
```

### 8.1 `AssertionKind`

页面与 Tab：

- `page.matches_anchor`
- `page.title`
- `page.url`
- `tab.count`
- `tab.active_matches`

元素状态：

- `element.exists`
- `element.not_exists`
- `element.visible`
- `element.hidden`
- `element.enabled`
- `element.disabled`
- `element.editable`
- `element.checked`
- `element.unchecked`

元素值：

- `element.text`
- `element.value`
- `element.attribute`
- `element.count`

浏览器产物：

- `download.created`
- `screenshot.diff_ratio`

### 8.2 `Comparator`

```ts
type Comparator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte';
```

- 布尔状态断言不填写 comparator/expected。
- `page.matches_anchor` 的 expected 必须是页面锚点；`element.attribute` 必须填写 `attribute`，且属性名只允许字母、数字、`_`、`-`、`:`；`screenshot.diff_ratio` 必须填写 `baselineVariantId`。
- 首期不提供任意正则、JavaScript predicate、模型自然语言判定或软断言。
- `screenshot.diff_ratio` 是确定性像素/感知哈希比较，需要冻结基线与数值阈值；视觉模型输出只能作为观察证据，不能单独决定硬断言通过。
- 断言轮询默认 10 秒、间隔 250ms；每项最大 60 秒。超时返回最后实际值和观测证据。

## 9. 步骤采集与输出

```ts
interface StepCapture {
  id: string;
  source:
    | { kind: 'element_text'; target: TargetDefinition }
    | { kind: 'element_value'; target: TargetDefinition }
    | { kind: 'element_attribute'; target: TargetDefinition; attribute: string }
    | { kind: 'url_path_param'; name: string }
    | { kind: 'url_query_param'; name: string }
    | { kind: 'download_artifact' };
  type: ValueType;
  sensitivity: 'public' | 'sensitive' | 'secret';
}

interface OutputDefinition {
  id: string;
  name: string;
  from: { stepId: string; captureId: string } | { inputId: string };
  type: ValueType;
  sensitivity: 'public' | 'sensitive' | 'secret';
  description: string;
}
```

- capture 在步骤 postconditions 通过后写入尝试暂存区。
- 顶层 finalAssertions 全部通过后才发布 `outputs`。
- `secret` 输出只发布 secret reference；运行变量和证据不保存真实值。
- 类型转换失败是脚本失败，不能把原始字符串当作不同类型继续。

## 10. 副作用声明

```ts
interface SideEffectDeclaration {
  id: string;
  kind: 'create' | 'update' | 'delete' | 'auth_change';
  resourceType: string;
  identityFrom: ValueExpression | { stepId: string; captureId: string };
  verifyApplied: Assertion[];
  retryPolicy: 'verify_before_retry' | 'never_retry';
  cleanupScriptKey?: string;
}
```

- 只读脚本的 `sideEffects` 为空数组。
- create/update/delete/auth 动作必须由步骤引用声明，并提供至少一项 `verifyApplied`。
- `auth_change` 的 `verifyApplied` 必须确定性证明登录后的身份/角色或退出后的匿名态；`identityFrom` 只能解析为非秘密 actor 别名或页面身份标记，不能使用密码、Token 或 secret reference 作为身份。
- `cleanupScriptKey` 只是向场景规划提供候选，原脚本不能直接调用它。
- `never_retry` 仍允许主代理在用户/版本规则允许且人工确认后新建尝试，但不能由子代理自动重放。
- `verify_before_retry` 遇到超时或断连时先执行只读检查；确认未发生才能创建新的动作 ID。

## 11. 执行策略

```ts
interface ExecutionPolicy {
  actionTimeoutMs?: number;
  assertionTimeoutMs?: number;
  targetResolveAttempts?: number;
  observationAttempts?: number;
}
```

首期默认与限制：

| 字段 | 默认 | 允许范围 |
|---|---:|---:|
| `actionTimeoutMs` | 15,000 | 1,000–60,000 |
| navigate timeout | 30,000 | 1,000–60,000 |
| `assertionTimeoutMs` | 10,000 | 0–60,000 |
| `targetResolveAttempts` | 2 | 1–3 |
| `observationAttempts` | 2 | 1–3 |

这些次数只覆盖目标重新解析和只读观测。副作用动作的传输重试复用同一 `operationId`；语义重试遵循副作用声明并由主代理创建新尝试。

## 12. 页面锚点表达式

```ts
interface PageAnchorExpression {
  pageId: string;
  params: Record<string, ValueExpression>;
  baselineVariantId?: string;
}
```

运行时把页面定义、冻结部署和已校验参数解析为 URL。脚本不能覆盖 Origin、允许 Origin 或部署凭据。

## 13. 静态校验顺序

业务版本进入 valid、脚本通过普通激活成为 current revision 或运行计划冻结前，按以下顺序校验：

1. JSON Schema、大小、ID 格式和未知字段。
2. 页面、模块、脚本、清理脚本和基线引用存在且属于同一业务版本。
3. 输入默认值、约束、敏感级别和值表达式类型一致。
4. 步骤 ID 唯一，所有 step output/capture 引用只指向之前步骤。
5. 动作、断言和 comparator 在白名单内，参数范围合法。
6. 有副作用步骤声明 identity、应用检查和重试策略；清理引用不能形成脚本调用。
7. 所有输出来源存在，finalAssertions 非空且不能是模型自然语言判断。
8. 页面转换和 Tab 操作在 `pageScope` 内。
9. 定义中不存在秘密值、任意代码、裸 URL、坐标、固定 sleep 或 `networkidle`。
10. 对规范化 JSON 计算 SHA-256 内容哈希并随修订保存。

任一校验失败，该修订不能成为 current，也不能进入新运行计划。静态校验成功只得到 `valid`；正式 run 还要求执行型 current revision 在精确 deployment/build/角色/locale/viewport verification scope 上为 `verified`。copy 事务可以保留未带目标 scope 验证记录的 current 选择，但目标版本保持 `needs_recheck` 且不得启动正式 run。

## 14. 到浏览器原子操作的映射

| DSL 动作 | proxy 内部执行映射 | 当前 MCP 能力差距 |
|---|---|---|
| navigate | `page.navigate` | 现有 browser_navigate 可基础执行，但需会话/Tab/操作信封和页面锚点解析 |
| click | `element.click` | 现有 selector/marker click 可基础执行，需统一 target bundle 与 stale/歧义结果 |
| fill/type_text | `element.fill` / `element.type` | 现有 page_type 适配器忽略 clear/delay，需补正式语义 |
| press | `element.press` | 当前无正式工具 |
| select_option | `element.select_option` | 当前无正式工具 |
| check/uncheck | `element.set_checked` | 当前无正式工具 |
| focus/blur/hover | 对应 element operation | 当前 page_element_action 可基础执行，需结构化结果 |
| scroll | `page.scroll` / `element.scroll_into_view` | 当前只支持像素 page_scroll |
| set_files | `element.set_files` | 当前无正式工具；必须只接 artifact reference |
| switch_tab/close_tab | `tab.activate` / `tab.close` | 当前仅 list/switch，无租约和 close |

不得把缺失动作临时映射为 `dom_script`。

该表是 `proxy-adapter` 内部引擎映射，不是模型可写 MCP 枚举。模型侧 `browser-control.operation_execute.operation` 仍使用左列 DSL token，由受限包装层注入 session/Tab/lease/operation ID，proxy 再映射到中列实现。

## 15. 示例

下面是“新增用户”脚本的缩略示例：

```json
{
  "schema": "nebula.ai-e2e.functional-script/1.0",
  "scriptKey": "users.create",
  "name": "新增用户",
  "purpose": "创建一个用户并验证其出现在用户列表",
  "moduleId": "module-users",
  "pageScope": {
    "entryPageId": "page-users",
    "allowedTransitions": [],
    "successPageId": "page-users"
  },
  "inputs": [
    {
      "id": "username",
      "name": "用户名",
      "type": "string",
      "required": true,
      "sensitivity": "public",
      "description": "本次创建的唯一用户名",
      "constraints": { "minLength": 3, "maxLength": 64 }
    }
  ],
  "preconditions": [],
  "steps": [
    {
      "id": "step_open_create",
      "name": "打开新增用户弹窗",
      "intent": "进入新增用户表单",
      "action": {
        "type": "click",
        "target": {
          "semantic": "新增用户按钮",
          "candidates": [{ "strategy": "role", "role": "button", "name": { "kind": "literal", "value": "新增用户" }, "exact": true }],
          "expected": { "cardinality": "exactly_one", "visible": true, "enabled": true }
        }
      },
      "postconditions": [],
      "checkpoint": "none"
    }
  ],
  "finalAssertions": [],
  "outputs": [],
  "sideEffects": [],
  "tags": ["users", "create"]
}
```

示例故意省略后续步骤，因此不能通过完整脚本静态校验；正式脚本必须包含创建副作用、应用检查、最终断言和用户标识输出。

## 16. 当前实现差距

- 当前 `scripts.content` 保存任意 TypeScript 文本，语言只限制 ts/js，没有 JSON Schema 或内容哈希。
- 当前生成/修复提示可能产生 `test()`、`expect()`、`networkidle` 或语言标记，执行器只能在运行时失败。
- 当前 `browser-control.*` 缺少 press、select、checked、set_files、Tab close 及统一断言操作，也没有原子操作信封。
- 当前没有输入/输出类型校验、秘密引用、页面范围、硬断言、副作用或静态引用检查。

## 17. 关联文档

- `functional-script-contract.md`：功能脚本产品语义。
- `scenario-orchestration-contract.md`：脚本调用、输入绑定与重复展开。
- `version-page-asset-contract.md`：页面与基线资产。
- `agent-browser-execution-contract.md`：步骤到浏览器原子操作的运行边界。
- `run-state-decision-evidence-contract.md`：尝试状态、证据和结果发布。
- `requirements-baseline.md`：总体需求基线。
- `target-data-model.md`：脚本稳定实体、不可变修订、场景 payload 和运行冻结结构。
