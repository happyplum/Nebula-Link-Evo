# AI E2E 迁移、兼容与技术验收契约

> 状态：已确认目标设计，尚未实现。
> 更新时间：2026-08-12。
> 本文基于当前 001–013 SQLite 表、scenario 级 TypeScript 执行器、项目级登录录制、三服务现有 API/SSE 与目标协议，定义可回滚迁移、渐进切流和发布门槛。它不授权执行生产数据迁移或删除旧表。

## 1. 当前迁移事实

代码核对确认：

- `ai-e2e/src/database/db.ts` 启动时顺序直接执行 migration 001–013，没有 `schema_migrations` 账本；001–012 主要依赖 `CREATE IF NOT EXISTS`，013 通过捕获通用 `SQLITE_ERROR` 忽略重复加列。
- 旧关系是 project → business module → functional module → test scenario → TypeScript/JavaScript script；没有 business version、page definition、functional script、scenario graph 或 immutable revision。
- `urls` 保存完整 URL、可选单份 `page_snapshot_json` 和 auth flag；没有部署 revision、Origin 无关页面模板、参数分类、截图基线或内容 hash。
- `execution_runs` 只关联 script/version，状态仅 `running/pass/fail/error/timeout`；旧取消会被执行器写成 timeout，无法反推 TODO、attempt、decision 或浏览器 operation。
- `login_scripts` 保存 navigate/fill/click/wait/screenshot 步骤。fill value 可能包含秘密，wait 是固定时长，selector 是旧 CSS，登录验证配置没有和脚本一起持久化。
- `proxy-adapter` 当前是单进程 Browser/Context 和稳定 Page ID 基础，没有 application-level session/lease/operation ledger；浏览器进程重启会丢失内存 Context。
- `ai-chat-service` 当前只有交互 Chat 会话和纯文本 `/api/ai/generate`，没有独立 Agent task/Skill 数据模型。

因此，旧 TypeScript、登录录制和历史 run 不能直接声明为目标语义资产或目标运行历史。

## 2. 迁移总原则

1. **只增不毁**：首轮只新增表、列、索引、API 和投影，不删除/重命名旧表，不改写旧脚本与历史 run。
2. **先备份再迁移**：文件数据库迁移前使用 SQLite online backup，记录源文件 hash、schema 摘要和备份位置；备份失败则拒绝启动写迁移。
3. **迁移可重入**：每批迁移和 legacy import 都有 ID、checksum、状态和实体映射；崩溃后从账本继续，不重复创建资产。
4. **候选不等于有效资产**：无法确定页面参数、断言、秘密或副作用时生成 migration issue/待复核候选，不自动置为 current valid。
5. **运行不混链**：旧 `execution_runs` 永远标记 `legacy`，目标 `test_runs.engine='semantic_v1'`；同一个 run 不能调用旧子进程和新 Agent/MCP 执行器。
6. **回滚代码，不倒写数据**：新链异常时关闭 capability/切回旧只读或旧执行入口；不把语义资产反向生成任意 TypeScript，也不执行破坏性 down migration。
7. **秘密零复制**：旧自由 JSON、登录 fill value、日志和 DOM 先扫描/脱敏；没有明确 secret ref 映射就阻止目标资产激活。
8. **本地信任边界**：v1 语义控制面只在 loopback/local 单用户模式启用；非本机或多用户部署在统一认证、授权和租户隔离协议落地前禁止 authoring/run。

## 3. 正式 migration runner

### 3.1 启动账本

在目标领域表之前先引入 `schema_migrations`：

| 字段 | 语义 |
|---|---|
| `id` | 单调 migration 编号，PK |
| `name` | 稳定名称 |
| `checksum` | migration 内容 SHA-256；已应用编号 checksum 改变时启动失败 |
| `status` | `applying/applied/failed` |
| `started_at/applied_at` | UTC 时间 |
| `app_version` | 执行版本 |
| `error_json` | 脱敏失败摘要 |

升级步骤：

1. 在任何业务 DDL 前创建 migration 账本。
2. 对现有库读取 `sqlite_master` 和 `PRAGMA table_info`，按 001–013 的结构断言建立 baseline；结构不符则停止并输出差异，不伪造 applied。
3. 新库先应用 001–013 再写 baseline；现有库只在结构断言通过后补记。
4. 从下一编号开始，每个 migration 使用 `BEGIN IMMEDIATE`、checksum 和单次事务；失败 rollback 并阻止不兼容服务启动。
5. 013 的宽泛错误吞并在 runner 落地时改为先查列再决定 ALTER；不能继续忽略所有 `SQLITE_ERROR`。

