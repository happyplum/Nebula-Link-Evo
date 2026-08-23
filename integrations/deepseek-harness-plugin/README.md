# DeepSeek Harness 受控浏览器插件

本地 DSH bundle 只向模型注册 `nebula_browser_observe` 与 `nebula_browser_act`。插件通过 `@nebula-link-evo/browser-control-client` 隐藏注入 session/Tab/lease/token/leaseSequence/operationId；不直连 Playwright，也不增加专属 UI。

## 安装与卸载

先构建工作区产物，再把本目录作为本地 bundle 加入目标 profile：

```powershell
pnpm --filter @nebula-link-evo/deepseek-harness-plugin build
dsh plugin --profile <name> add ./integrations/deepseek-harness-plugin
dsh --profile <name> --dump-config
```

卸载：

```powershell
dsh plugin --profile <name> remove @nebula-link-evo/deepseek-harness-plugin
```

`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`；profile 可在自己的 `cordis.patch.yml` 中覆盖本插件行的完整 `config`。

## 安全行为

- `nebula_browser_observe` 只允许配置白名单内的 observe 操作，无需审批。
- `nebula_browser_act` 每次调用都要求 `ctx.approval` 返回 `allowed-once`；`rejected`、`cancelled`、`unavailable` 和 headless `never` 全部失败关闭。
- 一个插件实例同时只允许一个 Harness session 持有浏览器；其他 session 得到 `browser_busy`。
- `exec.signal` 传入受控客户端；操作 ID 由 Harness session、`callId` 和工具名稳定派生，未知结果通过 proxy ledger 恢复且不重放。
- 不提供 JS、CDP、坐标动作或模型侧浏览器生命周期工具。密码、令牌等敏感目标的 fill/type_text 以及敏感参数键会在审批前拒绝；秘密由用户在可视浏览器中手工输入。
- DSH 原生 generic tool card 展示操作、状态、语义目标和 artifact 数量；不接管 `debug-ui` live view。

同一 DSH profile 不得再为同一个 `proxy-adapter` 配置官方通用 MCP bridge，否则 18 个原始 `browser-control.*` 工具可能绕过本插件的收窄、隐藏注入和逐次审批。

## 已验证版本

- `@deepseek-ai/dsh` `0.1.1-rc.2`
- `@deepseek-ai/cordis` `4.0.1`
- `@deepseek-ai/dsh-tools` `0.1.1-rc.2`
- `@deepseek-ai/dsh-user-approval` `0.1.1-rc.2`

这些版本均为精确依赖，不使用范围版本。`dsh@0.1.1-rc.2` 的 peer contract 要求 tools/approval `^0.1.1-rc.2`；旧 `0.0.1-rc.1` 与该 Harness 版本不兼容。
