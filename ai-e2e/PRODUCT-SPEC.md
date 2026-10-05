# ai-e2e 产品规格

> 端口：服务 `:3002`（固定监听 `127.0.0.1`）｜ dev UI `:5174` ｜ 生产 UI 由本服务挂载在 `/ai-e2e/`（SPA fallback 仅限 `/ai-e2e/*`）｜ API 只暴露 canonical `/api/v1` ｜ 数据库 `./data/ai-e2e-semantic.sqlite`

## 1. 定位与状态

`ai-e2e` 是纯 semantic 的 PRD 驱动浏览器 E2E 编排产品，不提供旧脚本链或向后兼容。

| 单元                | 状态    | 当前事实                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic 项目初始化 | shipped | 原子创建项目、部署修订、业务版本、PRD 与待验证起始资产图；保留用户入口 URL 的 pathname 作为部署 `basePath` 和起始页面路由；幂等重放且拒绝请求漂移                                                                                                                                                                                  |
| 业务版本/资产       | shipped | 页面→业务模块→功能模块→功能脚本→场景稳定身份与不可变修订；copy 重建内部引用                                                                                                                                                                                                                                                        |
| Authoring           | shipped | bootstrap 可从 PRD 结构化创建页面、业务模块、功能模块、功能脚本和场景候选；recheck/repair 修订既有资产；结构化 amendment 与 compact Agent 活动流串联意见、Skill/Tool、审批、验证和激活                                                                                                                                             |
| Run                 | shipped | 冻结计划、TODO/DAG、page task/attempt、变量、决策、恢复/取消/依赖跳过、证据、权威控制面 SSE 与 compact 只读 Agent 活动流                                                                                                                                                                                                           |
| 跨服务执行          | shipped | ai-chat-service Agent task/event-log + Vision v2 + 逐 effect 授权；浏览器步骤遵循 shared kind/operation→args 判别映射；proxy session/lease/operation/artifact/event-log 及 TTL/hold 短期原始产物清理、ai-e2e 长期原始证据保留清理，均按持久事实恢复                                                                                |
| 三服务 E2E 门禁     | shipped | 真实 HTTP/MCP/Chromium 覆盖候选生成、验证激活、正式运行、未验证拒绝与 `outcome_unknown` 禁止重放                                                                                                                                                                                                                                   |
| 副作用审批生命周期  | shipped | Run/Authoring 共用纯 evaluator 与唯一 policy repository；exact context/deployment/source plan/projection/policy 授权与终态同事务失效。Run 失效转 paused 并重新审批；Authoring create 失效收束 failed job/candidate（需新候选），resume 失效保 paused 且可取消。queue/lease/dispatch/恢复均重验，五个 side_effect_* ApiProblem 保持 |
| 场景 fail-closed    | shipped | `runWhen` 与 `repeat.for_each` 在场景写入（`createScenario`、`validateGraph` 与 test_scenario revision 创建）时显式拒绝，不静默退化；固定次数 repeat（1–100）正常展开                                                                                                                                                              |
| 浏览器中心 UI       | shipped | 项目首页、Authoring/Run 三栏工作台、轻量分层上下文树、深链接上下文、显式定位、Diff/审批/证据/Chat、布局与主题偏好；工作台采用低噪声冷蓝视觉体系、浮动面板和渐隐选中轨，突出持续挂载的浏览器主舞台；Playwright 使用真实生产 bundle/API 验证完整旅程                                                                                 |

- 浏览器 operation record/status、artifact、resolved target 与 problem 由 `shared/types/browser-operation-result.ts` 的 TypeBox schema 唯一派生，既有 `browser-execution` type 入口保持。E2E 通过共享 HTTP 客户端消费相同 DTO，不新增 HTTP 响应校验或迁移数据库。

## 2. 服务与模块

