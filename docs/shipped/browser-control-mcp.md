# browser-control-mcp `proxy-adapter :3000 /mcp`

proxy-adapter 通过 MCP Server (StreamableHTTP) 对外暴露 `browser-control.*` 工具集，是所有 AI 客户端（ai-chat-service / Claude Desktop / Cursor / aichat）的浏览器能力底座。

- [shipped] MCP Server 传输层：`proxy-adapter/src/mcp-server/`（index / transport），`POST /mcp` 提供无状态 JSON StreamableHTTP；可选 `GET /mcp` SSE 通道返回 405，使标准客户端回退到 POST 响应而不触发重连。
- [shipped] ToolRegistry + browser-control provider：`proxy-adapter/src/tools/`（registry / types / index / providers/browser-tools-provider / adapters/mcp-server / adapters/json-schema-to-zod）。外部 MCP client/provider 归 `ai-chat-service`，proxy-adapter 不再包含该 provider。
- [tech-debt] `GatewayTool.exposeTo` / `BrowserToolsProvider` 仍保留未使用的 legacy `chat` consumer 标记；本包当前没有 Chat 路由或 Chat 工具消费方。
- [shipped] browser-control.\* 工具定义与参数/结果适配：`proxy-adapter/src/browser-tools/`（definitions / tool-map / param-adapter / result-adapter / types / index）。
- [shipped] MCP 工具集共 18 个：15 个兼容 browser-control 工具（含 screenshot、click、type、dom_snapshot 等）+ 3 个受控原子工具 `browser-control.operation_execute/get/cancel`；区别于 `Action` 联合类型（12 种，不含 screenshot）。
- [shipped] 12 种 action 类型（对应 `shared/types/action.ts` 的 `Action` 联合）：click / type / focus / blur / hover / value / dispatch / scroll / navigate / wait / mcp_call / finish。
- [shipped] action 执行入口：`proxy-adapter/src/services/action-executor.ts`。
- [shipped] 结构化语义步骤可通过 application-level session/稳定 Tab/短期 lease 进入 FIFO 原子操作链；网关只处理通用浏览器约束，不解释场景或脚本业务语义。
- [shipped] `browser-control.operation_execute/get/cancel` 已注册到 MCP Server；`ai-chat-service` 受限 Agent wrapper 已模型不可见地注入 session/Tab/lease/token/leaseSequence/operation ID，并在 execute 结果不明时先调用 get 核账。普通 Chat provider 继续显式过滤三项工具，get/cancel 不暴露给任务模型。
- [shipped] `integrations/browser-control-client` 复用同一组受控工具：execute/cancel 走 `/mcp`，capability/session/lease/artifact/operation ledger 走既有 HTTP；BrowserExecutionError 以结构化 problem 穿过 MCP 文本 envelope，未新增 proxy 路由或工具。
- [shipped] `GET /api/v1/capabilities` 已声明 browser-execution/operation `1.0`、支持动作/观测、持久账本、可视画面和当前限制；proxy 重启递增 process epoch、使旧租约失效，并将 running operation 收敛为 `outcome_unknown`。
- [shipped] v1 固定 `maxActiveBrowserSessions=1`、`maxBrowserContextsPerSession=1`，不支持运行中 Context/storage-state 切换；最多一个 control lease，observe 只在安全边界签发且单次使用，live view 无控制权。受控 session 期间 legacy MCP/debug 写入及直接 DOM/截图读取返回 `browser_busy`。
- [designed] deployment environment、副作用风险投影和计划级审批归 ai-e2e，逐工具授权交集归 ai-chat-service wrapper；proxy 不读取环境标签、不签发/解释 grant，只校验通用 lease/Tab/operation/target/args 与幂等账本。
- [shipped] browser lease 使用 32-byte opaque token，proxy 仅保存 SHA-256 hash/policy/expiry/process epoch；observe 最长 30 秒、control 最长 5 分钟。operation ledger 使用 `data/proxy-adapter/browser-execution.sqlite` SQLite WAL，动作前写 queued，支持 operation ID 去重、queued cancel 和重启恢复；请求 payload 脱敏保存。
- [shipped] `browser-execution` schema migration 2 提供短期证据数据地基：operation capture 请求/完成度、截图/DOM/video/trace artifact 元数据、TTL/opaque upstream hold/清理资格，以及 session-scoped 持久事件与事务内单调 seq；迁移有 checksum 且可重入，媒体 bytes 不进入 SQLite。
- [shipped] 受控执行已覆盖 page_state/dom_snapshot/target_state/url/title/text/value/attribute/count/tabs 观测，以及 navigate/click/fill/type_text/press/select_option/check/uncheck/focus/blur/hover/scroll/switch_tab/close_tab 动作；重新解析 locator candidates 并拒绝歧义，不开放 JS/CDP/坐标。
- [shipped] `operation_execute` 支持 before/after screenshot 与 DOM capture，失败操作即使未主动请求也会尝试保存现场截图；bytes 以 SHA-256 内容寻址写入 `data/proxy-adapter/artifacts`，操作结果只返回 opaque artifact ref。`GET /api/v1/browser-execution/sessions/:sessionId/artifacts/:artifactId` 在返回前复核 storage ref、size 和 SHA-256。
- [shipped] browser session 持久事件按 session 单调 seq 记录；`/events` 每次连接先发 `browser_session.snapshot`，`/event-log?afterSeq=` 用于审计补洞，heartbeat 不占业务 seq。
- [pending] set_files、video segment、control 续租、操作动画、自动脱敏和实际保留清理 worker 尚未交付；capability 保持 `operationPresentationAnimation=false`。
- [designed] 浏览器截图、DOM 和媒体属于带完整性信息的短期原始产物；长期证据 manifest、业务关联、保留与 pin 由 ai-e2e 持有，原始产物清理前需可被提升或明确过期。
- [shipped] 配置入口：消费方通过 `PROXY_ADAPTER_URL + /mcp`（默认 `http://127.0.0.1:3000/mcp`）接入。
- [shipped] 验收面：既有 MCP/provider 测试 + `browser-execution-service.test.ts`、`browser-execution-routes.test.ts`、`browser-execution-tools-provider.test.ts`、`playwright-browser-execution.test.ts`；2026-08-12 proxy-adapter 全量测试通过。
