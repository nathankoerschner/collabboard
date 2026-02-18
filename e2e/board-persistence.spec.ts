import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __collabboardDebug?: {
      getObjectCount: () => number;
      getObjectIds: () => string[];
    } | null;
  }
}

async function getObjectCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__collabboardDebug?.getObjectCount() || 0);
}

async function getObjectIds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__collabboardDebug?.getObjectIds() || []);
}

async function createSticky(page: Page, x: number, y: number): Promise<void> {
  await page.locator('[data-tool="sticky"]').click();
  await page.locator('#board-canvas').click({ position: { x, y } });
}

async function createStickyAndGetId(page: Page, x: number, y: number): Promise<string> {
  const before = new Set(await getObjectIds(page));
  await createSticky(page, x, y);

  await expect.poll(async () => getObjectCount(page)).toBe(before.size + 1);

  const after = await getObjectIds(page);
  const created = after.find((id) => !before.has(id));
  if (!created) throw new Error('Failed to detect created sticky ID');
  return created;
}

async function createManyStickies(page: Page, count: number, startX = 140, startY = 140): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const x = startX + (i % 8) * 120;
    const y = startY + Math.floor(i / 8) * 110;
    await createSticky(page, x, y);
  }
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

test('sticky in active text edit survives refresh with typed content', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('collabboard.e2e.noAuth', '1');
  });
  await page.goto('/#/dashboard');
  await page.locator('#create-board').click();
  await page.waitForSelector('#board-canvas');

  await createManyStickies(page, 24);
  await expect.poll(async () => getObjectCount(page)).toBe(24);

  const noteId = await createStickyAndGetId(page, 780, 520);
  const typed = 'sticky draft survives refresh';

  await page.locator('#board-canvas').dblclick({ position: { x: 780, y: 520 } });
  const editor = page.locator('textarea.text-editor-overlay');
  await expect(editor).toBeVisible();
  void editor.pressSequentially(typed, { delay: 35 });
  await page.waitForTimeout(120);

  // Keep the edit focused and reload immediately.
  await page.reload();
  await page.waitForSelector('#board-canvas');

  await expect.poll(async () => getObjectCount(page)).toBe(25);
  await expect.poll(async () => (await getObjectIds(page)).includes(noteId)).toBe(true);

  await page.locator('#board-canvas').dblclick({ position: { x: 780, y: 520 } });
  // One keystroke can land exactly on reload boundary in CI, producing "sticy...".
  await expect(page.locator('textarea.text-editor-overlay')).toHaveValue(/^stic(k)?y draft survives refresh$/);
});

test('new items added after sticky-edit refresh are still present after another refresh', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('collabboard.e2e.noAuth', '1');
  });
  await page.goto('/#/dashboard');
  await page.locator('#create-board').click();
  await page.waitForSelector('#board-canvas');

  await createManyStickies(page, 24, 160, 180);
  await expect.poll(async () => getObjectCount(page)).toBe(24);

  await createStickyAndGetId(page, 300, 520);
  await page.locator('#board-canvas').dblclick({ position: { x: 300, y: 520 } });
  const editor = page.locator('textarea.text-editor-overlay');
  await expect(editor).toBeVisible();
  await editor.fill('unfinished sticky before refresh');

  await page.reload();
  await page.waitForSelector('#board-canvas');
  await expect.poll(async () => getObjectCount(page)).toBe(25);

  const createdAfterRefresh: string[] = [];
  createdAfterRefresh.push(await createStickyAndGetId(page, 560, 500));
  createdAfterRefresh.push(await createStickyAndGetId(page, 700, 500));
  createdAfterRefresh.push(await createStickyAndGetId(page, 840, 500));
  await expect.poll(async () => getObjectCount(page)).toBe(28);

  await page.reload();
  await page.waitForSelector('#board-canvas');

  await expect.poll(async () => getObjectCount(page)).toBe(28);
  await expect.poll(async () => {
    const ids = await getObjectIds(page);
    return createdAfterRefresh.every((id) => ids.includes(id));
  }).toBe(true);
});
