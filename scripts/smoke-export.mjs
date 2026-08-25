/**
 * Smoke-test the production web UI with Spineboy assets.
 * Verifies: JSON import, asset load, skeleton ready, first-frame export ZIP.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'test-fixtures', 'spineboy');
const outDir = path.join(root, 'release', 'smoke-output');
const baseURL = process.env.SMOKE_URL || 'http://127.0.0.1:5199';

function resolveChromium() {
  const require = createRequire(import.meta.url);
  try {
    const pw = require('playwright');
    return pw.chromium.executablePath();
  } catch {
    // playwright-core only — use env or common cache path
  }
  const env = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (env && fs.existsSync(env)) return env;
  const home = process.env.HOME || '';
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(home, 'Library/Caches/ms-playwright'),
    '/var/folders/qh/9j4qxj2j3v5d23mp53bm6d480000gn/T/cursor-sandbox-cache/1484965f4b51bb8aabb71e090fc4e4ef/playwright',
  ].filter(Boolean);

  for (const dir of cacheRoots) {
    if (!dir || !fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir);
    const preferred = [
      ...entries.filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse(),
      ...entries.filter((d) => d.startsWith('chromium-')).sort().reverse(),
    ];
    for (const d of preferred) {
      const base = path.join(dir, d);
      const candidates = [
        path.join(base, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
        path.join(base, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      ];
      for (const exe of candidates) {
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  throw new Error('Chromium for Playwright not found. Run: npx playwright install chromium');
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(fixtures, 'spineboy-pro.json');
  const atlasPath = path.join(fixtures, 'spineboy.atlas');
  const pngPath = path.join(fixtures, 'spineboy.png');
  for (const p of [jsonPath, atlasPath, pngPath]) {
    if (!fs.existsSync(p)) throw new Error(`Missing fixture: ${p}`);
  }

  const executablePath = resolveChromium();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });

  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Animation frame export');

  // Step 1: JSON
  const jsonInput = page.locator('section.panel').filter({ hasText: 'Spine JSON files' }).locator('input[type=file]').first();
  await jsonInput.setInputFiles(jsonPath);
  await page.waitForSelector('text=spineboy-pro', { timeout: 15000 });

  // Step 2: assets (atlas + png)
  const assetInput = page.locator('section.panel').filter({ hasText: 'Asset location' }).locator('input[type=file]').nth(1);
  await assetInput.setInputFiles([atlasPath, pngPath]);
  await page.waitForSelector('text=atlases', { timeout: 15000 });
  await page.waitForFunction(() => {
    const pills = [...document.querySelectorAll('.stat-pill')].map((el) => el.textContent || '');
    return pills.some((t) => /\b1\b/.test(t) && /atlas/i.test(t));
  });

  // Prefer first-frame-only for speed
  const firstFrame = page.getByText('First frame only', { exact: false });
  if (await firstFrame.count()) {
    // toggle if present as checkbox/label
    const toggle = page.locator('label').filter({ hasText: /First frame/i }).locator('input');
    if (await toggle.count()) {
      if (!(await toggle.isChecked())) await toggle.check();
    }
  }

  // Wait until Export is enabled
  const exportBtn = page.getByRole('button', { name: /Export ZIP/i });
  await exportBtn.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Export ZIP/i.test(b.textContent || ''));
    return btn && !btn.disabled;
  }, null, { timeout: 30000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await exportBtn.click();
  const download = await downloadPromise;
  const zipPath = path.join(outDir, await download.suggestedFilename());
  await download.saveAs(zipPath);

  const stat = fs.statSync(zipPath);
  if (stat.size < 1000) throw new Error(`ZIP too small: ${stat.size} bytes`);

  // Basic ZIP magic
  const fd = fs.openSync(zipPath, 'r');
  const magic = Buffer.alloc(2);
  fs.readSync(fd, magic, 0, 2, 0);
  fs.closeSync(fd);
  if (magic.toString() !== 'PK') throw new Error('Not a ZIP file');

  console.log(
    JSON.stringify(
      {
        ok: true,
        zipPath,
        zipBytes: stat.size,
        pageErrors: errors.slice(0, 10),
      },
      null,
      2,
    ),
  );

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
