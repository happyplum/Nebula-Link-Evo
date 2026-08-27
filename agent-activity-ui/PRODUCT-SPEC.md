# agent-activity-ui — 产品规格 (PRODUCT-SPEC)

> 一句话目标：为 Nebula 的 Chat、Authoring 与 Run 提供唯一的 Agent 活动 reducer 与 React 渲染组件。
> 包名：`@nebula-link-evo/agent-activity-ui` ｜ 角色：无状态前端库

## 1. 包级目标与边界

- 消费 `@nebula-link-evo/shared` 的 Agent Stream v1，只负责确定性状态归并和呈现。
- 提供 `compact` / `comfortable` 密度、CSS 变量主题、Markdown/决策/证据插槽、可见键盘焦点、44px 热区和 reduced-motion。
- 不拥有 API、SSE、持久化、store、router、业务权限或控制面状态；调用方负责连接、鉴权和操作。
- 不提供旧 Thinking、Tool 卡片或 Chat 消息结构的适配入口。

## 2. 模块清单

| 模块 | 路径 | 状态 | 职责 |
| --- | --- | --- | --- |
| Reducer | `src/reducer.ts` | shipped | snapshot/live 合并、seq 去重、稳定 section 原位更新、确定性前缀重放 |
| Renderer | `src/renderer.tsx` | shipped | section 语义渲染、连续 activity 分组与 32 项边界、业务插槽 |
| Theme | `src/styles.css` | shipped | 两档密度、明暗 CSS 变量、焦点、热区和 reduced-motion |
| Public entry | `src/index.ts` | shipped | 仅导出 renderer、slots、reducer 与初始化/回放函数 |

## 3. 功能与验收

- 单个 Activity 直接展示，连续多个 Activity 自动分组；reasoning、content、decision、plan、media、file 等 section 构成分组边界。
- `visibility=redacted` 不渲染原始 reasoning；只有 `visibility=public` 才允许渲染正文。
- snapshot 和任意 live event 前缀重放结果确定；重复 seq、跨 stream 事件和旧 seq 不改变状态。
- `renderMarkdown`、`renderDecisionAction`、`renderArtifact` 是唯一业务扩展口，组件本身不执行操作。
- 验收命令：`pnpm --filter @nebula-link-evo/agent-activity-ui type-check test test:coverage build`。

## 4. 修改维护协议 [MUST-MAINTAIN]

- 修改公共导出、分组语义、密度、插槽或可访问性行为时同步本文件与 `docs/PRODUCT-SPEC-INDEX.md`。
- 修改 Agent Stream section/event 字段时先同步 shared 契约及所有消费方规格，再更新 reducer/renderer 测试。
- 新增业务操作前先确认其仍通过 slot 注入；不得把 API、权限或业务 store 下沉到本包。

## 5. 已知缺口与技术债

当前无已知技术债。
