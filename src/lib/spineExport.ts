import {
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  Physics,
  Skeleton,
  SkeletonJson,
  TextureAtlas,
  Vector2,
} from '@esotericsoftware/spine-core';
import {
  AssetManager,
  ManagedWebGLRenderingContext,
  SceneRenderer,
} from '@esotericsoftware/spine-webgl';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  buildSyntheticAtlasText,
  fileToDataUri,
  findAssetFile,
  parseAtlasImageNames,
  readImageSize,
  readTextFile,
  resolveImageFile,
  textToDataUri,
} from './assets';
import { formatFrameName, resolveNamingTemplate, sanitizeFolderName } from './naming';
import type {
  AssetFiles,
  ExportProgress,
  ExportSettings,
  SkeletonJob,
} from '../types';

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

function waitForAssets(assetManager: AssetManager): Promise<void> {
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (!assetManager.isLoadingComplete()) {
        requestAnimationFrame(tick);
        return;
      }
      if (assetManager.hasErrors()) {
        const errors = assetManager.getErrors();
        reject(new Error(Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join('; ')));
        return;
      }
      resolve();
    };
    tick();
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Nie udało się zapisać klatki PNG'));
      },
      'image/png',
    );
  });
}

interface Bounds {
  offset: Vector2;
  size: Vector2;
}

function getSkeletonBounds(skeleton: Skeleton): Bounds {
  const offset = new Vector2();
  const size = new Vector2();
  skeleton.getBounds(offset, size, []);
  return { offset, size };
}

function setupCamera(
  renderer: SceneRenderer,
  canvas: HTMLCanvasElement,
  bounds: Bounds,
  userScale: number,
) {
  const centerX = bounds.offset.x + bounds.size.x / 2;
  const centerY = bounds.offset.y + bounds.size.y / 2;

  const worldWidth = canvas.width / userScale;
  const worldHeight = canvas.height / userScale;

  renderer.camera.position.x = centerX;
  renderer.camera.position.y = centerY;
  renderer.camera.viewportWidth = worldWidth;
  renderer.camera.viewportHeight = worldHeight;
  renderer.camera.update();
}

async function prepareAtlasMode(
  job: SkeletonJob,
  assets: AssetFiles,
  assetManager: AssetManager,
): Promise<{ atlasPath: string; jsonPath: string }> {
  if (!job.atlasFileName) {
    throw new Error(`Brak atlasu dla ${job.name}`);
  }

  const atlasFile = findAssetFile(assets, job.atlasFileName);
  if (!atlasFile) {
    throw new Error(`Nie znaleziono pliku atlasu: ${job.atlasFileName}`);
  }

  const atlasText = await readTextFile(atlasFile);
  const atlasPath = atlasFile.name;
  const jsonPath = job.file.name;

  assetManager.setRawDataURI(atlasPath, await fileToDataUri(atlasFile));
  assetManager.setRawDataURI(jsonPath, await fileToDataUri(job.file));

  const imageNames = parseAtlasImageNames(atlasText);
  for (const imageName of imageNames) {
    const imageFile = findAssetFile(assets, imageName);
    if (!imageFile) {
      throw new Error(
        `Brak tekstury „${imageName}” wymaganej przez ${atlasFile.name}. Dodaj ją w lokalizacji assetów.`,
      );
    }
    assetManager.setRawDataURI(imageName, await fileToDataUri(imageFile));
  }

  return { atlasPath, jsonPath };
}