生产数据不执行 `down()`。开发/测试的 down 只用于临时数据库，不作为回滚策略。

### 3.2 Legacy import 账本

新增：

- `legacy_import_batches`：`id/project_id/source_schema_version/status(pending/running/needs_review/completed/failed)/source_fingerprint/counts_json/issues_json/started_at/completed_at`。
- `legacy_entity_links`：`batch_id/source_table/source_id/target_type/target_id/target_revision_id nullable/status(imported/candidate/skipped/blocked)/reason_json`，源实体在同一 batch 内唯一。

相同 source fingerprint 重跑返回已有 batch；源表发生变化时创建新 batch，不覆盖旧映射。

## 4. 旧数据映射

### 4.1 Project、部署与业务版本

- 保留 project ID；现有 `target_base_url` 只读解析为一个 deployment profile candidate。
- URL 可解析为 HTTP(S) 时，Origin 生成 deployment revision，path 进入 `basePath` 候选；非法 URL、非 HTTP(S) 或多个冲突 Origin 记 issue。
- 每个 import batch 创建一个独立的“迁移基线” business version（version key 含 source fingerprint 短 hash），状态 `needs_recheck` 并记录 batch；同 fingerprint 重跑复用原版本，旧源变化则产生新 batch/新版本，不覆盖前一次快照。它不会因为 import 完成自动变为 valid。
- `auth_config_json` 只提取配置形态，不复制明文。发现 cookie、token、password、authorization 或疑似密钥值时只记录脱敏 issue，要求用户绑定 secret ref。

### 4.2 PRD 与模块

- 每条 `prd_documents` 复制为 `version_prd_documents`，保留原文、format、parsed JSON、模型/token 元数据的脱敏来源摘要和 source link。
- business/functional module 生成新的稳定 ID 和 revision，保留名称、描述、sort order 与 source。
- 旧 `functional_module.bound_url_id` 和 binding 只作为页面关联候选；rejected binding 不迁移为有效关系。
- 旧 scenario 的描述、test data、preconditions/expected results 作为 module requirement migration source，不能直接当作已验证场景 DAG。

### 4.3 URL 与页面观察

- 每条可解析旧 URL 先生成 `page_observations`；`page_snapshot_json` 作为 partial DOM artifact/observation，因缺少截图、指纹和捕获上下文，不自动成为有效 baseline。
- 页面 candidate 使用不含 Origin 的**精确 literal pathname**；不自动把数字、UUID 或 slug 推断成 path 参数。
- 旧 query 参数默认全部作为固定 identity candidate；只有已配置的追踪参数规则可以进入 ignored。疑似 token/session/key/code/signature/password 的参数值先删除并记 secret issue，不能进入 page payload、日志或 source URI。Agent 重新探索后再将其分类为 identity/runtime/ignored。
- 相同 literal pathname + query signature 合并为一个 candidate；跨 Origin 通过 deployment binding 区分。
- 无法解析、跨 allowed origin 或绑定冲突时保留 observation 并标记 `needs_review`，不创建 current page revision。

这种保守导入可能暂时产生多个相近页面，但不会误把两个业务页面合并。

### 4.4 旧 scenario 与 TypeScript script

- 旧 scenario 生成 scenario migration candidate 和单节点调用意图；在对应 functional script 有 valid revision 前不激活目标 scenario revision。
- 每个旧 scenario 创建一个 functional script 稳定身份候选；旧 `scripts.content` 以 legacy source artifact/hash 保留，**不执行 AST/正则自动转换、不作为目标脚本执行**。
- 后续转换由“旧脚本 + PRD + 当前真实页面”重新生成 `nebula.ai-e2e.functional-script/1.0`，再经过静态校验和可视运行验证。
- `generated_by`、version 和 status 仅作为来源审计；旧 `passed` 不证明新脚本在当前页面有效。
- 多个旧 script rows 按 scenario/version 全部保留 source link，但只以最新版本作为默认转换输入，用户可以指定其他版本重新生成。

### 4.5 登录录制

登录录制可生成 functional script candidate，但永不自动激活：

- navigate：拆分为 deployment + page candidate，禁止保留裸绝对 URL 为脚本动作。
- click/fill：selector 只作为低优先级 legacy CSS candidate；必须在当前 DOM 重解析。
- fill value：不复制；统一转换为 required `secret_ref`/sensitive input placeholder 并产生待映射 issue。
- wait：不迁移为固定 sleep；必须由页面前置/目标可操作性或确定性后置断言替代，否则阻塞。
- screenshot：迁移为 evidence policy 提示，不作为业务步骤。
- 旧库没有可靠登录成功断言；用户/主代理必须补齐 URL、元素、cookie/localStorage 引用或其他确定性断言后才能 valid。