| 模块             | 位置                                                                                            | 职责                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server/DI        | `src/server/index.ts`                                                                           | 本进程唯一 dotenv owner（工作目录 `.env.local` → 父目录 `.env` → 默认回退工作目录 `.env`，既有进程变量优先）、Fastify、TypeBox、路由、静态 UI、协调循环                             |
| Project          | `semantic-project-*`                                                                            | 纯 semantic 项目与起始工作区初始化                                                                                                                                                  |
| Business Version | `business-version-*`                                                                            | 版本、资产图、不可变 revision 与 copy                                                                                                                                               |
| Contracts        | `src/contracts/`                                                                                | 公开 Project/BusinessVersion/workspace/revision/Authoring/Run DTO 与共同消费的纯 TypeBox schema 单源；UI 仅按类型消费，不引入后端实现                                               |
| Query            | `semantic-query-*`                                                                              | workspace、revision、Authoring/Run snapshot/event 投影                                                                                                                              |
| Authoring        | `semantic-authoring-*`                                                                          | job/task、结构化候选、范围审批、验证与激活                                                                                                                                          |
| Run              | `semantic-run-*`、`semantic-task-projection.ts`                                                 | 正式运行、语义步骤投影与逐 effect 授权                                                                                                                                              |
| Policy           | `policy/`、`semantic-policy-repository.ts`                                                      | 共享纯风险判定、精确冻结 evaluation/grant 唯一持久 owner                                                                                                                            |
| Coordinator      | `semantic-coordinator-*`                                                                        | FIFO、outbox、Agent/browser 派发、恢复和证据提升                                                                                                                                    |
| Agent Activity   | `agent-activity-ingester.ts`、`agent-activity-repository.ts`、`server/routes/agent-activity.ts` | additive 持久活动序列；`AgentActivityIngester` 通过 ai-chat snapshot-first activity SSE 实时追加，activity-log 仅在连接/重连时补洞；独立外部 cursor、控制面事实投影与 shared 纯回放 |
| Evidence         | `semantic-evidence-*`、`semantic-artifact-store.ts`                                             | 不可变 manifest/item、受限原始对象、7/30 天保留清理与物理删除续跑                                                                                                                   |
| Integrations     | `agent-task-client.ts`、`semantic-browser-client.ts`                                            | Agent Task DTO 直接引用 shared；浏览器通过 `@nebula-link-evo/browser-control-client` HTTP 方法，适配器仅保领域错误和 Buffer 转换，browser-execution DTO 直接引用 shared             |
| UI               | `ui/src/features/semantic/`、`ui/src/features/project/`                                         | 浏览器中心工作台与项目入口；维护统一的浮动工作区表面、上下文树层级、浏览器主舞台和明暗主题视觉语义                                                                                  |

## 3. 路由

所有业务 HTTP 路由均位于 `/api/v1`：

- `POST/GET /projects`、`GET /projects/:projectId`
- `/projects/:projectId/business-versions`、`/business-versions/:versionId/*`
- `/business-versions/:versionId/authoring-jobs`
- `/authoring-jobs/:jobId/*`（含乐观并发作业命令、`activity`、`activity-log`）、`/authoring-amendments/:amendmentId/*`
- `/projects/:projectId/runs`、`/runs/:runId/*`（含只读 `activity`、`activity-log`）
- `/capabilities`

UI 路由：`/`、`/semantic/:projectId`、`/semantic/:projectId/authoring/:versionId`、`/semantic/:projectId/runs/:runId`。

## 4. 核心验收

