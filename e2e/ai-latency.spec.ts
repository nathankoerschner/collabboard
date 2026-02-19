import { expect, test } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

declare global {
  interface Window {
    __collabboardDebug?: {
      getObjectCount: () => number;
    } | null;
  }
}

test('AI sticky render latency should be under 2 seconds', async ({ page }) => {
  test.skip(!process.env.OPENAI_API_KEY, 'OPENAI_API_KEY is required for real AI latency measurement');

  await page.addInitScript(() => {
    window.localStorage.setItem('collabboard.e2e.noAuth', '1');
  });

  await page.goto('/#/dashboard');
  await page.locator('#create-board').click();
  await page.waitForSelector('#board-canvas');

  const initialCount = await page.evaluate(() => window.__collabboardDebug?.getObjectCount() || 0);

  await page.locator('#ai-chat-toggle').click();
  await page.locator('#ai-command-input').fill('create a sticky note');

  const start = Date.now();
  await page.locator('#ai-command-submit').click();

  await page.waitForFunction(
    (expectedCount) => (window.__collabboardDebug?.getObjectCount() || 0) >= expectedCount,
    initialCount + 1,
    { timeout: 15_000, polling: 25 }
  );

  const elapsedMs = Date.now() - start;
  expect(elapsedMs).toBeLessThan(2000);
});