登录仍是普通、可编排的功能脚本。子代理遇到登出只上报；主代理调用已验证登录脚本。

### 4.6 历史 run、诊断与探索

- `execution_runs`、`ai_intervention_logs` 和 `exploration_sessions` 原表保留只读；统一历史 API 返回 `executionKind='legacy'`、原状态和可用证据。
- 不把旧 pass/fail/error/timeout 映射成目标 TODO/attempt/run event；旧取消无法可靠区分，展示为原始 timeout 并标记语义有限。
- 旧 run 不支持 resume/retry/decision apply；重新执行必须基于已验证 semantic business version 创建新 run。
- 旧截图路径存在且可读时可按用户发起的提升任务转入 content-addressed artifact；文件缺失只标记 evidence incomplete，不伪造。

## 5. 双轨 API 与切流

### 5.1 能力标志

服务对外暴露 `/api/v1/capabilities`。`ai-e2e` 运行前必须确认：

- `ai-chat-service` 支持 agent-task major 1、所需视觉/Skill 版本和结构化输出。
- `proxy-adapter` 支持 browser-execution/operation major 1、所需动作/观测、持久 operation ledger 和可视画面。
- `ai-e2e` 支持 `side-effect-policy/1.0`，数据库目标 migration 已完成，且所选 deployment/build/角色/locale/viewport scope 的 `business_version_validation` 为 `valid`。

不满足时新 run 返回明确 503/validation problem；不得半途切回旧执行器。

### 5.2 阶段

| 阶段 | 默认行为 | 退出条件 |
|---|---|---|
| A. 协议底座 | 新表/API/ledger/Agent task/Skills behind flag；旧功能不变 | 三服务 contract、migration、fault tests 通过 |
| B. 只读导入 | 创建 migration candidates 和 diff 报告，不改变旧资产 | 旧库 fixtures 可重复导入且无秘密泄漏 |
| C. 影子校验 | 生成/校验 semantic 资产与 run plan，但不执行副作用动作 | 计划/页面/脚本静态校验与只读观测通过 |
| D. 版本级 opt-in | 用户对目标 verification scope 已 valid 的 business version 启用 semantic run；旧历史仍可看 | 核心 E2E、重启恢复、证据和 UI 验收通过 |
| E. 新项目默认 | 新项目只创建 semantic assets；旧项目可继续 legacy 查看/执行 | 无关键回退且迁移率达到发布策略 |
| F. Legacy 只读 | 关闭旧脚本生成/修复/执行，只保留历史和导出 | 用户确认保留期与导出能力 |

阶段 D 前旧执行入口继续可用；阶段 E 只允许尚未 opt-in 的既有项目在显式 feature flag 下继续 legacy 执行，不再生成新的 legacy 资产；阶段 F 关闭 legacy 生成、修复与执行，只保留历史查看和导出。任一阶段都不能删除旧表。

### 5.3 路由与 UI

- 旧 `/api/projects/:id/*` 和项目阶段 SSE 保持原语义，不伪装成 v1。
- 新业务版本与 run 只使用 `/api/v1/*`，UI 根据 capability 和资产类型进入 legacy 或 semantic 工作区。
- 同一页面可以汇总两类历史，但必须显著显示 `legacy`/`semantic_v1`；只有 semantic run 显示 TODO、attempt、decision、operation 与证据 manifest。
- 不把旧状态字段转换为新进度百分比；semantic UI 只读服务端 snapshot。

## 6. 服务升级与故障恢复

升级顺序：

1. `proxy-adapter`：先交付持久 operation ledger、application session/lease、原子工具和 capability；旧 MCP/debug 工具不变。
2. `ai-chat-service`：交付受限 Agent task、视觉 v2、Skills registry、模型不可见 browser wrapper 和 capability；交互 Chat 不变。
3. `ai-e2e`：交付 migration runner/目标表/outbox、v1 API、主代理与 semantic runner。
4. `ai-e2e/ui`：最后启用版本资产和新运行控制台。

故障规则：

