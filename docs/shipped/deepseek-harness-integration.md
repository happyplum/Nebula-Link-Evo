# deepseek-harness-integration

- [shipped] `integrations/deepseek-harness-plugin/package.json` 以 `dsh.bundle.patch` 指向 `cordis.patch.yml`，可通过 `dsh plugin --profile <name> add ./integrations/deepseek-harness-plugin` 本地安装；卸载使用 `remove @nebula-link-evo/deepseek-harness-plugin`。
- [shipped] 已验证依赖精确锁定：`@deepseek-ai/dsh@0.1.1-rc.2`、`@deepseek-ai/cordis@4.0.1`、`@deepseek-ai/dsh-tools@0.1.1-rc.2`、`@deepseek-ai/dsh-user-approval@0.1.1-rc.2`；registry peer contract 已证明旧 tools/approval `0.0.1-rc.1` 与该 DSH 版本不兼容。
- [shipped] 插件注入 `tools` 与 `approval`，只注册 `nebula_browser_observe` 和 `nebula_browser_act`；模型参数仅 `{operation,target?,args?}`，浏览器 session/Tab/lease/token/sequence/operationId 全部隐藏。
- [shipped] observe 无审批；每个 act 必须取得 `ctx.approval` 的 `allowed-once`，`rejected`/`cancelled`/`unavailable`/headless `never` 全部失败关闭。
- [shipped] operation key 由 Harness session、`exec.callId` 与工具名稳定形成并传给受控客户端；`exec.signal` 贯穿取消/ledger 恢复链，未知结果不重放。
- [shipped] 一个插件实例只允许一个 Harness session 持有浏览器；其他 session 返回 `browser_busy`，不共享隐藏 binding。HMR/卸载注销工具并按 client 所有权语义清理 session/lease。
- [shipped] DSH 原生 generic card 展示操作、状态、语义目标和 artifact 数量；无专属 UI，不接管 debug-ui live view。
- [shipped] 操作枚举不包含 JS/CDP/坐标能力，模型工具不暴露 session/lease/browser open/close 生命周期入口；坐标/脚本/敏感参数键及 password/token 类 fill/type_text 目标在审批前拒绝，v1 不注入秘密。
- [shipped] 同一 profile 不得向同 proxy 同时挂载官方通用 MCP bridge，避免 18 个原始工具绕过包装层。
- [shipped] 真实 Cordis/SystemPrompt/ToolRuntime/Approval 测试覆盖注册、observe、act/拒绝态、never、跨 session 争用、稳定调用身份、脱敏及 HMR/卸载。
