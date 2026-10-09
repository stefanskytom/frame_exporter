/**
 * Browser smoke for Vite: jobs → measure → preview motion → unique export frames.
 * Load via: import('/src/appSmokeTest.ts').then(m => m.runAppSmoke())
 */
import {
  AnimationState,
  AnimationStateData,
  MixBlend,
  MixDirection,
  Physics,
  Skeleton,
  Vector2,
} from '@esotericsoftware/spine-core';
import {
  AssetManager,
  ManagedWebGLRenderingContext,
  SceneRenderer,
} from '@esotericsoftware/spine-webgl';
import { buildSkeletonJobs, createAssetFiles } from './lib/assets';
import {
  isJobExportable,
  loadSkeletonFromJob,
  measureJobFrameSize,
} from './lib/spineExport';
import { DEFAULT_SETTINGS, type ExportSettings } from './types';

export type SmokeReport = {
  pass: boolean;
  steps: Array<{ name: string; ok: boolean; detail: string }>;
  error?: string;
};

async function sha1Short(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
}

function pngBytesFromCanvas(canvas: HTMLCanvasElement): Uint8Array {
  const dataUrl = canvas.toDataURL('image/png');
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function runAppSmoke(): Promise<SmokeReport> {
  const report: SmokeReport = { pass: false, steps: [] };
  const step = (name: string, ok: boolean, detail: string) => {
    report.steps.push({ name, ok, detail });
    if (!ok) throw new Error(`${name}: ${detail}`);
  };

  try {
    const base = '/test-fixtures/spineboy';
    const [jsonBuf, atlasBuf, pngBuf] = await Promise.all([
      fetch(`${base}/spineboy-pro.json`).then((r) => r.blob()),
      fetch(`${base}/spineboy.atlas`).then((r) => r.blob()),
      fetch(`${base}/spineboy.png`).then((r) => r.blob()),
    ]);
    const jsonFile = new File([jsonBuf], 'spineboy-pro.json', { type: 'application/json' });
    const atlasFile = new File([atlasBuf], 'spineboy.atlas', { type: 'text/plain' });
    const pngFile = new File([pngBuf], 'spineboy.png', { type: 'image/png' });

    const assets = createAssetFiles([atlasFile, pngFile]);
    const jobs = await buildSkeletonJobs([jsonFile], assets);
    const job = {
      ...jobs[0],
      selectedAnimation: 'walk',
      selectedSkin: jobs[0].selectedSkin || 'default',
    };
    step(
      'buildJobs',
      job.status === 'ready',
      `status=${job.status} anims=${job.animations.length} missing=${job.missingImagePaths.length}`,
    );

    const settings: ExportSettings = {
      ...DEFAULT_SETTINGS,
      canvasWidth: 256,
      canvasHeight: 256,
      fps: 12,
    };

    const frameInfo = await measureJobFrameSize(job, assets, settings);
    step(
      'measureFrameSize',
      frameInfo.width > 10 && frameInfo.height > 10,
      `${Math.round(frameInfo.scaledWidth)}x${Math.round(frameInfo.scaledHeight)}`,
    );

    const canvas = document.createElement('canvas');
    canvas.width = 168;
    canvas.height = 168;
    const context = new ManagedWebGLRenderingContext(canvas, {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    const gl = context.gl;
    if (!gl) throw new Error('No WebGL');

    const assetManager = new AssetManager(context);
    const { skeletonData } = await loadSkeletonFromJob(job, assets, assetManager, false);
    const skeleton = new Skeleton(skeletonData);
    skeleton.setSkinByName(job.selectedSkin);
    skeleton.setToSetupPose();

    const state = new AnimationState(new AnimationStateData(skeletonData));
    state.setAnimation(0, 'walk', true);
    const hips: string[] = [];
    for (let i = 0; i < 8; i++) {
      state.update(1 / 30);
      state.apply(skeleton);
      skeleton.updateWorldTransform(Physics.update);
      const hip = skeleton.findBone('hip')!;
      hips.push(`${hip.worldX.toFixed(2)},${hip.worldY.toFixed(2)}`);
    }
    const uniqueHips = new Set(hips).size;
    step('previewMotion', uniqueHips >= 3, `uniqueHips=${uniqueHips}/8`);

    const renderer = new SceneRenderer(canvas, context, false);
    const offset = new Vector2();
    const size = new Vector2();
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform(Physics.update);
    skeleton.getBounds(offset, size, []);
    renderer.camera.position.x = offset.x + size.x / 2;
    renderer.camera.position.y = offset.y + size.y / 2;
    renderer.camera.viewportWidth = Math.max(size.x * 1.15, 1);
    renderer.camera.viewportHeight = Math.max(size.y * 1.15, 1);
    renderer.camera.update();

    const animation = skeletonData.findAnimation('walk')!;
    const hashes: string[] = [];
    for (const t of [0, 0.25, 0.5, 0.75]) {
      skeleton.setSkinByName(job.selectedSkin);
      skeleton.setToSetupPose();
      animation.apply(skeleton, -1, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
      skeleton.updateWorldTransform(Physics.update);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.08, 0.08, 0.1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      renderer.begin();
      renderer.drawSkeleton(skeleton, false);
      renderer.end();
      gl.finish();
      hashes.push(await sha1Short(pngBytesFromCanvas(canvas)));
    }
    const uniqueFrames = new Set(hashes).size;
    step('exportFrameHashes', uniqueFrames >= 2, `${uniqueFrames}/4 ${hashes.join(',')}`);

    // Texture sanity: spineboy should not render as solid green placeholders.
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let samples = 0;
    let greenDominant = 0;
    let colorful = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (a < 16 || r + g + b < 40) continue;
      samples += 1;
      if (g > r + 40 && g > b + 40) greenDominant += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 25) colorful += 1;
    }
    const greenRatio = samples ? greenDominant / samples : 1;
    const colorRatio = samples ? colorful / samples : 0;
    step(
      'textureColors',
      samples > 50 && greenRatio < 0.55 && colorRatio > 0.05,
      `samples=${samples} greenRatio=${greenRatio.toFixed(2)} colorRatio=${colorRatio.toFixed(2)}`,
    );

    step('exportable', isJobExportable(job, settings), 'isJobExportable');

    renderer.dispose();
    assetManager.dispose();
    report.pass = true;
  } catch (e) {
    report.pass = false;
    report.error = e instanceof Error ? e.message : String(e);
  }

  (window as unknown as { __APP_SMOKE__: SmokeReport }).__APP_SMOKE__ = report;
  return report;
}
