import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __collabboardDebug?: {
      getObjectCount: () => number;
      getObjectIds: () => string[];
    } | null;
  }
}

async function createSticky(page: Page, x: number, y: number): Promise<void> {
  await page.locator('[data-tool="sticky"]').click();
  await page.locator('#board-canvas').click({ position: { x, y } });
}

test('board keeps all items after refresh', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('collabboard.e2e.noAuth', '1');
  });
  await page.goto('/#/dashboard');
  await page.locator('#create-board').click();
  await page.waitForSelector('#board-canvas');

  await createSticky(page, 180, 180);
  await createSticky(page, 420, 230);
  await createSticky(page, 680, 280);

  await expect.poll(async () => {
    return page.evaluate(() => window.__collabboardDebug?.getObjectCount() || 0);
  }).toBe(3);

  await page.reload();
  await page.waitForSelector('#board-canvas');

  await expect.poll(async () => {
    return page.evaluate(() => window.__collabboardDebug?.getObjectCount() || 0);
  }).toBe(3);

  await createSticky(page, 220, 420);
  await createSticky(page, 520, 460);

  await expect.poll(async () => {
    return page.evaluate(() => window.__collabboardDebug?.getObjectCount() || 0);
  }).toBe(5);

  await page.reload();
  await page.waitForSelector('#board-canvas');

  await expect.poll(async () => {
    return page.evaluate(() => window.__collabboardDebug?.getObjectCount() || 0);
  }).toBe(5);
});