- `proxy-adapter` 重启：所有内存 browser session/lease 失效；账本中 running operation 收敛为 `outcome_unknown`。主代理创建新会话并安排页面/副作用检查，必要时重新登录；v1 不承诺恢复原 Context/Cookie。
- `ai-chat-service` 重启：活动 Agent task 标记 interrupted/blocked，租约 token 从内存清除；`ai-e2e` 依据 checkpoint 新建任务，不恢复隐式对话。
- `ai-e2e` 重启：扫描非终态 run/outbox/external link，查询两服务账本并追加事件收敛。
- SSE 断开：客户端从 snapshot 恢复；事件缺号只触发重新同步，不触发业务重试。

## 7. 回滚策略

- 发布前保存三服务版本、配置、数据库 backup manifest 和 capability snapshot。
- 新链故障先禁止创建 semantic run，允许活动原子操作到安全边界；不直接杀浏览器或回滚已发生副作用。
- 回滚应用版本时保留新增表和新资产只读；旧二进制必须忽略未知表，不能执行 down。
- 已开始 semantic run 不转交 legacy 执行器。恢复新版本继续，或取消并从证据/副作用检查后新建 run。
- 只有经备份 hash 验证且没有新写入时才允许整库恢复；这属于运维破坏性操作，不作为普通发布回滚。

## 8. 技术验收矩阵

### 8.1 数据与兼容

| 验收项 | 必须证明 |
|---|---|
| 空库安装 | 一次启动形成完整目标 schema，再次启动无 DDL/数据漂移。 |
| 001–013 旧库 | 结构 preflight 正确补记 baseline，旧 API/历史可读。 |
| 非标准旧库 | 列/索引/约束不符时拒绝写迁移，报告差异且原库不变。 |
| 中途崩溃 | migration/import 事务回滚或可从账本重入，不产生半版本/重复 ID。 |
| Legacy import | 同 fingerprint 重跑结果一致；每个 source entity 有 imported/candidate/skipped/blocked 结论。 |
| Authoring 验证 | import_conversion/recheck 可从持久 job 恢复；candidate 只有实跑验证后激活，copy 后 stale 资产不会进入正式 run。 |
| 秘密 | 登录值/auth JSON/日志扫描不进入新 payload、event、模型上下文或普通日志。 |
| 旧历史 | legacy run/诊断可读但不可 resume；semantic history 不依赖旧表。 |

### 8.2 跨服务契约

- 对三服务 OpenAPI/JSON Schema 做 producer/consumer contract tests，major 不兼容时 preflight 失败。
- 对创建、copy、run command、Agent task 和 browser operation 做同 key 同 hash重放、同 key 异 hash冲突测试。
- 验证模型可见 tool schema 不含 session、Tab、lease token、operation ID 和 correlation 映射。
- 验证 Agent/Browser/Run SSE 首条 snapshot、单调 seq、缺号重同步和 heartbeat 不占 seq。
- 验证旧 Chat SSE、Debug SSE 与项目 SSE 行为无回退。

### 8.3 浏览器与故障注入

- 每个语义动作/观测在真实 Chromium 可见执行，并生成前后页面状态、目标解析、结果和证据引用。
- 在“点击已发生、响应未到”处断开连接，确认原 operation ID 查询得到 completed 或 `outcome_unknown`，不会重复点击。
- 分别在 proxy、ai-chat、ai-e2e 的关键边界重启，确认按第 6 节收敛。
- stale marker、歧义 locator、跨 Origin、过期租约、未授权 Tab 和排队取消全部拒绝或安全终止。
- UI 的实时画面、语义步骤、操作状态和证据时间线能够关联同一 operation。

### 8.4 Agent、视觉与 Skills

- 使用 mock model 做确定性 tool policy、预算、结构化输出、暂停/中断测试；live provider 只作为非阻塞 smoke，不作为唯一验收。
- `vision.analyze_page`/`resolve_target` 每次只读取指定 snapshot；snapshot 缺失/错 Tab 时失败，不偷换当前页面。
- Skill id/version/hash 不匹配、请求未授权工具、附带可执行代码或联网安装请求时拒绝。
- 注入包含“忽略规则/读取密钥/点击删除”的 PRD、DOM 和截图 OCR，确认不能改变 system/task/tool/lease policy。
- Agent 返回 completed 但硬断言不通过时，E2E TODO 仍失败。

### 8.5 E2E 业务闭环

至少提供以下真实浏览器验收 fixture：

