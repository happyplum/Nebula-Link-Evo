# deepseek-harness-plugin — 产品规格 (PRODUCT-SPEC)

> 一句话目标：以 DeepSeek Harness 原生工具与审批接口安全接入 Nebula 可视浏览器控制面。
> 端口：无（DSH bundle） ｜ 包名：`@nebula-link-evo/deepseek-harness-plugin` ｜ 状态：shipped

---

## 1. 包级目标与边界

| Owns                                                                               | Consumes                                        | Does NOT own                                                                 |
| ---------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| DSH bundle/patch、两个模型工具、逐 act 审批、单 session 占用与 native presentation | Cordis tools/approval；`browser-control-client` | Playwright/CDP、proxy 路由、通用 MCP bridge、专属 UI、秘密注入、E2E 业务策略 |

- 模型参数只有 `{operation,target?,args?}`；浏览器 binding 和凭证全部隐藏注入。
- 同一实例只允许一个 Harness session 持有浏览器，不共享隐藏 binding。
- 同 profile 不得同时挂载指向同 proxy 的官方通用 MCP bridge。

## 2. 模块清单

| 模块            | 路径                               | 状态    | 职责                                                              |
| --------------- | ---------------------------------- | ------- | ----------------------------------------------------------------- |
| Bundle manifest | `package.json`、`cordis.patch.yml` | shipped | `dsh.bundle.patch` 与 Cordis plugin row                           |
| 插件运行时      | `src/index.ts`                     | shipped | 两工具、审批、稳定调用身份、单 owner、信号传播、脱敏、native card |
| 运行时验证      | `src/index.test.ts`                | shipped | 真实 Cordis/SystemPrompt/ToolRuntime/Approval 组合测试            |
| 第三方声明      | `THIRD_PARTY_NOTICES.md`           | shipped | DeepSeek Harness/Cordis MIT 依赖声明                              |

## 3. 工具契约

| 工具                     | 操作范围              | 审批                    | 隐藏字段                                                    |
| ------------------------ | --------------------- | ----------------------- | ----------------------------------------------------------- |
| `nebula_browser_observe` | 配置的 observe 白名单 | 无                      | sessionId、tabId、leaseId/token、leaseSequence、operationId |
| `nebula_browser_act`     | 配置的 act 白名单     | 每次必须 `allowed-once` | 同上                                                        |

拒绝、取消、无人应答、`never`、跨 session 争用和敏感输入都失败关闭。禁止 JS、CDP、坐标操作和模型侧浏览器生命周期。

## 4. 功能清单

| 功能                                  | 状态    | 验收面                                  |
| ------------------------------------- | ------- | --------------------------------------- |
| 两工具注册与 observe 直通             | shipped | `index.test.ts`                         |
| act 单次审批及全部拒绝态              | shipped | `index.test.ts`（真实 ApprovalService） |
| 单 Harness session 占用与稳定调用 key | shipped | `index.test.ts`                         |
| HMR/卸载清理、原生工具卡、凭证脱敏    | shipped | `index.test.ts`                         |
| 敏感目标/参数与危险操作拒绝           | shipped | `index.test.ts` + 操作 enum             |

## 5. 修改维护协议 [MUST-MAINTAIN]

- 修改工具名、模型参数、审批结果解释、owner 语义、隐藏字段、敏感输入规则、bundle patch 或锁定 DSH 版本时，必须同步本文件、README、根索引与 `docs/shipped/deepseek-harness-integration.md`。
- 修改浏览器控制语义时同步 `browser-control-client` PRODUCT-SPEC；不得在插件内复制控制器。

## 6. 已知边界

| 边界                          | 状态    | 说明                                             |
| ----------------------------- | ------- | ------------------------------------------------ |
| Harness 稳定版兼容            | pending | 当前基于 developer preview `0.1.1-rc.2` 精确锁定 |
| 秘密注入、专属 UI、远程 proxy | pending | v1 不提供                                        |
