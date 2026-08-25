# browser-control-client — 产品规格 (PRODUCT-SPEC)

> 一句话目标：为本地受控浏览器消费者提供统一的协议客户端、自动会话控制器和 `nebula-browser` CLI。
> 端口：无（客户端包） ｜ 包名：`@nebula-link-evo/browser-control-client` ｜ 状态：shipped

---

## 1. 包级目标与边界

| Owns                                                 | Consumes                                                                  | Does NOT own                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| browser execution HTTP/MCP 客户端、受控会话状态、CLI | `@nebula-link-evo/shared` 公共线协议；`proxy-adapter :3000` HTTP + `/mcp` | Playwright/CDP、proxy 路由、AI/Agent 编排、业务副作用策略、远程认证 |

- v1 仅接受 loopback proxy URL。
- token 只驻留内存；普通输出、错误和诊断不得包含 token。
- 操作必须串行；结果不确定时核查 ledger，不能证明终态则禁止重放。

## 2. 模块清单

| 模块         | 路径                                      | 状态    | 职责                                                                               |
| ------------ | ----------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| 线协议客户端 | `src/client.ts`、`src/mcp-tool-caller.ts` | shipped | HTTP capability/session/lease/operation/artifact；MCP execute/cancel；problem 映射 |
| 受控会话     | `src/controlled-session.ts`               | shipped | 协议检查、显式 attach、活动 Tab、control lease、串行、轮换、ledger 恢复与清理      |
| CLI          | `src/cli.ts`                              | shipped | JSON 低层命令、NDJSON run、交互 shell、act 门禁、稳定退出码                        |
| 公共入口     | `src/index.ts`                            | shipped | 导出客户端、控制器、错误与公共配置类型                                             |
| 测试门禁     | `vitest.config.ts`                        | shipped | 全包覆盖率防回退，并对 client/controlled-session 设置模块级阈值                    |

## 3. CLI 契约

| 接口                                                  | 输出                    | 门禁                                                            |
| ----------------------------------------------------- | ----------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `capabilities`、`session *`、`lease *`、`operation *` | 单个 JSON               | 写入要求幂等键；token 仅 env/专用 stdin；act 要求 `--allow-act` |
| `run --input <file                                    | ->`                     | 每行 NDJSON                                                     | 输入字段 `{id,kind,operation,target?,args?}`；顺序执行；失败/未知结果立即停止 |
| `shell`                                               | JSON 结果 + stderr 诊断 | token 仅内存；每个 act 单独确认                                 |

退出码：`0` 成功、`1` 内部错误、`2` 参数/校验、`3` 连接/兼容、`4` 领域失败、`5` `outcome_unknown`。

## 4. 功能清单

| 功能                                           | 状态    | 验收面                                         |
| ---------------------------------------------- | ------- | ---------------------------------------------- |
| capability major 与 loopback 校验              | shipped | `client.test.ts`、`controlled-session.test.ts` |
| 幂等 header、problem/连接错误映射              | shipped | `client.test.ts`                               |
| token 脱敏、act 门禁、JSON/NDJSON              | shipped | `cli.test.ts`                                  |
| 租约轮换、串行、稳定 operationId、未知结果恢复 | shipped | `controlled-session.test.ts`                   |
| attach/自有 session 清理差异                   | shipped | `controlled-session.test.ts`                   |

## 5. 修改维护协议 [MUST-MAINTAIN]

- 修改 proxy 路径、MCP 工具名、公共协议 major、CLI 命令/字段/退出码、token 流向、租约或 ledger 恢复语义时，必须同步本文件、README、根索引与 `docs/shipped/browser-control-cli.md`。
- 修改公共线协议必须同步 `shared`、`proxy-adapter` 及所有消费者 PRODUCT-SPEC。

## 6. 已知边界

| 边界                                       | 状态    | 说明                              |
| ------------------------------------------ | ------- | --------------------------------- |
| 远程认证、多租户、stdio MCP、公共 npm 发布 | pending | v1 不承诺                         |
| 秘密注入                                   | pending | v1 要求用户在可视浏览器中手工输入 |
