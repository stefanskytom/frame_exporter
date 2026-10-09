import {
  AnimationState,
  AnimationStateData,
  Physics,
  Skeleton,
  Vector2,
} from '@esotericsoftware/spine-core';
import {
  AssetManager,
  ManagedWebGLRenderingContext,
  SceneRenderer,
} from '@esotericsoftware/spine-webgl';
import JSZip from 'jszip';
import { downloadBlob } from '../lib/download';
import { formatFrameName, sanitizeFolderName } from '../lib/naming';
import {
  loadSkeletonFromJob,
  stripMissingAttachments,
} from '../lib/spineExport';
import type { AssetFiles, SkeletonJob } from '../types';
import {
  trackLocalTime,
  type TrackExportSettings,
  type TrackLayer,
} from './types';

function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  const cleaned = hex.replace('#', '');
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  const num = Number.parseInt(full, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
    a: 1,
  };
}

function canvasToPngBlobSync(canvas: HTMLCanvasElement): Blob {
  const dataUrl = canvas.toDataURL('image/png');
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Failed to encode PNG frame');
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

/**
 * Scrub AnimationState to an absolute global time with multiple tracks.
 * Sets each track's trackTime independently so frames are deterministic
 * (no reliance on cumulative state.update).
 */
export function applyTracksAtTime(
  skeleton: Skeleton,
  state: AnimationState,
  layers: TrackLayer[],
  globalTime: number,
  skinName: string,
) {
  skeleton.setSkinByName(skinName);
  skeleton.setSlotsToSetupPose();
  skeleton.setToSetupPose();
  state.clearTracks();

  const sorted = [...layers]
    .filter((l) => l.animationName)
    .sort((a, b) => a.trackIndex - b.trackIndex);

  for (const layer of sorted) {
    const animation = skeleton.data.findAnimation(layer.animationName);
    if (!animation) continue;
    const local = trackLocalTime(globalTime, layer, Math.max(animation.duration, 0));
    if (local == null) continue;

    const entry = state.setAnimation(layer.trackIndex, layer.animationName, layer.loop);
    entry.alpha = Math.min(1, Math.max(0, layer.alpha));
    entry.timeScale = 0; // we drive trackTime manually
    entry.trackTime = local;
    entry.animationLast = -1;
    entry.nextAnimationLast = -1;
    entry.trackEnd = Number.MAX_VALUE;
  }

  state.apply(skeleton);
  skeleton.updateWorldTransform(Physics.update);
}

function setupCamera(
  renderer: SceneRenderer,
  canvas: HTMLCanvasElement,
  offset: Vector2,
  size: Vector2,
  userScale: number,
) {
  const centerX = offset.x + size.x / 2;
  const centerY = offset.y + size.y / 2;
  renderer.camera.position.x = centerX;
  renderer.camera.position.y = centerY;
  renderer.camera.near = -1024;
  renderer.camera.far = 1024;
  renderer.camera.viewportWidth = canvas.width / userScale;
  renderer.camera.viewportHeight = canvas.height / userScale;
  renderer.camera.update();
}

function measureMixedBounds(
  skeleton: Skeleton,
  state: AnimationState,
  layers: TrackLayer[],
  skinName: string,
  duration: number,
  missing: string[],
): { offset: Vector2; size: Vector2 } {
  const offset = new Vector2();
  const size = new Vector2();
  const tmpO = new Vector2();
  const tmpS = new Vector2();
  let has = false;

  const steps = duration <= 0 ? 1 : Math.min(16, Math.max(4, Math.ceil(duration * 10)));
  for (let i = 0; i < steps; i++) {
    const t = duration <= 0 ? 0 : (i / Math.max(steps - 1, 1)) * duration;
    applyTracksAtTime(skeleton, state, layers, t, skinName);
    stripMissingAttachments(skeleton, missing);
    skeleton.updateWorldTransform(Physics.update);
    skeleton.getBounds(tmpO, tmpS, []);
    if (tmpS.x < 1 || tmpS.y < 1) continue;
    if (!has) {
      offset.set(tmpO.x, tmpO.y);
      size.set(tmpS.x, tmpS.y);
      has = true;
      continue;
    }
    const minX = Math.min(offset.x, tmpO.x);
    const minY = Math.min(offset.y, tmpO.y);
    const maxX = Math.max(offset.x + size.x, tmpO.x + tmpS.x);
    const maxY = Math.max(offset.y + size.y, tmpO.y + tmpS.y);
    offset.set(minX, minY);
    size.set(maxX - minX, maxY - minY);
  }

  if (!has || size.x < 1 || size.y < 1) {
    offset.set(-50, -50);
    size.set(100, 100);
  }
  return { offset, size };
}

export type TrackExportProgress = {
  currentFrame: number;
  totalFrames: number;
  message: string;
};

export async function exportMixedTracks(
  job: SkeletonJob,
  assets: AssetFiles,
  layers: TrackLayer[],
  settings: TrackExportSettings,
  onProgress: (p: TrackExportProgress) => void,
): Promise<void> {
  const active = layers.filter((l) => l.animationName);
  if (active.length === 0) throw new Error('Add at least one track with an animation');

  const canvas = document.createElement('canvas');
  canvas.width = settings.canvasWidth;
  canvas.height = settings.canvasHeight;

  const context = new ManagedWebGLRenderingContext(canvas, {
    alpha: true,
    premultipliedAlpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  const gl = context.gl;
  if (!gl) throw new Error('WebGL unavailable');

  const assetManager = new AssetManager(context);
  const renderer = new SceneRenderer(canvas, context, false);

  try {
    const allowMissing =
      settings.ignoreMissingAssets ||
      job.missingImagePaths.length > 0 ||
      job.status === 'missing-assets';

    const { skeletonData, injectedMissingPaths } = await loadSkeletonFromJob(
      job,
      assets,
      assetManager,
      allowMissing,
    );
    const missing = [...new Set([...job.missingImagePaths, ...injectedMissingPaths])];
    const skeleton = new Skeleton(skeletonData);
    const skinName = job.selectedSkin || skeletonData.skins[0]?.name || 'default';
    skeleton.setSkinByName(skinName);

    for (const layer of active) {
      if (!skeletonData.findAnimation(layer.animationName)) {
        throw new Error(`Animation “${layer.animationName}” not found on track ${layer.trackIndex}`);
      }
    }

    const state = new AnimationState(new AnimationStateData(skeletonData));
    const duration = Math.max(settings.duration, 0);
    const { offset, size } = measureMixedBounds(
      skeleton,
      state,
      active,
      skinName,
      duration,
      missing,
    );
    setupCamera(renderer, canvas, offset, size, settings.scale > 0 ? settings.scale : 1);

    const fps = settings.fps > 0 ? settings.fps : 30;
    const frameCount = settings.firstFrameOnly
      ? 1
      : duration <= 0
        ? 1
        : Math.max(1, Math.ceil(duration * fps));

    const bg = settings.transparentBackground
      ? { r: 0, g: 0, b: 0, a: 0 }
      : hexToRgba(settings.backgroundColor);

    const zip = new JSZip();
    const folder = zip.folder(sanitizeFolderName(`${job.name}_tracks`));
    if (!folder) throw new Error('Failed to create ZIP folder');

    const template =
      settings.namingPattern === 'custom'
        ? settings.customNaming || '{name}_tracks_{####}'
        : settings.namingPattern;

    const trackLabel = active
      .map((l) => `t${l.trackIndex}-${l.animationName}`)
      .join('+');

    for (let i = 0; i < frameCount; i++) {
      const time =
        settings.firstFrameOnly || frameCount <= 1 || duration <= 0
          ? 0
          : Math.min(i / fps, duration);

      applyTracksAtTime(skeleton, state, active, time, skinName);
      if (missing.length) {
        stripMissingAttachments(skeleton, missing);
        skeleton.updateWorldTransform(Physics.update);
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(bg.r, bg.g, bg.b, bg.a);
      gl.clear(gl.COLOR_BUFFER_BIT);
      renderer.begin();
      renderer.drawSkeleton(skeleton, settings.premultipliedAlpha);
      renderer.end();
      gl.finish();

      const blob = canvasToPngBlobSync(canvas);
      const frameNumber = i + 1;
      const baseName = formatFrameName(template, {
        name: job.name,
        anim: trackLabel,
        frame: frameNumber,
        index: i,
        paddingDigits: settings.paddingDigits,
      });
      folder.file(`${baseName}.png`, blob);

      onProgress({
        currentFrame: frameNumber,
        totalFrames: frameCount,
        message: `Mixed tracks · frame ${frameNumber}/${frameCount}`,
      });
      await new Promise((r) => setTimeout(r, 0));
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    await downloadBlob(zipBlob, `${sanitizeFolderName(job.name)}_tracks.zip`);
  } finally {
    renderer.dispose();
    assetManager.dispose();
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  }
}
