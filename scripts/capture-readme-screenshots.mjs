/**
 * Capture polished README screenshots (v1 + v2) with Spineboy loaded.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'test-fixtures', 'spineboy');
const outDir = path.join(root, 'docs', 'screenshots');
const baseURL = process.env.SMOKE_URL || 'http://localhost:5199';

function resolveChromium() {
  const require = createRequire(import.meta.url);
  try {
    const pw = require('playwright');
    const p = pw.chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    // ignore
  }
  const home = process.env.HOME || '';
  const cache = path.join(home, 'Library/Caches/ms-playwright');
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).sort().reverse()) {
      for (const exe of [
        path.join(cache, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
        path.join(
          cache,
          d,
          'chrome-mac-arm64',
          'Google Chrome for Testing.app',
          'Contents/MacOS/Google Chrome for Testing',
        ),
      ]) {
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

async function loadSpineboy(page) {
  const jsonInput = page
    .locator('section.panel')
    .filter({ hasText: 'Spine JSON files' })
    .locator('input[type=file]')
    .first();
  await jsonInput.setInputFiles(path.join(fixtures, 'spineboy-pro.json'));
  await page.waitForFunction(() => {
    const body = document.body?.innerText || '';
    if (/spineboy-pro/i.test(body)) return true;
    return [...document.querySelectorAll('option')].some((o) =>
      /spineboy-pro/i.test(o.textContent || ''),
    );
  });

  const assetInput = page
    .locator('section.panel')
    .filter({ hasText: 'Asset location' })
    .locator('input[type=file]')
    .nth(1);
  await assetInput.setInputFiles([
    path.join(fixtures, 'spineboy.atlas'),
    path.join(fixtures, 'spineboy.png'),
  ]);
  await page.waitForFunction(() => {
    const pills = [...document.querySelectorAll('.stat-pill')].map((el) => el.textContent || '');
    return pills.some((t) => /atlas/i.test(t) && !/^0\s*atlas/i.test(t.trim()));
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Hide version switch briefly? keep it — it's part of the product.

  // ——— v1 empty landing ———
  await page.goto(`${baseURL}#v1`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /v1 Classic/i }).click();
  await page.waitForSelector('text=Animation frame export');
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(outDir, '01-v1-overview.png'),
    fullPage: false,
  });
  console.log('wrote 01-v1-overview.png');

  // ——— v1 with spineboy: preview + settings ———
  await loadSpineboy(page);
  await page.waitForSelector('.anim-preview.status-ready canvas', { timeout: 25000 });
  await page.locator('.job-card select').first().selectOption('walk');
  await page.waitForTimeout(800);
  await page.locator('.job-card').first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(outDir, '02-v1-preview-skeleton.png'),
    fullPage: false,
  });
  console.log('wrote 02-v1-preview-skeleton.png');

  // Focus export settings panel
  await page.locator('section.panel').filter({ hasText: 'Export settings' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(outDir, '03-v1-export-settings.png'),
    fullPage: false,
  });
  console.log('wrote 03-v1-export-settings.png');

  // Full page v1 workflow
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(outDir, '04-v1-full-workflow.png'),
    fullPage: true,
  });
  console.log('wrote 04-v1-full-workflow.png');

  // ——— v2 tracks ———
  await page.getByRole('button', { name: /v2 Tracks/i }).click();
  await page.waitForSelector('text=Multi-track mix', { timeout: 10000 });
  await loadSpineboy(page);
  await page.waitForSelector('.v2-track-row select', { timeout: 15000 });
  await page.waitForSelector('.v2-preview.status-ready canvas, .v2-preview canvas', {
    timeout: 25000,
  });
  const selects = page.locator('.v2-track-row select');
  const count = await selects.count();
  await selects.nth(0).selectOption('walk');
  if (count < 2) await page.getByRole('button', { name: /Add track/i }).click();
  await page.locator('.v2-track-row select').nth(1).selectOption('aim');
  await page.waitForTimeout(1000);

  await page.locator('.v2-workbench').scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({
    path: path.join(outDir, '05-v2-track-mixer.png'),
    fullPage: false,
  });
  console.log('wrote 05-v2-track-mixer.png');

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(outDir, '06-v2-full-workflow.png'),
    fullPage: true,
  });
  console.log('wrote 06-v2-full-workflow.png');

  await browser.close();
  console.log('Screenshots in', outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