- BusinessVersion 仓储直接复用 `semantic-repository-utils.ts` 的 `stableStringify/hashValue/sha256`；私有序列化与哈希 helper 已退出。对象键递归按 `localeCompare` 排序、数组保留原序，创建幂等请求与 copy 引用改写后的持久 JSON 字节和哈希保持既有行为。
- 新项目首次进入工作台自动且仅自动一次创建 bootstrap job；版本未验证前不能创建正式 Run。
- 项目输入可包含入口 pathname；部署只保存无凭据 origin 与 `basePath`，工作台深链接和起始页面不得把 `/debug/` 等入口路径折叠成 `/`。
- 模块/场景切换不导航浏览器；显式定位使用冻结 URL 的 navigation-only task。
- Agent 输出必须转成结构化候选；同页其他模块与跨 URL 修改必须审批，stale/错误模块候选不可应用。
- 只有 bootstrap `ingest_prd` Agent task 可提出稳定新资产；新身份在候选期没有 current revision，工作区不可见，但整版本 bootstrap 候选可在原上下文中一次应用跨模块新建资产；已有资产修订仍必须命中当前模块与基础修订锁。验证成功后新建与修订候选一起原子激活。repair/recheck 不得创建资产。
- 功能脚本 v1 页面入口只读取 `pageScope.entryPageId`，不兼容旧根字段；正式运行必须冻结该页面的 current revision。
- 候选浏览器验证成功后记录 executable revision verification；只有全部当前脚本/场景覆盖时版本才为 `valid`。
- side-effect authorization 精确覆盖 effect-bearing step；staging 高风险必须 grant，production 业务写拒绝。
- Run/Authoring 的环境/effect 矩阵唯一由 `src/policy/side-effect-policy.ts` 判定，migration 017 的 evaluation/grant 创建、查询、失效 SQL 唯一归 `SemanticPolicyRepository`；旧 Run evaluator、evidence policy 接口与 Authoring 假 grant 已退出。
- Authoring 在 candidate 构建时冻结实际验证计划，脚本按 ID 去重、每个一次，不展开 scenario repeat；Run 的影响上限按声明乘固定 repeat。审批精确绑定 context/version/deployment/source plan/projection/policy，scope 批准不能替代副作用 grant；UI 按 category 展示精确风险和 hash，阻止应用的理由只按 open decision 区分范围、副作用、两者并存或通用待回答决策，已回答决策不计入。
- queue、verification scheduling、start/resume、lease、Agent dispatch 与重启 outbox 重放均重验授权；lease 返回后的任何重验异常回收本次控制权，网络撤销失败保留 secret 和持久 retry outbox。失效 create 收束原 attempt/task，失效 resume 保持 paused，取消/清理仍可执行；业务终态同事务过期 grant。
- 同 hash 重新审批产生新 decision/answer/grant 并保留 immutable evaluation，旧 answer 不复活 revoked/expired grant。没有新增 revoke API/TTL；`set_files`、非 single affectedItems、不同 effect 同资源全局聚合及跨 context/locator/缩小计划复用仍未交付。
- Authoring 候选终态在生命周期事务内将本候选仍为 open 的范围/副作用决策置 withdrawn 并递增 state version，覆盖并列审批拒绝、hard deny、失败和上下文/base revision stale；保留已回答/已应用及 answer 审计，其他候选审批不受影响。base revision stale 与 grant 失效同事务回滚/提交。

