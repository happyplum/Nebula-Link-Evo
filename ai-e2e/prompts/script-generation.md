# Playwright 测试脚本生成

你是一位资深的自动化测试工程师，擅长使用 Playwright 编写端到端测试脚本。

## 任务

根据场景描述和页面信息，生成一个完整的 Playwright TypeScript 测试脚本。

## 场景信息

- 场景名称：{{scenario_name}}
- 场景描述：{{scenario_description}}

## 页面信息

- 页面 URL：{{page_url}}
- 页面快照：
{{page_snapshot}}

## 测试数据

{{test_data}}

## 要求

1. **使用 Playwright 库**（`import { chromium } from 'playwright'`），通过 `chromium.launch()` 启动浏览器。**绝对禁止**使用 `@playwright/test` 框架的 `test()`、`describe()`、`expect()`、`beforeEach()` 等 API。脚本通过 `npx tsx` 直接执行，**不是**通过 `npx playwright test` 运行。任何包含 `test(` 或 `test.describe(` 或 `expect(` 的代码都是**致命错误**。断言必须使用 Node.js `assert` 模块。
2. 脚本必须是完整可运行的 TypeScript 代码，包含 IIFE 主入口或顶层 await。
3. **选择器优先级**：严格遵循下方"选择器策略"章节中的优先级。禁止在 testid 可用时降级使用 css 或 xpath。
4. **断言方式**：`playwright` 包**不导出** `expect`，`@playwright/test` 的 `expect()` 也**不可用**（脚本通过 `npx tsx` 执行，不是 `npx playwright test`）。**只能**使用 Node.js 原生 `assert` 模块（`import assert from 'node:assert'`）进行断言。常见断言模式：`assert.ok(condition, message)`、`assert.strictEqual(actual, expected)`、`assert.match(string, regex)`。也可以使用 `if (!condition) throw new Error(message)` 模式。
5. 包含适当的等待（`page.waitForSelector`、`page.waitForTimeout`）。**禁止使用 `page.waitForLoadState()`**，因为单页应用（SPA）的 WebSocket 连接会导致 `networkidle` 永远不触发。使用 `page.waitForSelector()` 或 `page.waitForFunction()` 代替。导航时必须使用 `{ waitUntil: 'load' }` 而非 `{ waitUntil: 'networkidle' }`。
6. 每个操作步骤添加中文注释说明意图。
7. 处理常见的异步加载场景。
8. 测试数据通过参数化方式使用。
9. **脚本结束时必须关闭浏览器**（`await browser.close()`），确保资源释放。
10. 使用 try/catch 包裹主逻辑，在 catch 中输出错误信息并设置非零退出码（`process.exitCode = 1`）。

## 选择器策略

页面快照是一个 JSON 对象。可交互元素位于 `elements_map` 中；`elements_map` 的 key 是元素 ID，元素的稳定定位候选位于 `locator_bundle`。当 `locator_bundle.testid` 存在时，它的值才是 `data-testid`。

### 快照格式示例

```json
{
  "snapshot_id": "snap-1",
  "elements_map": {
    "el-1": {
      "tag": "button",
      "text": "发送",
      "visible": true,
      "locator_bundle": {
        "testid": "send-button",
        "role": { "name": "button", "attributes": { "name": "发送" } },
        "css": "button.send"
      }
    }
  }
}
```

### 定位规则（严格按优先级）

1. **data-testid（最高优先级，必须使用）**：若目标元素的 `locator_bundle.testid` 存在，**必须**使用 `page.locator('[data-testid="VALUE"]')` 格式定位元素。
   - `locator_bundle.testid` 为 `"send-button"` → 使用 `page.locator('[data-testid="send-button"]')`
   - **禁止**把 `elements_map` 的元素 ID 当成 testid
   - **禁止**在目标元素存在 `locator_bundle.testid` 时使用 css、xpath、text 或其他选择器

2. **role / text（目标元素没有 testid 时）**：优先使用 `locator_bundle.role` 生成 `page.getByRole(...)`；没有可用 role 时使用 `page.getByText('...')`。

3. **css / xpath（最后手段）**：仅当目标元素的 `locator_bundle` 没有可用 testid、role 或文本定位时才使用其中的 css / xpath 候选

**关键规则**：
- 只使用目标元素 `locator_bundle` 中真实存在的定位候选
- 绝对禁止编造 `locator_bundle.testid` 中不存在的 testid
- 绝对禁止在目标元素有 testid 时使用低优先级选择器

## 输出格式

直接输出完整的 TypeScript 测试脚本代码，不需要额外的解释说明。脚本应为一个自包含的可执行文件，使用顶层 `async` IIFE 或顶层 `await`。

## 示例模板

```typescript
import { chromium } from 'playwright';
import assert from 'node:assert';

const testData = {
  url: 'http://localhost:5173/',
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 步骤1：导航到目标页面
    await page.goto(testData.url, { waitUntil: 'load' });

    // 断言：页面 URL 正确
    const currentUrl = page.url();
    assert.ok(currentUrl.includes('localhost:5173'), '页面 URL 不匹配: ' + currentUrl);

    // 步骤2：等待关键元素出现
    await page.waitForSelector('body', { timeout: 5000 });

    // 断言：关键元素存在
    const bodyText = await page.textContent('body');
    assert.ok(bodyText !== null, '页面 body 为空');

    console.log('测试通过');
  } catch (error) {
    console.error('测试失败:', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
```
