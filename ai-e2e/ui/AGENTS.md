# AI E2E UI

## 边界

- UI 只提供 semantic 项目首页、业务版本入口、Authoring 工作台和 Run 工作台。
- 禁止恢复旧四步向导、旧项目 API、旧 Agent 浮窗或开发 fixtures 路由。
- Agent 活动连接复用 `@nebula-link-evo/agent-stream-client`；局部 snapshot 带 endpoint/真实 job 或 run id，切换首 render 不显示旧内容。连接状态与立即重连只恢复观察，Run 不发命令、不解锁编辑。独立 semantic event invalidation 流保持原契约。
- 权威状态来自 v1 workspace/snapshot、持久 event-log 与 snapshot-first SSE；Chat 文本本身不是状态。
- 公开 wire DTO 直接 `import type` 自 `../../src/contracts/` 的对应模块，不维护 UI DTO 副本，也不导入后端服务/仓储实现。`features/semantic/types.ts` 只保留 UI 布局和展示 helper。
- JSON 请求统一使用 `shared/api/request.ts`；成功保留 `{ data, meta }`，错误保留 HTTP status 及 ApiProblem 的 code/message/retryable/correlationId/details，非 JSON 错误使用安全通用文案。
- 基础组件由 `src/shared/components/` 唯一维护并导出当前产品使用的 Button（含 44px touch 尺寸）、Input、Card、Modal；`src/components/ui/` 仅保留 Sonner Toaster 适配。`components.json` 是生成工具配置，不构成另一套组件 owner；新增同职责基础能力应在 shared/components 补齐并复用。

## 工作台规则

- 左侧展示 PRD/页面/模块/场景/TODO，中间浏览器持续挂载，右侧展示上下文、Diff、影响、决策和证据，Chat 常驻可折叠。
- 模块切换只更新深链接上下文；只有“在浏览器中定位”才创建 navigation-only Authoring task。
- 候选必须在当前模块、base revision、精确冻结计划和授权仍匹配时才能排队应用。既有决策 UI 按 category 区分范围扩展与副作用批准；展示真实环境、候选、风险摘要和 source plan/projection hash，不把 scope approval 当 grant。
- 新建项目携带 `bootstrap=1` 和目标 URL 深链接，工作台只自动创建一次 bootstrap 任务。
- 三栏支持指针/键盘调整、双击复位、宽度持久化、缩放/收起/专注、system/light/dark 和 reduced-motion。
- 所有交互提供可见焦点、语义标签、键盘路径和足够点击热区。

## 验证

- 严格类型检查必须使用 `pnpm exec tsc -p tsconfig.app.json --noEmit`；根引用型 `tsc --noEmit` 不能替代它。
- 运行 `pnpm test` 与 `pnpm build`；工作台改动需覆盖模块切换不导航、浏览器不重挂载、深链接恢复、候选权限与 Run 恢复。