- 断线后从 snapshot + seq 恢复，不由本地百分比或 Chat 文本推断状态。
- Project 与 semantic 工作台统一 JSON 请求入口；完整保留成功 data/meta、HTTP status 与 ApiProblem 的 code/message/retryable/correlationId/details（含未知嵌套内容），非 JSON 失败不展示服务端 HTML。
- `BrowserStage` 的 zoom 仅在实际图像可用时作用于画面；空态/图像错误后的“重试实时画面”不缩放，默认 90% zoom 下仍有 44px 热区。组件错误/重试回归与真实生产 UI 的 image error/transform/boundingBox 验收锁住边界。
- UI Agent 活动与 semantic event invalidation 均由 `@nebula-link-evo/agent-stream-client` 统一传输：`useSemanticEventStream` 淘汰手写 fetch-SSE 解析器，作为薄封装复用 `useSnapshotEventConnection`，保持 snapshot 缓存覆盖、非 error 事件 invalidateQueries 与 `idle | connecting | live | reconnecting` 状态契约不变，重连策略升级为共享指数退避（1s→×2→30s 封顶）与手动重连能力；局部 snapshot 带 endpoint/真实 job/run id，切换首 render 即隐藏旧内容。断线保留内容、持续恢复、合法 snapshot 后 live；header 的立即重连只恢复观察，Run 不发命令/不解锁 composer。公共 Button 新增 touch=44px 尺寸，旧 header 样式仅指向 toggle；没有独立组件 Gallery，产品/test/真实主题尺寸浏览器为验收面。宿主独立 dev/build/test:e2e 准备公共依赖 dist。
- UI 基础组件唯一 owner 为 `ui/src/shared/ui/`（flat 文件布局，与 debug-ui `shared/ui/` 约定一致），公共入口仅导出产品使用的 Button、Input、Card、Modal；Sonner Toaster 适配同为该目录 flat 文件，`components.json` 保留生成配置。无调用的 shadcn/Radix 替代组件、旧向导 Stepper 及专属测试、Table/Tree/CodeEditor 与索引导出已退出，对应 11 个 Radix 直接依赖和 class-variance-authority 已移除；保留产品样式、token 与 Modal 使用的 tailwindcss-animate。
- Run/Authoring 业务拒绝由产生处的领域 kind/code 或 repository reason 决定，API 边界集中映射既有状态；文案、动态 callKey 不参与分类。五个 `side_effect_*` wire code 与状态保持不变。
- Agent Activity snapshot 调用 shared 纯 replay 归并 turns/sections/seq；本包先投影业务事件并按 source seq 去重，再由 shared `mapSemanticStatusToActivityState` 与 `mapAgentActivitySnapshotState` 保持原有状态映射和聚合优先级，不受外部 stream.state 覆盖；generatedAt 使用最后事件时间，空流使用当前时间。所有 authoring/run event 与 Authoring Chat message 写入提交后从持久化行发布到进程内 `SemanticControlEventHub`；`/activity` 在每连接订阅 Hub 并增量投影，5 秒 catch-up poll 覆盖无订阅期间的写入，snapshot 仍按独立外部 cursor 同步。`/activity` 与 Authoring/Run `/events` 均由 shared `SnapshotFirstSseWriter`、`encodeSseJsonFrame` 传输，保持既有事件名、帧字段顺序、ID、响应头、heartbeat 与 snapshot 信封字节；控制流订阅同一 Hub，并保留 5 秒 afterSeq 安全轮询。UI 继续通过公共 UI 包重导出的同一 shared 核心恢复 live；仓储不依赖 React。
- Agent Task 创建／查询／命令／审计事件使用 shared TypeBox schema 派生类型；view 保留真实 modelRole、脱敏 request、usage 等服务字段，BrowserStep 保留 videoSegment（true 仍由服务 capability 政策拒绝）。
- 失效 Authoring 的未开始 verification task 封存为 blocked、无伪造 attempt，job/candidate failed 后关闭 session 并释放 FIFO。持久关闭意图优先复用本意图控制凭据；active session 无 control lease 时可申请 30 秒、仅 `page_state` 的清理 lease，只用于关闭，不执行 operation、不传给 Agent。其他活动控制权无 token 时等待过期；清理 lease 过期/token 丢失用新恢复意图续跑，远端已关闭/404 重放仍清理关联 secret、完成 FIFO。inactive/interrupted session 不申请新 lease。
- Authoring 租约签发响应丢失或本地 token 未保存时，旧租约仍活动则等到 `expiresAt + 1s`；确认旧租约已失效后，先持久化 `${原意图ID}:recovery:${旧lease.sequence}` 的新租约创建意图，再确认旧意图。恢复保留原 Authoring context/task、payload 与 endpoint，不继承旧 secret；重启重放与连续凭据丢失均沿稳定 key 收敛，派发前继续重验取消状态与精确授权。
- Browser session/lease/event/operation/capability 使用完整 shared browser-execution DTO，保留 schema、requestHash、queue/timestamps、resolvedTarget、artifact size/snapshot 与完整 error；E2E 不再维护 DTO 或 axios 浏览器传输副本。FIFO、outbox、租约与操作生命周期仍由协调器维护，不使用共享受控会话控制器或 MCP execute/cancel。
- `tsconfig.json` references shared 与 browser-control-client；`tsc -b` 按 shared→browser-control-client→E2E 构建依赖，使服务构建和 start.bat 不依赖预先存在的客户端 dist。
- 浏览器事件日志是必需 port，按持久 cursor 补洞；活动会话关闭携带 control 凭证。共享 HTTP 解析保留标准 Problem/status/details/correlationId 与网络 cause，artifact 404 不再因 arraybuffer 丢失 Problem。非标准 HTTP 错误有意统一为 `dependency_unavailable`，不再返回旧 `http_STATUS`；显式 baseUrl→PROXY_ADAPTER_URL→默认 3000 与 timeoutMs 默认 30 秒配置边界保持。
- Agent Task activity 由 `AgentActivityIngester` 消费 ai-chat `/api/v1/agent-tasks/:taskId/activity` SSE 并实时追加；持久 activity-log 仅在连接/重连时 catch-up，snapshot 后再补读以闭合握手间隙。append 以 `(context, source task, source seq)` 幂等，activity cursor 按 context/source task 持久化，绝不复用 audit `external_task_links.last_external_seq`；Authoring/Run 本地活动 seq 单调、可重启恢复、按业务上下文隔离且不重复。结构化日志记录实际订阅起止/原因、catch-up 触发/页数/读取数/游标/耗时、retry 阶段/分类/次数/延迟及 snapshot 收到后的连接成功，不记录事件载荷或原始错误文本。
- Run/Authoring Agent audit 对账共用协调器私有 `reconcileAgentTask`：每次协调 tick 继续通过 `listTaskEvents` 补审计事件，再查询快照，以两者最大序号保存 `external_task_links.last_external_seq`、终态及输出哈希，并按期望生命周期入队 `pause/resume/cancel`。该审计游标与实时 activity SSE/持久 activity cursor 分离。命令 key 保持 `agent-task-command:${taskId}:${command}:v${stateVersion}` 与 `expectedStateVersion`；page task/authoring task 关联按上下文传入，Run 的 TODO 关联仅用于活动同步。旧两处重复投影和命令构造已退出；缺失关联、Run TODO/决定结算及 Authoring 取消/候选验证仍由各调用方维护。
- Authoring 用户意见、候选、Skill、Tool、浏览器验证、审批与激活在同一 compact 活动流呈现；结构化 amendment/decision 仍是业务事实。Run 活动流只读，资产修改必须返回 Authoring。
- 1440px 与 1920px 下浏览器始终是最强视觉与空间锚点；左侧页面/模块/场景使用树线、状态点、细强调轨和渐隐背景表达层级，不使用父子嵌套的大面积选中卡片；右侧检查器与 Agent 活动使用独立浮动表面，明暗主题保持等价层级与可见焦点。
- 公开 Authoring message 查询/提交路由不存在；历史内部消息审计只作为活动投影来源，不删除数据库记录。
- 长期原始证据仅在所有 manifest 引用到期且没有 open/pinned/custom 保留或对象 pin 后删除；成功/失败默认 7/30 天，逻辑删除先于物理回收，重启可续跑，manifest/item/哈希不删除。
- Authoring/Run 在协调器内共享 operation 查询、artifact 下载、哈希验证和内容寻址对象登记、证据 item 创建；各工作流仍分别拥有 manifest、TODO/attempt 关联、Agent 审计和封存。`queued/running` operation 的外部关联保持非终态、manifest 为 `partial`，已可下载的原件仍保存；`succeeded/failed/cancelled/outcome_unknown` 按真实状态登记终态，证据齐全即可 `complete`，操作失败不等同于证据缺失。查询或单个原件采集失败只使 manifest 部分完整，不丢弃其他成功证据；相同内容复用对象，但保留每个步骤、operation 和 manifest 的引用及引用计数，外部 ID 的上下文隔离规则不变。
- Authoring 暂停/恢复/取消使用 `If-Match` 与幂等键；运行中的 Agent 在原子操作安全边界接收对应命令，取消完成后关闭自有浏览器会话。
- 正式 Run 创建后保持 `ready` 且不得提前占用浏览器 FIFO；只有显式 start 进入 `running` 后才具备领取会话资格。
- 旧 `/api/projects/*` 返回 404，生产/开发构建均不包含旧向导与 fixtures。
- `pnpm --filter ai-e2e test:e2e` 必须通过真实 proxy、ai-chat Agent Task HTTP 与 Chromium；未知结果停在 open decision，不能自动创建第二个 Agent task。
- `pnpm --filter ai-e2e-ui test:e2e` 必须以动态端口和仓库 `.tmp` 下每轮唯一 runroot 启动真实 proxy、ai-chat Harness、ai-e2e 服务与生产 UI bundle，验证项目创建、自动 bootstrap、candidate 浏览器验证/激活、正式 Run、证据及 reload 恢复，不复用已有服务。数据库、配置、计划与测试产物全部归本轮目录；启动失败、非零退出和 SIGINT/SIGTERM 与正常结束共用 `tools/e2e-process-lifecycle.mjs`，精确回收本轮 PID 树并等待退出后清理目录，清理失败保留原错误并报告。
- 覆盖率门禁合并单元/集成与真实三服务 E2E；`semantic-coordinator-service.ts`、`semantic-task-projection.ts` 和 amendment 激活仓储分别设置关键文件防回退阈值。三服务旅程夹具的证据与加密 secret store 显式注入仓库 `.tmp` 唯一运行目录，随服务退出统一清理；回归核对实际 artifact storage key 与本轮密钥路径，禁止落入默认 data。

