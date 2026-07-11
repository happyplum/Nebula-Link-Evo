# shipped 清单

本目录记录每个功能单元的**计划、设计状态与已落实事实**，防止实现回退与规格漂移。

## 与 PRODUCT-SPEC 的关系

| 维度 | shipped 清单（本目录） | PRODUCT-SPEC（各包） |
|------|----------------------|---------------------|
| 组织方式 | 按**功能单元**（跨包功能边界） | 按**包**（模块/路由/功能契约） |
| 关注点 | 实现事实追踪与防回退 | 模块清单与修改维护协议 |
| 粒度 | 一个功能单元一份文件 | 一个包一份文件 |

两者互补：PRODUCT-SPEC 登记"包内有什么模块/路由/功能和怎么维护"，shipped 清单追踪"每个跨包功能单元落实了哪些具体事实"。

## 格式约定

每份清单用扁平列表，标记当前状态：

| 标记 | 含义 |
|---|---|
| `[shipped]` | 已实现并验证 |
| `[tech-debt]` | 已知偏差或临时实现，待后续修正（**附加标记**，可与 `[shipped]` 同时使用，表示「已实现但有技术债」） |
| `[stub]` | 占位实现，功能不可用 |
| `[pending]` | 尚未实现 |
| `[designed]` | 规格已设计，实现待接入 |

状态升级路径：`[designed]` → `[pending]`（进入开发排期）→ `[shipped]`（实现验证）。

每条记录应包含**精确事实**：文件路径、字段名、接口、行为边界。不写泛化用户故事、不可验证愿望或大段状态机模板；`[pending]` / `[designed]` 条目必须包含可验证对象。

## 索引

| 单元 | 所属包 | 清单文件 |
|---|---|---|
| browser-control-mcp | proxy-adapter | [browser-control-mcp.md](browser-control-mcp.md) |
| browser-engine | proxy-adapter | [browser-engine.md](browser-engine.md) |
| debug-stream | proxy-adapter | [debug-stream.md](debug-stream.md) |
| chat-sse-stream | ai-chat-service | [chat-sse-stream.md](chat-sse-stream.md) |
| session-state-machine | ai-chat-service | [session-state-machine.md](session-state-machine.md) |
| ai-provider-system | ai-chat-service | [ai-provider-system.md](ai-provider-system.md) |
| vision-analysis | ai-chat-service | [vision-analysis.md](vision-analysis.md) |
| chat-rendering | debug-ui | [chat-rendering.md](chat-rendering.md) |
| debug-ui-panels | debug-ui | [debug-ui-panels.md](debug-ui-panels.md) |
| liveview-system | debug-ui + proxy-adapter | [liveview-system.md](liveview-system.md) |
| ai-e2e-orchestration | ai-e2e | [ai-e2e-orchestration.md](ai-e2e-orchestration.md) |
| shared-types | shared | [shared-types.md](shared-types.md) |

## 同步规则

见项目 `AGENTS.md` 的 shipped 清单工作流节。
