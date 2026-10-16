/**
 * After `tauri build`, prepare distributable macOS artifacts:
 * - ad-hoc codesign the .app (fixes "damaged / won't open" on other Macs)
 * - strip quarantine attrs
 * - refresh public/ DMG, zip, and .app
 *
 * Usage: node scripts/package-macos-dist.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const candidates = [
  path.join(
    root,
    'src-tauri/target/release/bundle/macos/Frame Exporter.app',
  ),
  // Cursor / sandbox cargo target cache
  ...fs
    .readdirSync('/var/folders', { withFileTypes: true })
    .flatMap(() => [])
    .concat([]),
];

function findBuiltApp() {
  const local = path.join(
    root,
    'src-tauri/target/release/bundle/macos/Frame Exporter.app',
  );
  if (fs.existsSync(local)) return local;

  // Fall back to CARGO_TARGET_DIR / common sandbox cache
  const envTarget = process.env.CARGO_TARGET_DIR;
  if (envTarget) {
    const p = path.join(envTarget, 'release/bundle/macos/Frame Exporter.app');
    if (fs.existsSync(p)) return p;
  }

  // Search under /var/folders for recent Frame Exporter.app from tauri build
  try {
    const found = execSync(
      `find /var/folders -type d -name 'Frame Exporter.app' 2>/dev/null | head -20`,
      { encoding: 'utf8', timeout: 15000 },
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    // Prefer paths containing cargo-target/release/bundle
    const prefer = found.find((p) => p.includes('release/bundle/macos'));
    if (prefer) return prefer;
    if (found[0]) return found[0];
  } catch {
    // ignore
  }
  return null;
}

function run(cmd, args, opts = {}) {
  console.log('>', cmd, args.join(' '));
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function signApp(appPath) {
  const entitlements = path.join(root, 'src-tauri/Entitlements.plist');
  // Clear quarantine first
  try {
    run('xattr', ['-cr', appPath]);
  } catch {
    // ignore
  }

  // Ad-hoc sign entire bundle with entitlements (no hardened-runtime —
  // that requires Apple Developer ID for Gatekeeper to accept downloads).
  run('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--entitlements',
    entitlements,
    '--timestamp=none',
    appPath,
  ]);

  run('codesign', ['--verify', '--verbose=2', appPath]);
}

function main() {
  const srcApp = findBuiltApp();
  if (!srcApp) {
    console.error('No built Frame Exporter.app found. Run: npm run tauri:build');
    process.exit(1);
  }
  console.log('Source app:', srcApp);

  signApp(srcApp);

  const publicDir = path.join(root, 'public');
  const releaseDir = path.join(root, 'release');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.mkdirSync(releaseDir, { recursive: true });

  const destAppPublic = path.join(publicDir, 'Frame Exporter.app');
  const destAppRelease = path.join(releaseDir, 'Frame Exporter.app');

  for (const dest of [destAppPublic, destAppRelease]) {
    fs.rmSync(dest, { recursive: true, force: true });
    run('cp', ['-R', srcApp, dest]);
    signApp(dest);
    try {
      run('xattr', ['-cr', dest]);
    } catch {
      // ignore
    }
  }

  // Zip for easy transfer (preserves .app structure better than chat apps)
  const zipPath = path.join(publicDir, 'Frame-Exporter-macOS.zip');
  fs.rmSync(zipPath, { force: true });
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', destAppPublic, zipPath]);

  // Always rebuild DMG from the signed app (Tauri's DMG can ship a
  // linker-only signature that Gatekeeper rejects on other Macs).
  const dmgName = 'Frame Exporter_0.1.0_aarch64.dmg';
  const dmgPublic = path.join(publicDir, dmgName);
  const dmgRelease = path.join(releaseDir, dmgName);
  const stage = path.join(releaseDir, '_dmg_stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  run('cp', ['-R', destAppRelease, path.join(stage, 'Frame Exporter.app')]);
  try {
    run('xattr', ['-cr', path.join(stage, 'Frame Exporter.app')]);
  } catch {
    // ignore
  }
  fs.rmSync(dmgPublic, { force: true });
  fs.rmSync(dmgRelease, { force: true });
  run('hdiutil', [
    'create',
    '-volname',
    'Frame Exporter',
    '-srcfolder',
    stage,
    '-ov',
    '-format',
    'UDZO',
    dmgPublic,
  ]);
  fs.copyFileSync(dmgPublic, dmgRelease);
  fs.rmSync(stage, { recursive: true, force: true });

  console.log('\nDistribution ready:');
  console.log(' ', destAppPublic);
  console.log(' ', zipPath);
  console.log(' ', dmgPublic);
  console.log('\nRecipients on other Macs may still need to allow an unidentified developer:');
  console.log('  • Right-click the app → Open → Open');
  console.log('  • or: xattr -cr "/path/to/Frame Exporter.app"');
}

main();
