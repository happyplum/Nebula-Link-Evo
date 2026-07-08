# Task 5: 全量构建 + 测试验证

## 执行命令

```bash
pnpm build
pnpm test
```

## 构建结果

`pnpm build` 全量通过：

- `shared` ✅
- `debug-ui` ✅
- `proxy-adapter` ✅
- `ai-chat-service` ✅
- `ai-e2e` / `ai-e2e/ui` ✅

## 测试结果

### 相关包（迁移影响范围）

- `pnpm --filter proxy-adapter test`：397/397 passed ✅
- `pnpm --filter ai-chat-service test`：74/74 passed ✅

### 零 AI 验证

- `grep -r "generateText" proxy-adapter/src/ --include="*.ts" | grep -v __tests__` → 零结果 ✅
- `grep -r "VisionAgent\|vision-agent" proxy-adapter/src/ --include="*.ts" | grep -v __tests__` → 零结果 ✅

### 根目录 `pnpm test` 全量结果

根目录 `pnpm test` 存在与本次迁移无关的既有失败，阻塞全量通过：

1. **debug-ui** — 3 个测试文件失败（共 9 个测试）：
   - `src/features/liveview/components/LiveViewCanvas.test.tsx` (1 failed)
   - `src/features/liveview/__tests__/picker-liveview-integration.parity.test.tsx` (5 failed)
   - `src/features/liveview/__tests__/LiveKitView.test.tsx` (3 failed)
   - 根因：测试 mock 未同步 `runtime/store/index.js` 新增的 `selectPlaywrightStatusHydrated` 导出。错误为 `[vitest] No "selectPlaywrightStatusHydrated" export is defined on the mock`。
   - 该问题与本次 vision-agent 迁移无关；debug-ui 未在本次任务中改动。

2. **ai-e2e** — 2 个测试文件失败（共 4 个测试）：
   - `src/services/__tests__/script-generator-service.test.ts`：断言提示模板文件应包含 `locator_bundle`，但当前模板已改用 `data-testid` 策略。该断言与迁移无关。
   - `src/server/routes/__tests__/exploration.test.ts`：3 个 binding 相关测试返回 500（确认/拒绝 binding、手动创建 binding）。单独运行同样失败，属于既有路由/测试环境问题。

### 结论

本次迁移涉及的两个核心包 `proxy-adapter` 和 `ai-chat-service` 的构建与测试均已通过，零 AI 调用验证通过。根目录全量测试失败为既有问题，不在本次迁移范围内。

（2026-07-08）
