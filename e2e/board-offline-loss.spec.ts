import { expect, test, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { spawn, type ChildProcess } from 'node:child_process';

declare global {
  interface Window {
    __collabboardDebug?: {
      getObjectCount: () => number;
      getObjectIds: () => string[];
    } | null;
  }
}

function killServer3001(): void {
  try {
    execSync("lsof -nP -iTCP:3001 -sTCP:LISTEN | awk 'NR>1{print $2}' | xargs -r kill -9", { stdio: 'ignore' });
  } catch {
    // ignore
  }
}

function startServer(): ChildProcess {
  return spawn('npm', ['run', 'dev', '-w', 'server'], {
    env: { ...process.env, VITE_CLERK_PUBLISHABLE_KEY: '', CLERK_PUBLISHABLE_KEY: '', CLERK_SECRET_KEY: '' },
    stdio: 'ignore',
  });
}

async function waitFor(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function createSticky(page: Page, x: number, y: number): Promise<void> {
  await page.locator('[data-tool="sticky"]').click();
  await page.locator('#board-canvas').click({ position: { x, y } });
}

test('edits made while disconnected survive after refresh', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('collabboard.e2e.noAuth', '1'));

  await page.goto('/#/dashboard');
  await page.locator('#create-board').click();
  await page.waitForSelector('#board-canvas');

  await createSticky(page, 180, 180);
  await expect.poll(async () => page.evaluate(() => window.__collabboardDebug?.getObjectCount() || 0)).toBe(1);

  killServer3001();

  // Local-only edits while disconnected.
  await createSticky(page, 420, 230);
  await createSticky(page, 680, 280);
  await expect.poll(async () => page.evaluate(() => window.__collabboardDebug?.getObjectCount() || 0)).toBe(3);

  const restarted = startServer();
  try {
    await waitFor('http://127.0.0.1:3001/api/health');

    await page.reload();
    await page.waitForSelector('#board-canvas');

    // Desired durability contract: all 3 should survive.
    await expect.poll(async () => page.evaluate(() => window.__collabboardDebug?.getObjectCount() || 0), { timeout: 15_000 }).toBe(3);
  } finally {
    restarted.kill('SIGKILL');
  }
});
