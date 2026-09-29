/**
 * Export a multi-frame animation and assert PNGs are not all identical.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'test-fixtures', 'spineboy');
const outDir = path.join(root, 'release', 'anim-frame-test');
const baseURL = process.env.SMOKE_URL || 'http://127.0.0.1:5199';

function resolveChromium() {
  const require = createRequire(import.meta.url);
  try {
    const pw = require('playwright');
    const p = pw.chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    // playwright-core only
  }
  const env = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (env && fs.existsSync(env)) return env;
  const home = process.env.HOME || '';
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(home, 'Library/Caches/ms-playwright'),
  ].filter(Boolean);
  for (const dir of cacheRoots) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir).sort().reverse()) {
      const candidates = [
        path.join(dir, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
        path.join(
          dir,
          d,
          'chrome-mac-arm64',
          'Google Chrome for Testing.app',
          'Contents',
          'MacOS',
          'Google Chrome for Testing',
        ),
      ];
      for (const exe of candidates) {
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(systemChrome)) return systemChrome;
  throw new Error('Chromium for Playwright not found. Run: npx playwright install chromium');
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
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
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Animation frame export');

  const jsonInput = page
    .locator('section.panel')
    .filter({ hasText: 'Spine JSON files' })
    .locator('input[type=file]')
    .first();
  await jsonInput.setInputFiles(jsonPath);
  await page.waitForSelector('text=spineboy-pro', { timeout: 15000 });

  const assetInput = page
    .locator('section.panel')
    .filter({ hasText: 'Asset location' })
    .locator('input[type=file]')
    .nth(1);
  await assetInput.setInputFiles([atlasPath, pngPath]);
  await page.waitForFunction(() => {
    const pills = [...document.querySelectorAll('.stat-pill')].map((el) => el.textContent || '');
    return pills.some((t) => /atlas/i.test(t));
  });

  // Ensure full animation export (not first-frame-only)
  const firstFrameToggle = page.locator('label').filter({ hasText: /First frame/i }).locator('input');
  if (await firstFrameToggle.count()) {
    if (await firstFrameToggle.isChecked()) await firstFrameToggle.click();
  }

  // Pick "walk" if available (clear motion across frames)
  const animSelect = page.locator('.job-card select').first();
  await page.waitForTimeout(400);
  const options = await animSelect.locator('option').allTextContents();
  const prefer = ['walk', 'run', 'idle', 'jump'].find((n) => options.includes(n));
  if (prefer) {
    await animSelect.selectOption(prefer);
  }
  console.log('animation options:', options.join(', '));
  console.log('selected:', prefer || options[0]);

  // Lower FPS a bit so export is faster but still multi-frame
  const fpsInput = page.locator('label').filter({ hasText: /^FPS/i }).locator('input');
  if (await fpsInput.count()) {
    await fpsInput.fill('12');
  }

  await page.waitForTimeout(600);

  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: /Export ZIP/i }).click();
  const download = await downloadPromise;
  const zipPath = path.join(outDir, 'export.zip');
  await download.saveAs(zipPath);

  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const pngs = Object.keys(zip.files)
    .filter((n) => n.toLowerCase().endsWith('.png') && !zip.files[n].dir)
    .sort();
  console.log('exported png count:', pngs.length);
  if (pngs.length < 3) {
    throw new Error(`Expected >= 3 frames, got ${pngs.length}`);
  }

  const hashes = [];
  for (const name of pngs) {
    const buf = await zip.files[name].async('nodebuffer');
    hashes.push({ name, hash: sha1(buf), size: buf.length });
  }
  const unique = new Set(hashes.map((h) => h.hash));
  console.log(
    'sample frames:',
    hashes.slice(0, 5).map((h) => `${path.basename(h.name)}=${h.hash.slice(0, 8)}`),
  );
  console.log(`unique frame hashes: ${unique.size}/${hashes.length}`);

  // Extract a couple for manual inspection
  for (const name of [pngs[0], pngs[Math.floor(pngs.length / 2)], pngs[pngs.length - 1]]) {
    const dest = path.join(outDir, path.basename(name));
    fs.writeFileSync(dest, await zip.files[name].async('nodebuffer'));
  }

  await browser.close();

  if (errors.length) {
    console.warn('page errors:', errors.slice(0, 5));
  }

  if (unique.size < 2) {
    throw new Error('All exported frames are identical — animation bake is broken');
  }
  // Stronger check: at least ~30% unique for a walking cycle
  if (unique.size < Math.min(3, Math.ceil(hashes.length * 0.25))) {
    throw new Error(
      `Too few unique frames (${unique.size}/${hashes.length}) — animation likely stuck`,
    );
  }

  console.log('OK: animation frames differ across export');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
