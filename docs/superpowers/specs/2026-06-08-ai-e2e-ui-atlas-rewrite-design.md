# AI E2E UI Atlas 视觉全面重写设计

> 日期: 2026-06-08
> 状态: approved
> 范围: ai-e2e/ui 前端全面重写 + 后端路由/SSE 补全

## 1. 决策摘要

| 决策项 | 选择 |
|--------|------|
| 重构范围 | 视觉全面升级 + 功能补全一起做 |
| 设计语言 | Atlas 风格（AMOLED 纯黑极简） |
| Tab 结构 | 从 5 扩展到 7（新增场景、报告） |
| 技术栈 | Tailwind CSS 4 + shadcn/ui（Radix UI） |
| AI 状态可视化 | 内联状态卡片 |
| 实施方案 | 自底向上（Token → 组件 → 页面） |

## 2. 色彩系统

### Surface 层次（4 层递进，边框定义表面）

```
L0 Base:      #000000   页面底色
L1 Panel:     #0a0a0a   侧边栏、导航
L2 Content:   #111111   主内容区面板
L3 Elevated:  #1a1a1a   卡片、弹出层、模态框
```

### Text 层次（3 层递减）

```
Primary:      #ededed   正文、标题
Secondary:    #a3a3a3   次要文本、标签
Muted:        #525252   占位符、禁用文本
```

### Border 层次

```
Default:      #262626   默认边框
Hover:        #404040   hover/focus 边框
```

### Status 色（仅用于状态语义）

```
Success:      #22c55e
Error:        #ef4444
Warning:      #f59e0b
Info:         #3b82f6
```

## 3. 间距系统（4px 网格）

```
0: 0px     1: 4px     2: 8px     3: 12px
4: 16px    5: 20px    6: 24px    8: 32px
10: 40px   12: 48px   16: 64px
```

## 4. 字体系统

```
Family:     system-ui, -apple-system, sans-serif
Monospace:  'JetBrains Mono', 'Fira Code', monospace

Size scale:
  xs: 11px    sm: 12px    base: 13px    lg: 14px
  xl: 16px    2xl: 18px   3xl: 24px

Weight: normal: 400  medium: 500  semibold: 600
```

## 5. 圆角 + 阴影

```
Radius:  none(0)  sm(4px)  md(6px)  lg(8px)

Shadow（仅 Overlay/Modal）:
  overlay: 0 4px 24px rgba(0,0,0,0.5)
  modal:   0 8px 48px rgba(0,0,0,0.7)
```

## 6. 组件库

### 现有组件 → shadcn/ui 映射

| 现有 | shadcn/ui 替换 | Atlas 定制 |
|------|----------------|-----------|
| Button | `Button` | `bg-surface-elevated` 默认，hover `border-hover`；danger 用 status-error 文字色 |
| Card | `Card` + `CardHeader` + `CardContent` | `bg-surface-elevated border-border`，无阴影 |
| Modal | `Dialog` | `bg-surface-elevated shadow-modal`，slideUp 动画保留 |
| Table | `Table` 系列 | `border-border` 分隔，hover 行 `bg-surface-panel` |
| Input | `Input` + `Label` | `bg-surface-base border-border`，focus `border-hover` |
| Tree | 保留自写，Tailwind 重写样式 | `text-secondary` 缩进线，`text-primary` 选中态 |
| CodeEditor | 保留自写，Tailwind 重写样式 | `bg-surface-base text-text font-mono` |

### 新增 shadcn/ui 组件（18 个）

`Tabs`, `Select`, `Badge`, `Tooltip`, `DropdownMenu`, `Progress`, `Separator`, `ScrollArea`, `Sheet`, `Skeleton`, `Toast`, `Switch` + `Dialog`/`Button`/`Card`/`Input`/`Label`/`Table`（已映射）

### 新组件：InlineAIStatusCard

内联 AI 状态卡片，出现在操作区顶部：

```
┌─ AI 正在工作 ──────────────────────────┐
│ ● 正在分析 PRD 文档...                   │
│   ├ 调用 LLM 分解模块 [完成]             │
│   ├ 生成功能模块场景 [进行中...]          │
│   └ 等待下一步...                        │
│                              [取消]      │
└─────────────────────────────────────────┘
```

- 背景: `bg-surface-elevated border-l-2 border-l-status-info`
- SSE 事件驱动内容更新
- 完成后自动消失（或显示结果摘要 3 秒后消失）

### 紧凑密度

```
按钮 height: 28px(sm) / 32px(default) / 36px(lg)
Input height: 28px
表格行高: 32px
内边距: px-2 py-1(sm) / px-3 py-1.5(default)
```

