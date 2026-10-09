/**
 * End-to-end: preview textures + unique export frames for spineboy.
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
const outDir = path.join(root, 'release', 'e2e-preview-export');
const baseURL = process.env.SMOKE_URL || 'http://localhost:5199';

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
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1400, height: 1000 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const url = baseURL.includes('127.0.0.1')
    ? baseURL.replace('127.0.0.1', 'localhost')
    : baseURL;
  await page.goto(url, { waitUntil: 'networkidle' });
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

  await page.locator('.anim-preview').first().scrollIntoViewIfNeeded();
  await page.waitForSelector('.anim-preview.status-ready canvas', { timeout: 25000 });
  await page.waitForTimeout(1000);

  const previewShot = path.join(outDir, 'preview.png');
  await page.locator('.anim-preview.status-ready canvas').first().screenshot({ path: previewShot });

  const colorStats = await page.evaluate(() => {
    const canvas = document.querySelector('.anim-preview.status-ready canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('No preview canvas');
    // WebGL canvas: read via temporary 2d draw if needed
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext('2d');
    if (!ctx) throw new Error('No 2d');
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
    let samples = 0;
    let greenDominant = 0;
    let colorful = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let i = 0; i < data.length; i += 8) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 16 || r + g + b < 40) continue;
      samples += 1;
      sumR += r;
      sumG += g;
      sumB += b;
      if (g > r + 40 && g > b + 40) greenDominant += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 25) colorful += 1;
    }
    return {
      samples,
      greenRatio: samples ? greenDominant / samples : 1,
      colorRatio: samples ? colorful / samples : 0,
      avg: samples
        ? { r: sumR / samples, g: sumG / samples, b: sumB / samples }
        : { r: 0, g: 0, b: 0 },
    };
  });

  console.log('preview colors:', colorStats);
  if (colorStats.samples < 40) {
    throw new Error(`Preview too empty: samples=${colorStats.samples}`);
  }
  if (colorStats.greenRatio >= 0.55) {
    throw new Error(`Preview looks green-tinted: greenRatio=${colorStats.greenRatio}`);
  }
  // Spineboy has a dark suit; require some chroma, not a high ratio.
  if (colorStats.colorRatio < 0.05) {
    throw new Error(`Preview lacks color variety: colorRatio=${colorStats.colorRatio}`);
  }
  if (colorStats.avg.b < 35 && colorStats.avg.r < 35) {
    throw new Error(`Preview looks too dark/flat: avg=${JSON.stringify(colorStats.avg)}`);
  }
  console.log('PASS preview textures');

  // App smoke module (measure + unique frames)
  const smoke = await page.evaluate(async () => {
    const mod = await import('/src/appSmokeTest.ts');
    return mod.runAppSmoke();
  });
  console.log('appSmoke:', JSON.stringify(smoke, null, 2));
  if (!smoke.pass) throw new Error(`appSmoke failed: ${smoke.error || 'unknown'}`);

  const firstFrameToggle = page.locator('label').filter({ hasText: /First frame/i }).locator('input');
  if (await firstFrameToggle.count()) {
    if (await firstFrameToggle.isChecked()) await firstFrameToggle.click();
  }
  const animSelect = page.locator('.job-card select').first();
  const options = await animSelect.locator('option').allTextContents();
  const prefer = ['walk', 'run', 'idle', 'jump'].find((n) => options.includes(n));
  if (prefer) await animSelect.selectOption(prefer);
  const fpsInput = page.locator('label').filter({ hasText: /^FPS/i }).locator('input');
  if (await fpsInput.count()) await fpsInput.fill('12');

  await page.waitForTimeout(500);
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
  if (pngs.length < 3) throw new Error(`Expected >= 3 frames, got ${pngs.length}`);

  const hashes = [];
  for (const name of pngs) {
    const buf = await zip.files[name].async('nodebuffer');
    hashes.push(sha1(buf));
  }
  const unique = new Set(hashes).size;
  console.log(`unique frame hashes: ${unique}/${hashes.length}`);
  if (unique < 2) throw new Error('Export frames are identical');

  for (const name of [pngs[0], pngs[Math.floor(pngs.length / 2)], pngs[pngs.length - 1]]) {
    fs.writeFileSync(path.join(outDir, path.basename(name)), await zip.files[name].async('nodebuffer'));
  }

  if (pageErrors.length) {
    console.warn('page errors:', pageErrors);
  }

  await browser.close();
  console.log('PASS e2e preview + export');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
