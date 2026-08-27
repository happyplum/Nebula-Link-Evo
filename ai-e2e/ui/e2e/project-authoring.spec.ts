import { expect, test } from '@playwright/test';

test('persists the real candidate, run and evidence journey across reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let bootstrapRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/authoring-jobs$/u.test(new URL(request.url()).pathname)) {
      bootstrapRequests += 1;
    }
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

  await page.reload();
  await expect(page.getByText('运行状态：completed')).toBeVisible();
  await page.getByRole('tab', { name: '证据' }).click();
  await expect(page.getByText(/\d+ 条证据/u)).toBeVisible();
  await expect(page.getByText('当前运行尚未落库证据')).toHaveCount(0);
});