### 按钮体系（边框定义，无填充）

```
Default:  border-border text-text-primary         → hover: border-hover bg-surface-elevated
Primary:  border-status-info text-status-info      → hover: bg-status-info/10
Danger:   border-status-error text-status-error    → hover: bg-status-error/10
Ghost:    border-transparent text-text-secondary   → hover: bg-surface-elevated
```

## 7. 布局 + 导航

### 全局布局

```
┌──────────────────────────────────────────────────┐
│  Sidebar (L1, 240px)  │  Main Content Area (L2)  │
│                        │                          │
│  [Logo/Title]          │  Tab Bar (Tabs 组件)      │
│  ─────────             │  ┌配置┬PRD┬场景┬探索┬脚本┬执行┬报告┐│
│  [项目列表]             │  │                          ││
│  ├ Project A (active)  │  │  Tab Content              ││
│  ├ Project B           │  │                          ││
│  └ Project C           │  │                          ││
│                        │  │                          ││
│  ─────────             │  │                          ││
│  [设置]                │  │                          ││
├──────────────────────────────────────────────────┤
│  Status Bar (L1, 28px) — 项目名 · AI状态 · 连接   │
└──────────────────────────────────────────────────┘
```

### 侧边栏

- 项目列表点击切换（保持 URL 同步）
- 选中态: `bg-surface-elevated border-l-2 border-l-status-info`
- 宽度 240px，`border-r border-border`

### Tab Bar

- shadcn/ui `Tabs` 组件
- 无路由：本地状态切换
- 选中态: 底部 `border-b-2 border-b-status-info`，`text-text-primary`
- 未选中: `text-text-muted`，hover → `text-text-secondary`

### 状态栏

- 当前项目名（useParams + useProject）
- AI 状态指示（`● AI 工作中` / `AI 空闲`）
- SSE 连接状态灯（绿/红）
- `bg-surface-panel border-t border-border`

### 路由

保持 HashRouter，2 条路由（`/` 和 `/project/:projectId`）。Tab 切换不进 URL。

## 8. 7 个 Tab 设计

### 工作流顺序

```
配置 → PRD分析 → 场景 → 探索 → 脚本 → 执行 → 报告
```

Tab 间无强依赖锁定，AI 操作按钮在前置步骤未完成时 disabled + tooltip。

### Tab 1：配置（ConfigPanel）

布局：左侧导航（项目列表 + 操作）+ 右侧表单区
功能：创建/删除项目、编辑配置（名称/描述/AI Provider/模型）、Provider 连接测试
新增路由：无
组件：Card, Input, Select, Button, Dialog

### Tab 2：PRD 分析（AnalysisPanel）

布局：左侧（PRD 上传 + 模块树）+ 右侧（模块详情 + 嵌套场景列表）
功能：上传/粘贴 PRD、AI 分解 L1 模块、查看/编辑模块详情
新增路由：`POST /decompose-all`（一键分解按钮）
新增 SSE：订阅 `prd.decomposition_complete` / `prd.all_complete` → 刷新模块树
组件：Card, Tree, Input, Button, Badge, InlineAIStatusCard

### Tab 3：场景（ScenarioPanel）— 新 Tab

布局：左侧（场景列表，按模块分组）+ 右侧（场景编辑器）
功能：按模块查看场景、编辑场景、AI 批量生成
新增路由：`POST /generate-all-scenarios`、`POST /modules/:id/scenarios`
新增 SSE：订阅 `prd.scenarios_all_complete` → 刷新场景列表
组件：Card, Table, Input, Button, Dialog, InlineAIStatusCard

### Tab 4：探索（ExplorationPanel）

布局：左侧（URL 列表 + 控制面板）+ 右侧（页面预览 + 绑定编辑器）
功能：URL 探索、AI 建议 + 人工确认/拒绝绑定、页面快照预览
新增路由：`PUT /urls/:urlId`（刷新快照）
修复 SSE：`exploration.progress` / `exploration.complete` → 实时状态
组件：Card, Table, Button, Badge, Input, InlineAIStatusCard

### Tab 5：脚本（ScriptPanel）

布局：左侧脚本列表 sidebar（flex-shrink: 0）+ 右侧编辑区（tab 切换：编辑器/测试数据/版本历史）
功能：查看/编辑脚本、测试数据、版本历史
新增路由：无
组件：Card, Table, CodeEditor, Button, Tabs, ScrollArea

### Tab 6：执行（ExecutionPanel）