async function prepareImagesMode(
  job: SkeletonJob,
  assets: AssetFiles,
  assetManager: AssetManager,
): Promise<{ atlasPath: string; jsonPath: string }> {
  const jsonPath = job.file.name;
  const atlasPath = `${job.name}.synthetic.atlas`;

  const regions: Array<{
    regionName: string;
    pageFileName: string;
    width: number;
    height: number;
  }> = [];

  const usedPageNames = new Set<string>();

  for (const attachmentPath of job.requiredImagePaths) {
    const imageFile = resolveImageFile(assets, attachmentPath, job.imagesPath);
    if (!imageFile) {
      throw new Error(`Brak obrazu dla attachmentu „${attachmentPath}”`);
    }

    const { width, height } = await readImageSize(imageFile);
    let pageFileName = imageFile.name;
    // Avoid collisions when different folders share basename
    if (usedPageNames.has(pageFileName.toLowerCase())) {
      pageFileName = `${attachmentPath.replace(/[\\/]/g, '__')}__${imageFile.name}`;
    }
    usedPageNames.add(pageFileName.toLowerCase());

    assetManager.setRawDataURI(pageFileName, await fileToDataUri(imageFile));
    regions.push({
      regionName: attachmentPath,
      pageFileName,
      width,
      height,
    });
  }

  const atlasText = buildSyntheticAtlasText(regions);
  assetManager.setRawDataURI(atlasPath, textToDataUri(atlasText));
  assetManager.setRawDataURI(jsonPath, await fileToDataUri(job.file));

  return { atlasPath, jsonPath };
}

async function loadSkeletonFromJob(
  job: SkeletonJob,
  assets: AssetFiles,
  assetManager: AssetManager,
) {
  const prepared =
    job.assetMode === 'atlas'
      ? await prepareAtlasMode(job, assets, assetManager)
      : await prepareImagesMode(job, assets, assetManager);

  const { atlasPath, jsonPath } = prepared;

  if (job.assetMode === 'atlas') {
    assetManager.loadTextureAtlas(atlasPath);
  } else {
    // Synthetic atlas text is already in rawDataURI; loadTextureAtlas will fetch it
    // and then load page textures also from rawDataURI.
    assetManager.loadTextureAtlas(atlasPath);
  }
  assetManager.loadText(jsonPath);
  await waitForAssets(assetManager);

  const atlas = assetManager.require(atlasPath) as TextureAtlas;
  const skeletonJson = new SkeletonJson(new AtlasAttachmentLoader(atlas));
  skeletonJson.scale = 1;
  return skeletonJson.readSkeletonData(assetManager.require(jsonPath));
}

function animationsToExport(job: SkeletonJob, settings: ExportSettings): string[] {
  if (settings.exportAllAnimations) {
    return job.animations;
  }
  return job.selectedAnimation ? [job.selectedAnimation] : [];
}

