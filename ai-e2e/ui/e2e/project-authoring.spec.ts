import { expect, test } from '@playwright/test';
import { join } from 'node:path';

test('persists the real candidate, run and evidence journey across reload', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let bootstrapRequests = 0;
  let activityRequests = 0;
  let failNextActivity = true;
  let runCommands = 0;
  await page.route('**/api/v1/authoring-jobs/*/activity', async (route) => {
    activityRequests += 1;
    if (failNextActivity) {
      failNextActivity = false;
      await route.abort();
    } else await route.continue();
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/authoring-jobs$/u.test(new URL(request.url()).pathname)) {
      bootstrapRequests += 1;
    }
    if (
      request.method() === 'POST' &&
      /\/runs\/[^/]+\/commands$/u.test(new URL(request.url()).pathname)
    )
      runCommands += 1;
  });

  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: '从 PRD 到可见浏览器执行，一条链完成编排与验收' })
  ).toBeVisible();
  await page.getByRole('button', { name: '创建项目并开始编排' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('创建 Semantic E2E 项目');
  await dialog.getByLabel('项目名称').fill('Playwright 订单中心');
  await dialog.getByLabel('目标站点').fill('https://example.test');
  await dialog.getByLabel('PRD / 验收需求').fill('用户可以创建订单，并在成功后看到订单编号。');
  await dialog.getByRole('button', { name: '创建并开始编排' }).click();

  await expect(page).toHaveURL(/\/semantic\/[^/]+\/authoring\/[^?]+\?bootstrap=1/u);
  await expect(page.getByRole('heading', { name: '资产编排工作台' })).toBeVisible();
  await expect(page.getByText(/编排任务：/u)).toBeVisible();
  await expect.poll(() => bootstrapRequests).toBe(1);
  const connectionStatus = page.getByRole('status', { name: '活动连接状态' });
  const reconnect = page.getByRole('button', { name: '立即重连' });
  await expect(connectionStatus).toHaveText('活动已连接');
  expect(activityRequests).toBeGreaterThanOrEqual(2);
  const liveImage = page.getByRole('img', { name: '当前受控浏览器实时画面' });
  const retryImage = page.getByRole('button', { name: '重试实时画面' });
  await expect(liveImage.or(retryImage).first()).toBeVisible();
  if (await liveImage.count()) await liveImage.dispatchEvent('error');
  await expect(retryImage).toBeVisible();
  expect(
    await page.evaluate(
      "getComputedStyle(document.querySelector('.semantic-browser-canvas')).transform"
    )
  ).toBe('none');
  const retryBox = await retryImage.boundingBox();
  expect(retryBox?.height).toBeGreaterThanOrEqual(44);
  expect(retryBox?.width).toBeGreaterThanOrEqual(44);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });

  const workbench = page.locator('.semantic-root');
  const theme = page.getByRole('button', { name: '主题：system' });
  await theme.click();
  await expect(workbench).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: '主题：dark' }).click();
  await expect(workbench).toHaveAttribute('data-theme', 'light');

  const visibleTargetSelector = ['button', 'a[href]', 'input', 'textarea', '[role="tab"]']
    .map((selector) => `${selector}:visible`)
    .join(', ');
  const undersizedTargets = await page.locator(visibleTargetSelector).evaluateAll((elements) =>
    elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name:
            element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter(({ width, height }) => width < 44 || height < 44)
  );
  expect(undersizedTargets).toEqual([]);
  await expect(page.locator('input:not([name]), textarea:not([name])')).toHaveCount(0);
  await page.getByRole('link', { name: '返回业务版本列表' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.semantic-skip')).toBeFocused();
  expect(
    await page.evaluate(
      "Number.parseFloat(getComputedStyle(document.querySelector('.semantic-skip')).outlineWidth)"
    )
  ).toBeGreaterThanOrEqual(2);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const browserRegion = await page.getByRole('region', { name: '只读浏览器画面' }).boundingBox();
  expect(browserRegion?.width).toBeGreaterThanOrEqual(760);
  await page.getByRole('button', { name: '主题：light' }).click();
  await page.getByRole('button', { name: '主题：system' }).click();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    if (process.env.AGENT_STREAM_VISUAL_DIR)
      await page.screenshot({
        path: join(process.env.AGENT_STREAM_VISUAL_DIR, `e2e-dark-${viewport.width}-live.png`),
      });
  }
  await page.getByRole('button', { name: '主题：dark' }).click();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    if (process.env.AGENT_STREAM_VISUAL_DIR)
      await page.screenshot({
        path: join(process.env.AGENT_STREAM_VISUAL_DIR, `e2e-light-${viewport.width}-live.png`),
      });
  }

  await page.getByRole('tab', { name: /Diff/u }).click();
  const applyCandidate = page.getByRole('button', { name: /在安全边界应用/u });
  const approveDecision = page.getByRole('button', { name: '批准', exact: true });
  await expect(approveDecision.first()).toBeVisible({ timeout: 20_000 });
  for (let index = 0; index < 5; index += 1) {
    const count = await approveDecision.count();
    if (count === 0) break;
    await approveDecision.first().click();
    await expect.poll(() => approveDecision.count()).toBeLessThan(count);
  }
  await expect(applyCandidate).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByText('candidate_ready')).toBeVisible();
  await applyCandidate.click();
  await expect
    .poll(
      async () => {
        const state = (await page.getByText(/编排任务：/u).textContent()) ?? '';
        if (state.includes('failed')) {
          const hashQuery = new URL(page.url()).hash.split('?', 2)[1] ?? '';
          const jobId = new URLSearchParams(hashQuery).get('job');
          const diagnostic = jobId
            ? await page.evaluate(async (id) => {
                const response = await fetch(`/api/v1/authoring-jobs/${encodeURIComponent(id)}`);
                return response.json();
              }, jobId)
            : null;
          throw new Error(`Authoring verification failed: ${JSON.stringify(diagnostic)}`);
        }
        return state;
      },
      { timeout: 20_000 }
    )
    .toContain('completed');
  await expect(page.getByText('activated', { exact: true })).toBeVisible();

  const activityText = '候选已验证并原子激活';
  await expect(page.locator('.semantic-chat .nebula-agent-stream')).toContainText(activityText);
  expect(activityText.length).toBeGreaterThan(0);
  const requestsBeforeFailure = activityRequests;
  failNextActivity = true;
  await reconnect.focus();
  expect(
    await page.evaluate('Number.parseFloat(getComputedStyle(document.activeElement).outlineWidth)')
  ).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Enter');
  await expect(connectionStatus).toHaveText('正在恢复活动');
  await expect(page.locator('.semantic-chat .nebula-agent-stream')).toContainText(activityText);
  if (process.env.AGENT_STREAM_VISUAL_DIR)
    await page.screenshot({
      path: join(process.env.AGENT_STREAM_VISUAL_DIR, 'e2e-light-1920-reconnecting.png'),
    });
  await expect(connectionStatus).toHaveText('活动已连接');
  expect(activityRequests).toBeGreaterThanOrEqual(requestsBeforeFailure + 2);
  const requestsBeforeManual = activityRequests;
  await reconnect.press('Enter');
  await expect.poll(() => activityRequests).toBe(requestsBeforeManual + 1);
  await expect(connectionStatus).toHaveText('活动已连接');

  await page.reload();
  await expect(page.getByRole('heading', { name: '资产编排工作台' })).toBeVisible();
  await expect(page.getByText(/编排任务：/u)).toBeVisible();
  await page.waitForTimeout(500);
  expect(bootstrapRequests).toBe(1);

  const runScenario = page.getByRole('button', { name: '运行场景' });
  await expect(runScenario).toBeEnabled({ timeout: 20_000 });
  await runScenario.click();
  await expect(page).toHaveURL(/\/semantic\/[^/]+\/runs\/[^/?]+/u);
  await page.getByRole('button', { name: '开始运行' }).click();
  await expect(page.getByText('运行状态：completed')).toBeVisible({ timeout: 20_000 });
  await expect(connectionStatus).toHaveText('活动已连接');
  let runActivityRequests = 0;
  let failNextRunActivity = true;
  await page.route('**/api/v1/runs/*/activity', async (route) => {
    runActivityRequests += 1;
    if (failNextRunActivity) {
      failNextRunActivity = false;
      await route.abort();
    } else await route.continue();
  });
  const runActivity = page.locator('.semantic-chat .nebula-agent-stream');
  const runText = '任务已完成';
  await expect(runActivity).toContainText(runText);
  const commandsBeforeReconnect = runCommands;
  await reconnect.press('Enter');
  await expect(connectionStatus).toHaveText('正在恢复活动');
  await expect(runActivity).toContainText(runText);
  await expect(connectionStatus).toHaveText('活动已连接');
  expect(runActivityRequests).toBe(2);
  expect(runCommands).toBe(commandsBeforeReconnect);
  await expect(page.getByRole('textbox', { name: '向编排 Agent 发送修改要求' })).toHaveCount(0);
  await expect(page.getByText('运行状态：completed')).toBeVisible();

  await page.reload();
  await expect(page.getByText('运行状态：completed')).toBeVisible();
  await page.getByRole('tab', { name: '证据' }).click();
  await expect(page.getByText(/\d+ 条证据/u)).toBeVisible();
  await expect(page.getByText('当前运行尚未落库证据')).toHaveCount(0);
});