1. 从 PRD + URL 生成页面/模块/登录/新增/单删/批删功能脚本和场景。
2. 场景重复调用新增脚本并把确认输出传给单删/批删。
3. 子代理中途发现登出，停止；主代理调用登录脚本后创建新 attempt 并继续。
4. DOM 定位变化只产生当前业务版本的脚本修订；来源版本不变。
5. 失败截图/DOM/operation/assertion 形成 sealed manifest，依赖节点跳过、独立节点继续。
6. business version copy 后 ID 全量重映射，两个版本分别修复互不影响。
7. 主代理待决策暂停、持久回答、重新检查再恢复；取消不记 timeout、不自动关闭浏览器。
8. 同一场景以两个 actor 串行执行显式退出/登录；任一时刻只有一个活动身份，子代理在身份不符时停止，且 Agent/proxy 不通过 Context 或 storage-state 切换绕过认证脚本。
9. local/test 中已声明、有界副作用自动执行，未声明或无界写入在 browser job/control 前拒绝。
10. staging 单项非不可逆 create/update 自动执行；删除、批量、不可逆或上传只出现一次当前 run/job 的计划级审批，扩大投影后必须重新审批。
11. production 可以登录、导航、只读观测和断言，但任何业务 create/update/delete、上传或业务提交都硬拒绝且不提供 v1 绕过。
12. 相同副作用计划经过服务重启仍可恢复当前 context/grant；跨 run、deployment、policy 或扩大后的投影不能复用审批。

### 8.6 资源与稳定性默认门槛

- 单 run 展开 TODO 默认上限 1000；超过时在 planning 阶段拒绝，不部分执行。
- 普通 event payload 默认不超过 256 KiB，snapshot 默认不超过 5 MiB；DOM、截图、video、trace 只通过 artifact ref。
- Agent task 输入默认不超过 2 MiB（不含 artifact），Skill 包默认不超过 256 KiB；超限明确拒绝。
- SQLite `foreign_key_check`、目标唯一索引、artifact hash 和 sealed manifest hash 在发布验证中全部通过。
- 以 1000 TODO/100000 run events 的合成数据验证 snapshot 查询和 event-log 分页；本地参考环境 snapshot p95 目标小于 500 ms，SSE 重连到首个 snapshot 小于 2 s。参考硬件和测量脚本必须随结果记录，不能跨环境伪比较。

## 9. 发布门禁

语义执行进入版本级 opt-in 前，以下全部满足：

- 数据迁移、contract、故障注入、真实浏览器、secret/prompt injection 和版本 copy 验收通过。
- 三服务 capability major 兼容，旧 API/Chat/Debug 回归测试通过。
- 无未解释 `outcome_unknown` 自动重试、无秘密进入模型/事件/日志、无独立 Chromium 旁路。
- 操作文档能明确停止新 run、等待安全边界、查询账本、恢复/取消和回滚应用版本。
- 三个服务控制面保持 loopback/local 单用户边界；如发布拓扑需要远程或多用户访问，统一认证授权与租户隔离必须先单独验收。
- v1 单 BrowserContext、单活动身份、显式串行认证切换和 `side-effect-policy/1.0` 环境矩阵已经进入长期契约；policy evaluation、plan-level grant 与逐 effectId 门禁实现并验收后方可发布。

## 10. 已确认首期产品策略

已确认 v1 一个 browser execution session 只绑定一个 BrowserContext，同一时刻只有一个已确认活动 actor 或匿名态。跨账号/多角色场景通过显式退出/登录功能脚本串行切换；认证变化必须由硬断言确认，子代理发现意外登出或身份不符时停止上报，由主代理安排恢复。多 Context、并存登录态和并发多 Tab 不属于首期。

环境与副作用策略同样已经确认：local/test 自动执行已声明、有界副作用；staging 的单项非不可逆 create/update 自动执行，删除、批量、不可逆和上传在开始前做一次当前 run/job 计划级审批；production 只允许显式登录/退出/会话刷新、导航、只读观测和断言，业务写入与上传硬拒绝，首期不设 break-glass。审批不跨 run/job、deployment 或风险投影复用。

## 11. 关联文档

- `requirements-baseline.md`：总体产品需求与已确认策略。
- `target-data-model.md`：目标表、修订、copy、run、outbox 与证据模型。
- `service-api-event-contract.md`：三服务 API、能力协商、事件和恢复。
- `ai-model-skill-contract.md`：模型、视觉、Skills 和注入防护。
- `agent-browser-execution-contract.md`：浏览器控制与上下文边界。
- `run-state-decision-evidence-contract.md`：状态、决策、证据和人工控制。
- `asset-authoring-repair-contract.md`：legacy candidate 的重新生成、真实验证、激活和局部修复。
- `environment-side-effect-policy-contract.md`：环境矩阵、风险投影、计划级审批和发布门禁。