async function exportSkeletonFrames(
  job: SkeletonJob,
  assets: AssetFiles,
  settings: ExportSettings,
  zip: JSZip,
  onProgress: (partial: Partial<ExportProgress>) => void,
): Promise<number> {
  const animNames = animationsToExport(job, settings);
  if (animNames.length === 0) {
    throw new Error(`Brak animacji do eksportu dla ${job.name}`);
  }

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
  if (!gl) {
    throw new Error('WebGL jest niedostępny w tej przeglądarce');
  }

  const assetManager = new AssetManager(context);
  const renderer = new SceneRenderer(canvas, context);

  try {
    const skeletonData = await loadSkeletonFromJob(job, assets, assetManager);
    const skeleton = new Skeleton(skeletonData);

    const skinName = job.selectedSkin || skeletonData.skins[0]?.name || 'default';
    try {
      skeleton.setSkinByName(skinName);
    } catch {
      throw new Error(`Skin „${skinName}” nie istnieje w ${job.name}`);
    }
    skeleton.setSlotsToSetupPose();
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform(Physics.update);
    const setupBounds = getSkeletonBounds(skeleton);

    const rootFolder = zip.folder(sanitizeFolderName(job.name));
    if (!rootFolder) throw new Error('Nie udało się utworzyć folderu w archiwum');

    const stateData = new AnimationStateData(skeletonData);
    const state = new AnimationState(stateData);
    const template = resolveNamingTemplate(settings);

    const bg = settings.transparentBackground
      ? { r: 0, g: 0, b: 0, a: 0 }
      : hexToRgba(settings.backgroundColor);

    const frameBounds =
      setupBounds.size.x >= 1 && setupBounds.size.y >= 1
        ? setupBounds
        : { offset: new Vector2(-50, -50), size: new Vector2(100, 100) };

    setupCamera(renderer, canvas, frameBounds, settings.scale);

    let exported = 0;

    for (let animIndex = 0; animIndex < animNames.length; animIndex++) {
      const animName = animNames[animIndex];
      const animation = skeletonData.findAnimation(animName);
      if (!animation) {
        throw new Error(`Animacja „${animName}” nie istnieje w ${job.name}`);
      }

      const targetFolder = settings.exportAllAnimations
        ? rootFolder.folder(sanitizeFolderName(animName))
        : rootFolder;
      if (!targetFolder) {
        throw new Error(`Nie udało się utworzyć folderu animacji „${animName}”`);
      }

      const duration = animation.duration;
      const frameCount = settings.firstFrameOnly
        ? 1
        : Math.max(1, Math.ceil(duration * settings.fps) || 1);

      for (let i = 0; i < frameCount; i++) {
        const time = settings.firstFrameOnly ? 0 : i / settings.fps;

        skeleton.setSkinByName(skinName);
        skeleton.setSlotsToSetupPose();
        skeleton.setToSetupPose();
        state.clearTracks();
        const entry = state.setAnimation(0, animName, false);
        entry.trackTime = Math.min(time, Math.max(duration - 0.0001, 0));
        entry.animationStart = 0;
        entry.animationEnd = duration;

        state.apply(skeleton);
        skeleton.updateWorldTransform(Physics.update);

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(bg.r, bg.g, bg.b, bg.a);
        gl.clear(gl.COLOR_BUFFER_BIT);

        renderer.begin();
        renderer.drawSkeleton(skeleton, settings.premultipliedAlpha);
        renderer.end();

        const blob = await canvasToBlob(canvas);
        const frameNumber = i + 1;
        const baseName = formatFrameName(template, {
          name: job.name,
          anim: animName,
          frame: frameNumber,
          index: i,
          paddingDigits: settings.paddingDigits,
        });
        targetFolder.file(`${baseName}.png`, blob);
        exported += 1;

        onProgress({
          currentSkeleton: job.name,
          currentFrame: frameNumber,
          totalFrames: frameCount,
          message: settings.exportAllAnimations
            ? `${job.name}/${animName}: klatka ${frameNumber}/${frameCount} (${animIndex + 1}/${animNames.length})`
            : `${job.name}: klatka ${frameNumber}/${frameCount}`,
        });

        await new Promise((r) => setTimeout(r, 0));
      }
    }

    return exported;
  } finally {
    renderer.dispose();
    assetManager.dispose();
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  }
}

export interface FrameSizeInfo {
  /** Unscaled content AABB in Spine units (≈px at scale 1). */
  width: number;
  height: number;
  /** After applying export scale. */
  scaledWidth: number;
  scaledHeight: number;
  /** Suggested canvas (ceil scaled size). */
  suggestedCanvasWidth: number;
  suggestedCanvasHeight: number;
  fitsCanvas: boolean;
  source: string;
}

function ceilPx(n: number): number {
  return Math.max(1, Math.ceil(n));
}

function applyPoseAtTime(
  skeleton: Skeleton,
  state: AnimationState,
  animName: string,
  duration: number,
  time: number,
  skinName: string,
) {
  skeleton.setSkinByName(skinName);
  skeleton.setSlotsToSetupPose();
  skeleton.setToSetupPose();
  state.clearTracks();
  const entry = state.setAnimation(0, animName, false);
  entry.trackTime = Math.min(Math.max(time, 0), Math.max(duration - 0.0001, 0));
  entry.animationStart = 0;
  entry.animationEnd = duration;
  state.apply(skeleton);
  skeleton.updateWorldTransform(Physics.update);
}

/**
 * Measures max content AABB for the selected skin/animation(s), then applies scale.
 * Samples several times along each animation so canvas advice covers motion.
 */