## 5. 维护协议 [MUST-MAINTAIN]

- 修改模块、页面、路由、功能、状态或运行方式时同步本文件。
- 修改跨服务协议、公共类型、API/SSE/MCP/工具集合时同步 `docs/PRODUCT-SPEC-INDEX.md` 和受影响包规格。
- 功能完成后同步 `docs/shipped/ai-e2e-orchestration.md`，不得保留与代码相反的双轨或兼容描述。
- 验证至少包括后端 type-check/test/coverage、UI app tsconfig 严格类型检查/test/coverage/build；涉及浏览器交互时补视觉与 a11y 检查。

## 6. 条件性扩展边界

| 边界                       | 状态    | 说明                                                                                                                                                   |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| loopback 单用户控制面      | shipped | v1 明确拒绝非 loopback；远程/多用户属于产品范围扩展，启用前必须另行定义并交付统一认证、授权和租户隔离，而不是当前实现债务                              |
| 受限原始证据与保留清理     | shipped | proxy 短期产物和 ai-e2e 长期证据 7/30 天清理已交付；未按项目规则处理的截图/DOM 以 `restricted/pending` 保存，v1 不承诺通用自动脱敏                     |
| 外发或项目级隐私策略启用门 | shipped | 开放证据外发、共享、远程/多用户访问或项目级隐私策略前，必须先定义可验证的脱敏、原件保留与访问权限规则并完成实现；没有验收标准时不得先行实现通用 worker |

