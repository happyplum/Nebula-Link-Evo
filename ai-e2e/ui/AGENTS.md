# AI E2E UI

## 边界

- UI 只提供 semantic 项目首页、业务版本入口、Authoring 工作台和 Run 工作台。
- 禁止恢复旧四步向导、旧项目 API、旧 Agent 浮窗或开发 fixtures 路由。
- 权威状态来自 v1 workspace/snapshot、持久 event-log 与 snapshot-first SSE；Chat 文本本身不是状态。

## 工作台规则

- 左侧展示 PRD/页面/模块/场景/TODO，中间浏览器持续挂载，右侧展示上下文、Diff、影响、决策和证据，Chat 常驻可折叠。
- 模块切换只更新深链接上下文；只有“在浏览器中定位”才创建 navigation-only Authoring task。
- 候选必须在当前模块、base revision 和审批范围仍匹配时才能排队应用。
- 新建项目携带 `bootstrap=1` 和目标 URL 深链接，工作台只自动创建一次 bootstrap 任务。
- 三栏支持指针/键盘调整、双击复位、宽度持久化、缩放/收起/专注、system/light/dark 和 reduced-motion。
- 所有交互提供可见焦点、语义标签、键盘路径和足够点击热区。

## 验证

- 严格类型检查必须使用 `pnpm exec tsc -p tsconfig.app.json --noEmit`；根引用型 `tsc --noEmit` 不能替代它。
- 运行 `pnpm test` 与 `pnpm build`；工作台改动需覆盖模块切换不导航、浏览器不重挂载、深链接恢复、候选权限与 Run 恢复。