export async function measureJobFrameSize(
  job: SkeletonJob,
  assets: AssetFiles,
  settings: Pick<
    ExportSettings,
    'scale' | 'exportAllAnimations' | 'canvasWidth' | 'canvasHeight'
  >,
): Promise<FrameSizeInfo> {
  if (job.status !== 'ready') {
    throw new Error('Job nie jest gotowy');
  }

  const animNames = animationsToExport(
    job,
    settings as ExportSettings,
  );
  if (animNames.length === 0) {
    throw new Error('Brak animacji');
  }

  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;

  const context = new ManagedWebGLRenderingContext(canvas, {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  const gl = context.gl;
  if (!gl) throw new Error('WebGL niedostępny');

  const assetManager = new AssetManager(context);

  try {
    const skeletonData = await loadSkeletonFromJob(job, assets, assetManager);
    const skeleton = new Skeleton(skeletonData);
    const skinName = job.selectedSkin || skeletonData.skins[0]?.name || 'default';
    skeleton.setSkinByName(skinName);
    skeleton.setSlotsToSetupPose();

    const state = new AnimationState(new AnimationStateData(skeletonData));

    let maxW = 0;
    let maxH = 0;

    for (const animName of animNames) {
      const animation = skeletonData.findAnimation(animName);
      if (!animation) continue;
      const duration = Math.max(animation.duration, 0);
      const steps = duration <= 0 ? 1 : Math.min(24, Math.max(4, Math.ceil(duration * 12)));

      for (let s = 0; s < steps; s++) {
        const t = duration <= 0 ? 0 : (s / Math.max(steps - 1, 1)) * duration;
        applyPoseAtTime(skeleton, state, animName, duration, t, skinName);
        const bounds = getSkeletonBounds(skeleton);
        if (bounds.size.x > maxW) maxW = bounds.size.x;
        if (bounds.size.y > maxH) maxH = bounds.size.y;
      }
    }

    if (maxW < 1 || maxH < 1) {
      skeleton.setSkinByName(skinName);
      skeleton.setSlotsToSetupPose();
      skeleton.setToSetupPose();
      skeleton.updateWorldTransform(Physics.update);
      const bounds = getSkeletonBounds(skeleton);
      maxW = Math.max(maxW, bounds.size.x);
      maxH = Math.max(maxH, bounds.size.y);
    }

    const scale = settings.scale > 0 ? settings.scale : 1;
    const scaledWidth = maxW * scale;
    const scaledHeight = maxH * scale;
    const suggestedCanvasWidth = ceilPx(scaledWidth);
    const suggestedCanvasHeight = ceilPx(scaledHeight);

    const source = settings.exportAllAnimations
      ? `${animNames.length} anim. · skin „${skinName}” · max AABB`
      : `„${animNames[0]}” · skin „${skinName}” · max AABB`;

    return {
      width: maxW,
      height: maxH,
      scaledWidth,
      scaledHeight,
      suggestedCanvasWidth,
      suggestedCanvasHeight,
      fitsCanvas:
        suggestedCanvasWidth <= settings.canvasWidth &&
        suggestedCanvasHeight <= settings.canvasHeight,
      source,
    };
  } finally {
    assetManager.dispose();
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  }
}

export function isJobExportable(job: SkeletonJob, settings: ExportSettings): boolean {
  if (job.status !== 'ready') return false;
  if (settings.exportAllAnimations) return job.animations.length > 0;
  return Boolean(job.selectedAnimation);
}

export async function exportAllJobs(
  jobs: SkeletonJob[],
  assets: AssetFiles,
  settings: ExportSettings,
  onProgress: (progress: ExportProgress) => void,
): Promise<void> {
  const ready = jobs.filter((j) => isJobExportable(j, settings));
  if (ready.length === 0) {
    throw new Error('Brak gotowych plików do eksportu');
  }

  const zip = new JSZip();
  let skeletonIndex = 0;

  for (const job of ready) {
    skeletonIndex += 1;
    onProgress({
      currentSkeleton: job.name,
      currentFrame: 0,
      totalFrames: 0,
      skeletonIndex,
      skeletonTotal: ready.length,
      message: `Przygotowywanie ${job.name} (${job.assetMode === 'atlas' ? 'atlas' : 'obrazy'})…`,
    });

    await exportSkeletonFrames(job, assets, settings, zip, (partial) => {
      onProgress({
        currentSkeleton: job.name,
        currentFrame: partial.currentFrame ?? 0,
        totalFrames: partial.totalFrames ?? 0,
        skeletonIndex,
        skeletonTotal: ready.length,
        message: partial.message ?? job.name,
      });
    });
  }

  onProgress({
    currentSkeleton: '',
    currentFrame: 0,
    totalFrames: 0,
    skeletonIndex: ready.length,
    skeletonTotal: ready.length,
    message: 'Pakowanie ZIP…',
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  saveAs(blob, `spine-frames-${stamp}.zip`);
}
