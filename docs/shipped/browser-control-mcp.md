# browser-control-mcp `proxy-adapter :3000 /mcp`

proxy-adapter 通过 MCP Server (StreamableHTTP) 只对外暴露受控 `browser-control.operation_execute/get/cancel`，是 Nebula 受控浏览器执行的网关。

- [shipped] MCP Server 传输层：`proxy-adapter/src/mcp-server/`（index / transport），`POST /mcp` 提供无状态 JSON StreamableHTTP；可选 `GET /mcp` SSE 通道返回 405，使标准客户端回退到 POST 响应而不触发重连。
- [shipped] ToolRegistry + browser-execution provider：`proxy-adapter/src/tools/`（registry / types / providers/browser-execution-tools-provider / adapters/mcp-server / adapters/json-schema-to-zod）。JSON Schema 编译为 strict validator，不支持的 schema 拒绝注册。
- [shipped] MCP 工具集仅 3 个受控原子工具 `browser-control.operation_execute/get/cancel`；旧 15 个 browser-control 工具、BrowserToolsProvider、ToolConsumer/exposeTo、action executor 和参数/结果适配层已物理删除。
- [shipped] proxy `server.ts` 显式注册 canonical HTTP/MCP/debug surfaces；无调用方的 CORS/Swagger/error/autoload 插件栈、barrel 与对应 Swagger 依赖已物理删除。
- [shipped] 结构化语义步骤可通过 application-level session/稳定 Tab/短期 lease 进入 FIFO 原子操作链；网关只处理通用浏览器约束，不解释场景或脚本业务语义。
- [shipped] `browser-control.operation_execute/get/cancel` 是唯一 MCP 工具面；`ai-chat-service` 只在隔离 DSH transport 中持有原始工具，受限 Agent 模型只提交冻结 stepId，wrapper 注入 target/args、session/Tab/lease/token/leaseSequence/operation ID，get/cancel 不暴露给模型。
- [shipped] `integrations/browser-control-client` 复用同一组受控工具：execute/cancel 走 `/mcp`，capability/session/lease/artifact/operation ledger 走既有 HTTP；BrowserExecutionError 通过 `isError: true` 的结构化 problem 穿过真实 MCP 边界，未新增 proxy 路由或工具。
- [shipped] `GET /api/v1/capabilities` 已声明 browser-execution/operation `1.0`、支持动作/观测、持久账本、可视画面和当前限制；生产 `start()` 对非 loopback `HOST` 在构建应用前失败，proxy 重启递增 process epoch、使旧租约失效，并将 running operation 收敛为 `outcome_unknown`。
- [shipped] v1 固定 `maxActiveBrowserSessions=1`、`maxBrowserContextsPerSession=1`，不支持运行中 Context/storage-state 切换；最多一个 control lease，observe 只在安全边界签发且单次使用，live view 无控制权。受控 session 期间 debug 写入、直接 DOM/截图/脚本采集返回 `browser_busy`，状态读取与 live stream 可继续。
- [shipped] operation artifact ref 必含 `sizeBytes`，DOM snapshot ref 携带 `snapshotId`；ai-chat browser wrapper 只为终态 succeeded、observe `dom_snapshot`、完整 SHA-256/MIME/size 的产物生成 `VisionSnapshotBindingV1`。
- [designed] deployment environment、副作用风险投影和计划级审批归 ai-e2e，逐工具授权交集归 ai-chat-service wrapper；proxy 不读取环境标签、不签发/解释 grant，只校验通用 lease/Tab/operation/target/args 与幂等账本。
- [shipped] browser lease 使用 32-byte opaque token，proxy 仅保存 SHA-256 hash/policy/expiry/process epoch；observe 最长 30 秒、control 最长 5 分钟。operation ledger 使用 `data/proxy-adapter/browser-execution.sqlite` SQLite WAL，动作前写 queued，支持 operation ID 去重、queued cancel 和重启恢复；请求 payload 脱敏保存。
- [shipped] `browser-execution` schema migration 2 提供短期证据数据地基：operation capture 请求/完成度、截图/DOM/video/trace artifact 元数据、TTL/opaque upstream hold/清理资格，以及 session-scoped 持久事件与事务内单调 seq；迁移有 checksum 且可重入，媒体 bytes 不进入 SQLite。
- [shipped] 受控执行已覆盖 page_state/dom_snapshot/target_state/url/title/text/value/attribute/count/tabs 观测，以及 navigate/click/fill/type_text/press/select_option/check/uncheck/focus/blur/hover/scroll/switch_tab/close_tab 动作；重新解析 locator candidates 并拒绝歧义，不开放 JS/CDP/坐标。
- [shipped] `shared/types/browser-execution.ts` 以 kind/operation 判别联合映射每个操作的精确 args；proxy 运行时继续拒绝缺失、额外或越界字段，执行分支不再使用字符串键或参数强制转换。
- [shipped] `operation_execute` 支持 before/after screenshot 与 DOM capture，失败操作即使未主动请求也会尝试保存现场截图；bytes 以 SHA-256 内容寻址写入 `data/proxy-adapter/artifacts`，操作结果只返回 opaque artifact ref。`GET /api/v1/browser-execution/sessions/:sessionId/artifacts/:artifactId` 在返回前复核 storage ref、size 和 SHA-256。
- [shipped] browser session 持久事件按 session 单调 seq 记录；`/events` 每次连接先发 `browser_session.snapshot`，`/event-log?afterSeq=` 用于审计补洞，heartbeat 不占业务 seq。
- [pending] set_files、video segment 和操作动画尚未交付；capability 保持 `operationPresentationAnimation=false`。
- [shipped] control lease 最长 5 分钟，客户端仅在原子操作安全边界撤销并重发；v1 不提供原地续租，只有运行指标证明轮换影响任务后才可另行定义续租协议。
- [shipped] v1 对未按上层项目规则处理的截图/DOM 保持受限原始证据语义，不承诺通用自动脱敏；开放证据外发、共享、远程/多用户访问或项目级隐私策略前，必须先定义脱敏与权限验收标准。
- [designed] 浏览器截图、DOM 和媒体属于带完整性信息的短期原始产物；长期证据 manifest、业务关联、保留与 pin 由 ai-e2e 持有，原始产物清理前需可被提升或明确过期。
- [shipped] 配置入口：消费方通过 `PROXY_ADAPTER_URL + /mcp`（默认 `http://127.0.0.1:3000/mcp`）接入。
- [shipped] 验收面：既有 MCP/provider 测试 + `browser-execution-service.test.ts`、`browser-execution-routes.test.ts`、`browser-execution-tools-provider.test.ts`、`playwright-browser-execution.test.ts`；2026-08-26 proxy-adapter 全量测试通过。
- [shipped] 真实进程 E2E 覆盖长 operation 期间 debug status/SSE 可读、debug 写/DOM 拒绝、running cancel 冲突、queued cancel 成功、安全边界恢复，以及进程崩溃重启后 running operation 收敛为 `outcome_unknown`、session 为 `interrupted`、旧 lease 凭证失效。
- [shipped] browser execution 的 service/repository/artifact-store 与 BrowserService 设置 lines ≥80%、branches ≥70% 文件级覆盖率防回退门槛。
- [shipped] proxy 启动后立即并每分钟运行短期产物保留清理：仅处理 TTL 到期且无有效 upstream hold 的记录；内容寻址文件仍被其他非删除记录引用时保留，最后一个引用删除时才移除文件，并为每条记录追加 `artifact.deleted` 持久事件。清理失败保留 `expired` 状态供后续周期重试。
- [shipped] 同一每分钟保留周期在 artifact 清理后执行账本清理：只移除关闭/中断/失败 session 下终态超过 7 天、非 `outcome_unknown` 且关联 artifact 已删除的 operation/capture/artifact/hold 元数据；session/lease 幂等键仅在资源终态且没有 queued/running/outcome_unknown operation 时移除，每周期有界批量处理。
