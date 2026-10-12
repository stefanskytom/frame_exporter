/**
 * Thorough feature coverage for Frame Exporter v1 + v2.
 * Requires Vite on SMOKE_URL (default http://localhost:5199).
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
const fixtures = path.join(root, 'test-fixtures');
const spineboy = path.join(fixtures, 'spineboy');
const outDir = path.join(root, 'release', 'feature-tests');
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

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

async function loadSpineboy(page) {
  const jsonInput = page
    .locator('section.panel')
    .filter({ hasText: 'Spine JSON files' })
    .locator('input[type=file]')
    .first();
  await jsonInput.setInputFiles(path.join(spineboy, 'spineboy-pro.json'));
  // v1 shows job card text; v2 puts the name in a <select> option (often "hidden").
  await page.waitForFunction(() => {
    const body = document.body?.innerText || '';
    if (/spineboy-pro/i.test(body)) return true;
    return [...document.querySelectorAll('option')].some((o) =>
      /spineboy-pro/i.test(o.textContent || ''),
    );
  }, { timeout: 15000 });

  const assetInput = page
    .locator('section.panel')
    .filter({ hasText: 'Asset location' })
    .locator('input[type=file]')
    .nth(1);
  await assetInput.setInputFiles([
    path.join(spineboy, 'spineboy.atlas'),
    path.join(spineboy, 'spineboy.png'),
  ]);
  await page.waitForFunction(() => {
    const pills = [...document.querySelectorAll('.stat-pill')].map((el) => el.textContent || '');
    return pills.some((t) => /atlas/i.test(t) && !/^0\s*atlas/i.test(t.trim()));
  });
}

async function exportZip(page, buttonName, dest) {
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: buttonName }).click();
  const download = await downloadPromise;
  await download.saveAs(dest);
  return JSZip.loadAsync(fs.readFileSync(dest));
}

function pngEntries(zip) {
  return Object.keys(zip.files)
    .filter((n) => n.toLowerCase().endsWith('.png') && !zip.files[n].dir)
    .sort();
}

async function uniqueHashCount(zip, names) {
  const hashes = [];
  for (const name of names) {
    hashes.push(sha1(await zip.files[name].async('nodebuffer')));
  }
  return new Set(hashes).size;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  const pass = (name, detail = '') => {
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.error(`FAIL  ${name} — ${detail}`);
  };

  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
  });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // ——— v1 classic features ———
  await page.goto(`${baseURL}#v1`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /v1 Classic/i }).click();
  await page.waitForSelector('text=Animation frame export');

  try {
    await loadSpineboy(page);
    await page.waitForSelector('.anim-preview.status-ready canvas', { timeout: 25000 });
    pass('v1.import-atlas', 'spineboy ready + preview');
  } catch (e) {
    fail('v1.import-atlas', String(e));
    await browser.close();
    process.exit(1);
  }

  // Frame size measurement appears
  try {
    await page.waitForSelector('.frame-size.ok, .frame-size.warn', { timeout: 20000 });
    const txt = await page.locator('.frame-size.ok, .frame-size.warn').first().innerText();
    if (!/\d/.test(txt)) throw new Error(`No numbers in frame size: ${txt}`);
    pass('v1.frame-size', txt.split('\n')[0]);
  } catch (e) {
    fail('v1.frame-size', String(e));
  }

  // Skin / animation selectors present
  try {
    const animOpts = await page.locator('.job-card select').first().locator('option').count();
    if (animOpts < 2) throw new Error(`Expected multiple animations, got ${animOpts}`);
    await page.locator('.job-card select').first().selectOption('walk');
    pass('v1.animation-select', `${animOpts} animations`);
  } catch (e) {
    fail('v1.animation-select', String(e));
  }

  const firstFrameToggle = () =>
    page.locator('.toggle-row').filter({ hasText: /First frame only/i }).locator('input[type=checkbox]');
  const allAnimToggle = () =>
    page.locator('.toggle-row').filter({ hasText: /All animations/i }).locator('input[type=checkbox]');
  const transparentToggle = () =>
    page
      .locator('.toggle-row')
      .filter({ hasText: /Transparent background/i })
      .locator('input[type=checkbox]');

  // First-frame export
  try {
    if (!(await firstFrameToggle().isChecked())) await firstFrameToggle().check();
    const zip = await exportZip(page, /Export ZIP/i, path.join(outDir, 'v1-first-frame.zip'));
    const pngs = pngEntries(zip);
    if (pngs.length !== 1) throw new Error(`Expected 1 frame, got ${pngs.length}: ${pngs.join(',')}`);
    if (!pngs[0].includes('spineboy')) throw new Error(`Unexpected path ${pngs[0]}`);
    pass('v1.first-frame-export', pngs[0]);
  } catch (e) {
    fail('v1.first-frame-export', String(e));
  }

  // Multi-frame + naming custom
  try {
    if (await firstFrameToggle().isChecked()) await firstFrameToggle().uncheck();
    await page.locator('label').filter({ hasText: /^FPS/i }).locator('input').fill('10');
    await page.locator('label').filter({ hasText: /Frame names/i }).locator('select').selectOption('custom');
    await page.locator('label').filter({ hasText: /^Pattern/i }).locator('input').fill('{name}_{anim}_{####}');
    const zip = await exportZip(page, /Export ZIP/i, path.join(outDir, 'v1-walk-named.zip'));
    const pngs = pngEntries(zip);
    if (pngs.length < 3) throw new Error(`Expected >=3 frames, got ${pngs.length}`);
    if (!pngs.some((n) => /walk/i.test(n))) throw new Error(`Naming missing anim: ${pngs[0]}`);
    const unique = await uniqueHashCount(zip, pngs);
    if (unique < 2) throw new Error('Frames identical');
    pass('v1.custom-naming-multiframe', `${pngs.length} frames, ${unique} unique`);
  } catch (e) {
    fail('v1.custom-naming-multiframe', String(e));
  }

  // Export all animations
  try {
    if (!(await allAnimToggle().isChecked())) await allAnimToggle().check();
    if (!(await firstFrameToggle().isChecked())) await firstFrameToggle().check();
    const zip = await exportZip(page, /Export ZIP/i, path.join(outDir, 'v1-all-anims.zip'));
    const pngs = pngEntries(zip);
    const folders = new Set(pngs.map((n) => n.split('/')[1]).filter(Boolean));
    if (folders.size < 3) throw new Error(`Expected many anim folders, got ${[...folders]} (${pngs.length} pngs)`);
    pass('v1.export-all-animations', `${folders.size} anim folders, ${pngs.length} frames`);
  } catch (e) {
    fail('v1.export-all-animations', String(e));
  }

  // Opaque background
  try {
    if (await allAnimToggle().isChecked()) await allAnimToggle().uncheck();
    if (!(await firstFrameToggle().isChecked())) await firstFrameToggle().check();
    if (await transparentToggle().isChecked()) await transparentToggle().uncheck();
    await page.waitForSelector('input[type=color]', { timeout: 5000 });
    await page.locator('input[type=color]').fill('#224466');
    const zip = await exportZip(page, /Export ZIP/i, path.join(outDir, 'v1-opaque-bg.zip'));
    const pngs = pngEntries(zip);
    if (pngs.length < 1) throw new Error('No frames');
    const buf = await zip.files[pngs[0]].async('nodebuffer');
    const stats = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const p = ctx.getImageData(2, 2, 1, 1).data;
      return { r: p[0], g: p[1], b: p[2], a: p[3] };
    }, buf.toString('base64'));
    if (stats.a < 200) throw new Error(`Expected opaque bg, got ${JSON.stringify(stats)}`);
    if (stats.b < 50) throw new Error(`Background not bluish: ${JSON.stringify(stats)}`);
    pass('v1.opaque-background', JSON.stringify(stats));
  } catch (e) {
    fail('v1.opaque-background', String(e));
  }

  // Suggested canvas button (if overflow)
  try {
    await page.locator('label').filter({ hasText: /^Width/i }).locator('input').fill('64');
    await page.locator('label').filter({ hasText: /^Height/i }).locator('input').fill('64');
    await page.waitForTimeout(600);
    const btn = page.getByRole('button', { name: /Set canvas to/i });
    if (await btn.count()) {
      await btn.first().click();
      await page.waitForTimeout(200);
      const w = await page.locator('label').filter({ hasText: /^Width/i }).locator('input').inputValue();
      if (Number(w) <= 64) throw new Error(`Canvas width not applied: ${w}`);
      pass('v1.suggest-canvas', `width=${w}`);
    } else {
      pass('v1.suggest-canvas', 'skipped (already fits)');
    }
  } catch (e) {
    fail('v1.suggest-canvas', String(e));
  }

  // Clear jobs
  try {
    await page.getByRole('button', { name: /^Clear$/i }).click();
    await page.waitForSelector('text=First add', { timeout: 5000 });
    pass('v1.clear-jobs');
  } catch (e) {
    fail('v1.clear-jobs', String(e));
  }

  // Images-folder mode (minimal synthetic fixture) + leftover atlas must not bind
  try {
    // Leave spineboy atlas in assets on purpose, then import an unrelated JSON.
    const jsonInput = page
      .locator('section.panel')
      .filter({ hasText: 'Spine JSON files' })
      .locator('input[type=file]')
      .first();
    await jsonInput.setInputFiles(path.join(fixtures, 'mini', 'mini.json'));
    await page.waitForSelector('text=mini', { timeout: 15000 });

    const assetInput = page
      .locator('section.panel')
      .filter({ hasText: 'Asset location' })
      .locator('input[type=file]')
      .nth(1);
    await assetInput.setInputFiles(path.join(fixtures, 'mini', 'images', 'hero.png'));
    await page.waitForFunction(() => {
      const card = document.querySelector('.job-card');
      return card && /mini/i.test(card.textContent || '');
    });

    await page.waitForSelector('.job-card .badge.mode', { timeout: 10000 });
    const mode = await page.locator('.job-card').filter({ hasText: 'mini' }).locator('.badge.mode').first().innerText();
    if (!/images/i.test(mode)) {
      throw new Error(`Expected images mode despite leftover atlas, got ${mode}`);
    }
    await page.waitForSelector('.job-card.status-ready', { timeout: 15000 });

    const firstFrame = page
      .locator('.toggle-row')
      .filter({ hasText: /First frame only/i })
      .locator('input[type=checkbox]');
    if (!(await firstFrame.isChecked())) await firstFrame.check();

    const zip = await exportZip(page, /Export ZIP/i, path.join(outDir, 'v1-mini-images.zip'));
    const pngs = pngEntries(zip);
    if (pngs.length < 1) throw new Error('Mini images export empty');
    pass('v1.images-mode-mini', `${mode} · ${pngs.length} frame(s)`);
  } catch (e) {
    fail('v1.images-mode-mini', String(e));
  }

  // ——— Version switch + v2 ———
  try {
    await page.getByRole('button', { name: /v2 Tracks/i }).click();
    await page.waitForSelector('text=Multi-track mix', { timeout: 10000 });
    pass('version-switch-v2');
  } catch (e) {
    fail('version-switch-v2', String(e));
  }

  try {
    await loadSpineboy(page);
    await page.waitForSelector('.v2-job-pick select', { timeout: 15000 });
    await page.waitForSelector('.v2-track-row select', { timeout: 15000 });
    await page.waitForSelector('.v2-preview.status-ready canvas, .v2-preview canvas', {
      timeout: 25000,
    });
    const selects = page.locator('.v2-track-row select');
    const count = await selects.count();
    if (count < 1) throw new Error('No tracks');
    await selects.nth(0).selectOption('walk');
    if (count < 2) await page.getByRole('button', { name: /Add track/i }).click();
    await page.locator('.v2-track-row select').nth(1).selectOption('aim');

    await page.locator('.v2-track-row').nth(1).locator('input[type=number]').nth(2).fill('0.9');

    await page.locator('.v2-export-grid input').nth(0).fill('0.8');
    await page.locator('label').filter({ hasText: /^FPS/i }).locator('input').fill('10');

    const zip = await exportZip(
      page,
      /Export mixed tracks ZIP/i,
      path.join(outDir, 'v2-walk-aim.zip'),
    );
    const pngs = pngEntries(zip);
    if (pngs.length < 3) throw new Error(`Expected >=3, got ${pngs.length}`);
    const unique = await uniqueHashCount(zip, pngs);
    if (unique < 2) throw new Error('v2 frames identical');
    pass('v2.multi-track-export', `${pngs.length} frames, ${unique} unique`);
  } catch (e) {
    fail('v2.multi-track-export', String(e));
  }

  // Fit duration button
  try {
    const fit = page.getByRole('button', { name: /Fit to animation cycle/i });
    await page.waitForTimeout(500);
    if (await fit.isEnabled()) {
      await fit.click();
      const dur = await page.locator('.v2-export-grid input').nth(0).inputValue();
      if (!(Number(dur) > 0)) throw new Error(`Bad duration ${dur}`);
      pass('v2.fit-duration', `duration=${dur}`);
    } else {
      pass('v2.fit-duration', 'button disabled (no cycle yet)');
    }
  } catch (e) {
    fail('v2.fit-duration', String(e));
  }

  // Back to v1
  try {
    await page.getByRole('button', { name: /v1 Classic/i }).click();
    await page.waitForSelector('text=Animation frame export', { timeout: 8000 });
    pass('version-switch-v1');
  } catch (e) {
    fail('version-switch-v1', String(e));
  }

  // In-page smoke module
  try {
    const smoke = await page.evaluate(async () => {
      const mod = await import('/src/appSmokeTest.ts');
      return mod.runAppSmoke();
    });
    if (!smoke.pass) throw new Error(smoke.error || JSON.stringify(smoke.steps));
    pass('appSmokeTest', smoke.steps.map((s) => s.name).join(', '));
  } catch (e) {
    fail('appSmokeTest', String(e));
  }

  if (pageErrors.length) {
    console.warn('pageerrors:', pageErrors.slice(0, 5));
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ results, pageErrors }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.error('Failed:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
  console.log('ALL FEATURE TESTS PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
