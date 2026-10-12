/**
 * Generate Frame Exporter app icons from a hand-crafted SVG.
 * Metaphor: skeletal figure + stacked PNG/film frames (Spine → frame sequence).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const iconsDir = path.join(root, 'src-tauri', 'icons');
const publicDir = path.join(root, 'public');
const masterSvg = path.join(iconsDir, 'app-icon.svg');
const masterPng = path.join(iconsDir, 'icon.png');

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a2228"/>
      <stop offset="45%" stop-color="#0e1114"/>
      <stop offset="100%" stop-color="#070809"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="42%" r="55%">
      <stop offset="0%" stop-color="#2dd4bf" stop-opacity="0.28"/>
      <stop offset="55%" stop-color="#0ea5a4" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="frameFill" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1c2830"/>
      <stop offset="100%" stop-color="#12181c"/>
    </linearGradient>
    <linearGradient id="bone" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#5eead4"/>
      <stop offset="100%" stop-color="#14b8a6"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="8" result="b"/>
      <feOffset dy="4" in="b" result="o"/>
      <feComponentTransfer in="o" result="s"><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
      <feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#glow)"/>

  <g filter="url(#soft)">
    <rect x="268" y="198" width="420" height="520" rx="48" fill="#152028" stroke="#f59e0b" stroke-opacity="0.35" stroke-width="10" transform="rotate(-11 478 458)"/>
    <rect x="298" y="218" width="420" height="520" rx="48" fill="#1a2830" stroke="#fbbf24" stroke-opacity="0.45" stroke-width="10" transform="rotate(-5.5 508 478)"/>
    <rect x="322" y="236" width="420" height="520" rx="48" fill="url(#frameFill)" stroke="#f59e0b" stroke-width="14"/>
  </g>

  <rect x="352" y="276" width="360" height="440" rx="32" fill="none" stroke="#2dd4bf" stroke-opacity="0.22" stroke-width="6"/>

  <circle cx="686" cy="286" r="28" fill="#f59e0b"/>
  <circle cx="686" cy="286" r="12" fill="#0e1114"/>

  <g fill="none" stroke="url(#bone)" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="532" cy="360" r="36" stroke-width="14" fill="#0e1114"/>
    <path d="M532 396 L532 520" stroke-width="16"/>
    <path d="M450 430 L532 418 L620 448" stroke-width="14"/>
    <path d="M490 520 L532 520 L574 520" stroke-width="14"/>
    <path d="M490 520 L468 620" stroke-width="14"/>
    <path d="M574 520 L610 612" stroke-width="14"/>
  </g>
  <g fill="#5eead4">
    <circle cx="532" cy="418" r="9"/>
    <circle cx="450" cy="430" r="8"/>
    <circle cx="620" cy="448" r="8"/>
    <circle cx="532" cy="520" r="10"/>
    <circle cx="490" cy="520" r="8"/>
    <circle cx="574" cy="520" r="8"/>
    <circle cx="468" cy="620" r="8"/>
    <circle cx="610" cy="612" r="8"/>
  </g>

  <g fill="#f59e0b" opacity="0.85">
    <rect x="400" y="668" width="36" height="10" rx="5"/>
    <rect x="448" y="668" width="36" height="10" rx="5"/>
    <rect x="496" y="668" width="36" height="10" rx="5"/>
    <rect x="544" y="668" width="36" height="10" rx="5" opacity="0.45"/>
  </g>
</svg>
`;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sipsResize(src, dest, size) {
  ensureDir(path.dirname(dest));
  execFileSync('sips', ['-z', String(size), String(size), src, '--out', dest], {
    stdio: 'pipe',
  });
}

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
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(systemChrome)) return systemChrome;
  throw new Error('Chromium not found');
}

async function rasterizeSvg() {
  ensureDir(iconsDir);
  fs.writeFileSync(masterSvg, SVG, 'utf8');

  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:1024px;height:1024px;background:#000;overflow:hidden}
    img{display:block;width:1024px;height:1024px}
  </style></head><body><img src="data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}"/></body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(100);
  await page.screenshot({ path: masterPng, type: 'png', omitBackground: false });
  await browser.close();
}

function main() {
  return rasterizeSvg().then(() => {
    const sizes = [
      ['32x32.png', 32],
      ['128x128.png', 128],
      ['128x128@2x.png', 256],
      ['Square30x30Logo.png', 30],
      ['Square44x44Logo.png', 44],
      ['Square71x71Logo.png', 71],
      ['Square89x89Logo.png', 89],
      ['Square107x107Logo.png', 107],
      ['Square142x142Logo.png', 142],
      ['Square150x150Logo.png', 150],
      ['Square284x284Logo.png', 284],
      ['Square310x310Logo.png', 310],
      ['StoreLogo.png', 50],
    ];

    for (const [name, size] of sizes) {
      sipsResize(masterPng, path.join(iconsDir, name), size);
    }

    sipsResize(masterPng, path.join(publicDir, 'app-icon-512.png'), 512);
    fs.copyFileSync(masterSvg, path.join(publicDir, 'favicon.svg'));

    const iconset = path.join(iconsDir, 'AppIcon.iconset');
    if (fs.existsSync(iconset)) fs.rmSync(iconset, { recursive: true });
    ensureDir(iconset);
    const icnsMap = [
      ['icon_16x16.png', 16],
      ['diana.k@example.org', 32],
      ['icon_32x32.png', 32],
      ['ivan.p@example.net', 64],
      ['icon_128x128.png', 128],
      ['wendy.h@example.net', 256],
      ['icon_256x256.png', 256],
      ['wendy.h@example.net', 512],
      ['icon_512x512.png', 512],
      ['walt.e@example.net', 1024],
    ];
    for (const [name, size] of icnsMap) {
      sipsResize(masterPng, path.join(iconset, name), size);
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(iconsDir, 'icon.icns')], {
      stdio: 'pipe',
    });
    fs.rmSync(iconset, { recursive: true });

    // Refresh .ico via sips isn't great; keep a 256 PNG companion for Windows tooling.
    sipsResize(masterPng, path.join(iconsDir, 'icon-256-for-ico.png'), 256);

    console.log('Generated icons in', iconsDir);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
