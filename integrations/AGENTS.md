# integrations 开发约束

## 范围

- `browser-control-client/` 只消费 `proxy-adapter` 的 loopback HTTP 控制面与 `/mcp`，不得导入 Playwright/CDP 或新增代理路由。
- `deepseek-harness-plugin/` 只通过 `@nebula-link-evo/browser-control-client` 取得浏览器能力，不复制会话、租约或操作账本实现。
- `ai-e2e` 复用该客户端的 HTTP 控制面；E2E 适配器只映射领域错误、转换 artifact Buffer，直接消费 shared browser-execution DTO，不复制传输或协议。E2E 自有 FIFO/outbox/lease/operation 生命周期不移入 `ControlledBrowserSession`。
- 新增或修改公共行为时同步对应 `PRODUCT-SPEC.md`、根 `docs/PRODUCT-SPEC-INDEX.md` 与 `docs/shipped/` 单元清单。

## 安全边界

- lease token 只可存在进程内；日志、错误、CLI 默认输出、工具值和 Harness presentation/trace 均不得包含 token。
- v1 只允许 loopback `proxy-adapter`；不承诺远程认证、多租户、stdio MCP 或公共 npm 发布。
- 所有 act 自动化必须有显式授权：CLI 使用 `--allow-act`，Harness 使用逐次 `allowed-once`。
- 不开放 JavaScript、CDP、坐标动作或模型侧浏览器生命周期工具；秘密输入留给用户在可视浏览器中手工完成。

## 验证

- 本地 TypeScript import 保留 `.js` 后缀。
- 修改客户端或 CLI 后运行 `pnpm --filter @nebula-link-evo/browser-control-client type-check` 与 `test`。
- 修改 Harness 插件后运行 `pnpm --filter @nebula-link-evo/deepseek-harness-plugin type-check` 与 `test`；测试必须使用真实 Cordis/ToolRuntime/Approval 服务验证注册与拒绝语义。