## 7. 已知缺口与技术债

当前无与本次 PRD 多资产 bootstrap 交付直接相关的已知缺口。跨文档登记的 pending/in-progress 项见 `docs/PRODUCT-SPEC-INDEX.md` §3.9（页面锚点运行匹配与基线采集、页面任务上下文续接、生产 UI 恢复、DOM 变化局部修复）、`ai-e2e/docs/service-api-event-contract.md` §3（版本作用域写路由、validate、通用资产 revision 写与 activation、deployment-profiles 管理路由）及 `ai-e2e/docs/target-data-model.md` §16（通用自动脱敏与 UI 证据时间线）。

- Amendment `reject` 命令入口存在既有校验缺口：默认 Ajv 在 `AmendmentCommandBodySchema` 的第一个 `anyOf` 分支剥离 `reason`，第二个 reject 分支因此缺必填字段；合法形状 `{ action: 'reject', reason }` 当前返回 `400 fst_err_validation`，尚未到达业务服务。真实 HTTP 测试锁住此事实，仓储→服务测试独立验证终态/CAS 拒绝仍为 typed conflict；修复入口须另行裁决校验策略，本轮不改变 schema 或全局 Ajv。

- 已知错误状态不一致（保留既有 wire，待独立裁决）：Authoring job/command/task/amendment 幂等参数漂移与 semantic revision ID 内容漂移、归档版本只读拒绝、功能脚本中文 Schema validator 失败仍为 `500 internal_error`；场景 revision 的非法 payload/calls/call 为 `400 validation_error`，未支持 `runWhen` 为 `500 internal_error`，未支持 repeat 为 `409 conflict`。这些拒绝均可沿真实仓储调用重现，API reason 回归用例锁住场景三类结果；不能因为文案或 callKey 含 `state/required/not found` 而改变结果。正常 Run/Authoring 的共享摘要/内联机密校验为 400；Project/BusinessVersion 的既有 mapper 语义保留，本轮 stub 测试不宣称 Project 合法 wire 可触发共享拒绝。
