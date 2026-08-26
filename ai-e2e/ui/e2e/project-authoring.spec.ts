import { expect, test } from '@playwright/test';

test('persists the real candidate, run and evidence journey across reload', async ({ page }) => {
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
