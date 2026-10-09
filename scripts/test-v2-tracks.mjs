/**
 * E2E for Frame Exporter v2 — multi-track mix export (walk + aim).
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
const outDir = path.join(root, 'release', 'v2-track-export');
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
  const home = process.env.HOME || '';
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(home, 'Library/Caches/ms-playwright'),
  ].filter(Boolean);
  for (const dir of cacheRoots) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir).sort().reverse()) {
      for (const exe of [
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
      ]) {
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of ['spineboy-pro.json', 'spineboy.atlas', 'spineboy.png']) {
    const p = path.join(fixtures, name);
    if (!fs.existsSync(p)) throw new Error(`Missing fixture: ${p}`);
  }

  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
  });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1400, height: 1000 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(`${baseURL}#v2`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /v2 Tracks/i }).click();
  await page.waitForSelector('text=Multi-track mix', { timeout: 10000 });

  await page
    .locator('section.panel')
    .filter({ hasText: 'Spine JSON files' })
    .locator('input[type=file]')
    .first()
    .setInputFiles(path.join(fixtures, 'spineboy-pro.json'));
  await page.waitForSelector('.v2-job-pick select', { timeout: 15000 });

  await page
    .locator('section.panel')
    .filter({ hasText: 'Asset location' })
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles([
      path.join(fixtures, 'spineboy.atlas'),
      path.join(fixtures, 'spineboy.png'),
    ]);

  await page.waitForSelector('.v2-track-row', { timeout: 15000 });
  await page.waitForFunction(() => {
    const pills = [...document.querySelectorAll('.stat-pill')].map((el) => el.textContent || '');
    return pills.some((t) => /atlas/i.test(t) && !/^0\s*atlas/i.test(t.trim()));
  });

  // Ensure track 0 = walk, track 1 = aim (defaults usually set this)
  const selects = page.locator('.v2-track-row select');
  const count = await selects.count();
  if (count < 1) throw new Error('No track rows');
  await selects.nth(0).selectOption('walk');
  if (count < 2) {
    await page.getByRole('button', { name: /Add track/i }).click();
  }
  await page.locator('.v2-track-row select').nth(1).selectOption('aim');

  await page.locator('.v2-export-grid input').nth(0).fill('1'); // duration
  await page.locator('label').filter({ hasText: /^FPS/i }).locator('input').fill('12');

  await page.locator('.v2-preview').scrollIntoViewIfNeeded();
  await page.waitForSelector('.v2-preview.status-ready canvas', { timeout: 25000 });
  await page.waitForTimeout(800);
  await page.locator('.v2-preview.status-ready canvas').screenshot({
    path: path.join(outDir, 'preview-walk-aim.png'),
  });

  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: /Export mixed tracks ZIP/i }).click();
  const download = await downloadPromise;
  const zipPath = path.join(outDir, 'spineboy_tracks.zip');
  await download.saveAs(zipPath);

  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const pngs = Object.keys(zip.files)
    .filter((n) => n.toLowerCase().endsWith('.png') && !zip.files[n].dir)
    .sort();
  console.log('exported frames:', pngs.length);
  if (pngs.length < 3) throw new Error(`Expected >= 3 frames, got ${pngs.length}`);

  const hashes = [];
  for (const name of pngs) {
    const buf = await zip.files[name].async('nodebuffer');
    hashes.push(sha1(buf));
  }
  const unique = new Set(hashes).size;
  console.log(`unique hashes: ${unique}/${hashes.length}`);
  if (unique < 2) throw new Error('Mixed-track frames are identical');

  const pick = [pngs[0], pngs[Math.floor(pngs.length / 2)], pngs[pngs.length - 1]];
  for (const name of pick) {
    const dest = path.join(outDir, path.basename(name));
    fs.writeFileSync(dest, await zip.files[name].async('nodebuffer'));
    console.log('wrote', dest);
  }

  // Compare first mixed frame pixels: should not be empty / all green
  const stats = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let samples = 0;
    let green = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 8 || r + g + b < 30) continue;
      samples++;
      if (g > r + 40 && g > b + 40) green++;
    }
    return { samples, greenRatio: samples ? green / samples : 1, w: c.width, h: c.height };
  }, Buffer.from(await zip.files[pngs[0]].async('nodebuffer')).toString('base64'));

  console.log('frame0 stats', stats);
  if (stats.samples < 100) throw new Error('Exported frame looks empty');
  if (stats.greenRatio > 0.55) throw new Error('Exported frame looks green-tinted');

  if (pageErrors.length) console.warn('page errors', pageErrors);
  await browser.close();
  console.log('PASS v2 multi-track export');
  console.log('Output dir:', outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