布局：顶部控制栏 + 主区域（仪表板 + 诊断）+ 侧栏（执行历史）
功能：执行脚本、实时进度、结果统计、诊断报告
新增路由：无
修复 SSE：`execution.progress` → 进度条、`ai.diagnosis` → 自动显示诊断
组件：Card, Table, Badge, Progress, Button, InlineAIStatusCard

### Tab 7：报告（ReportPanel）— 新 Tab

布局：顶部 KPI 摘要 + 中部（失败分析 + 分布）+ 底部（AI 修复建议）
功能：执行总览、失败分析、AI 修复建议审批、回滚
新增路由：`DELETE /bindings/:id`（可选）、`POST /rollback`
新增 SSE：订阅 `ai.fix_applied` → 刷新修复状态
组件：Card, Table, Badge, Button, Dialog, InlineAIStatusCard

## 9. SSE 事件架构

### 修复矩阵

| 事件 | 类型 | 修复方案 |
|------|------|---------|
| `execution.progress` | 幻影 | 后端确认发射；前端 Progress 组件对接 |
| `ai.diagnosis` | 幻影 | 后端确认发射；前端 DiagnosisPanel 自动展开 |
| `exploration.progress` | 幻影 | 后端补发射；前端 InlineAIStatusCard 显示 |
| `exploration.complete` | 幻影 | 后端补发射；前端自动刷新 URL 列表 |
| `prd.decomposition_complete` | 孤儿 | 前端 AnalysisPanel 订阅 → 刷新模块树 |
| `prd.all_complete` | 孤儿 | 前端 AnalysisPanel 订阅 → 完成通知 |
| `prd.scenarios_all_complete` | 孤儿 | 前端 ScenarioPanel 订阅 → 刷新场景列表 |
| `ai.fix_applied` | 孤儿 | 前端 ReportPanel 订阅 → 刷新修复状态 |
| `project.status_changed` | 半孤儿 | 各 Tab 提供 onSnapshot 处理器 |

### SSE Hook 重构

```typescript
function useSSE(projectId: string, handlers: SSEHandlers): void

type SSEHandlers = {
  'execution.progress'?: (data: ProgressEvent) => void
  'exploration.complete'?: (data: ExplorationCompleteEvent) => void
  // 每个事件类型独立 handler
}
```

每个 Tab 按需订阅自己关心的事件，不再全局监听。

## 10. 文件结构

### 新增

```
ai-e2e/ui/
  tailwind.config.ts              # Atlas token 配置
  postcss.config.js               # PostCSS
  src/
    app/globals.css               # @tailwind 指令 + 极少量自定义
    components/ui/                # shadcn/ui 组件（18 个）
    components/
      inline-ai-status-card.tsx   # 新组件
    features/
      scenario/                   # 新 Tab（重写样式）
      report/                     # 新 Tab（重写样式）
```

### 删除

```
ai-e2e/ui/src/
  app/global.css                  → 替换为 globals.css
  **/*.module.css                 → 全部删除（36 个文件）
```

## 11. 迁移计划（5 Wave，自底向上）

### Wave 1：基础设施

1. 安装 Tailwind CSS 4 + PostCSS + shadcn/ui CLI
2. 创建 `tailwind.config.ts`（Atlas token）
3. 重写 `globals.css`
4. 删除所有 CSS Module 文件

### Wave 2：组件库

5. shadcn/ui `add` 18 个组件
6. 重写 InlineAIStatusCard
7. 重写 Tree 组件（Tailwind 类）
8. 重写 CodeEditor 组件（Tailwind 类）

### Wave 3：页面迁移（每个 tab 独立，可并行）

9. Layout + Sidebar + Status Bar + Tab Bar
10. Tab 1: ConfigPanel
11. Tab 2: AnalysisPanel
12. Tab 3: ScenarioPanel（新接入）
13. Tab 4: ExplorationPanel
14. Tab 5: ScriptPanel
15. Tab 6: ExecutionPanel
16. Tab 7: ReportPanel（新接入）

### Wave 4：功能补全

17. 4 条缺失路由 UI 入口对接
18. SSE 事件全面修复（8 条）
19. SSE Hook 重构（类型安全）

### Wave 5：验证

20. 全页面视觉验证（agent-browser 截图）
21. 功能验证（每个 tab 操作流程）
22. Build + LSP 零错误

## 12. 约束

- 本地 TypeScript 导入保持 `.js` 扩展名
- 不硬编码浏览器选择器
- 不提交 secrets
- Windows 批处理文件用 CRLF
- 跨包导入用 `@nebula-link-evo/shared`
- build 顺序: shared → debug-ui → playwright-server → proxy-adapter → ai-e2e
