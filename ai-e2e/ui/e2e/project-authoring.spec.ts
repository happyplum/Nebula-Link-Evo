import { expect, test } from '@playwright/test';

test('creates a semantic project and starts bootstrap exactly once across reload', async ({
  page,
}) => {
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

  await page.reload();
  await expect(page.getByRole('heading', { name: '资产编排工作台' })).toBeVisible();
  await expect(page.getByText(/编排任务：/u)).toBeVisible();
  await page.waitForTimeout(500);
  expect(bootstrapRequests).toBe(1);
});
