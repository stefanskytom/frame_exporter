import {
  Animation,
  AtlasAttachmentLoader,
  MeshAttachment,
  MixBlend,
  MixDirection,
  Physics,
  RegionAttachment,
  Skeleton,
  SkeletonData,
  SkeletonJson,
  TextureAtlas,
  TextureAtlasRegion,
  Vector2,
  type Skin,
} from '@esotericsoftware/spine-core';
import { Sequence } from '@esotericsoftware/spine-core/dist/attachments/Sequence.js';
import {
  AssetManager,
  ManagedWebGLRenderingContext,
  SceneRenderer,
} from '@esotericsoftware/spine-webgl';
import JSZip from 'jszip';
import {
  buildSyntheticAtlasText,
  collectAttachmentPaths,
  fileToDataUri,
  findAssetFile,
  parseAtlasImageNames,
  readImageSize,
  readTextFile,
  resolveImageFile,
  textToDataUri,
} from './assets';
import { downloadBlob } from './download';
import { formatFrameName, resolveNamingTemplate, sanitizeFolderName } from './naming';
import type {
  AssetFiles,
  ExportProgress,
  ExportSettings,
  SkeletonJob,
} from '../types';

/** 1×1 transparent PNG used when exporting with ignoreMissingAssets. */
const TRANSPARENT_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Inject a 1×1 region so SkeletonJson can load when frames/regions are missing. */
function ensurePlaceholderRegion(atlas: TextureAtlas, name: string): TextureAtlasRegion {
  const existing = atlas.findRegion(name);
  if (existing) return existing;

  const page = atlas.pages[0];
  if (!page) {
    throw new Error(`Cannot create placeholder region "${name}": atlas has no pages`);
  }

  const region = new TextureAtlasRegion(page, name);
  region.width = 1;
  region.height = 1;
  region.originalWidth = 1;
  region.originalHeight = 1;
  region.x = 0;
  region.y = 0;
  region.u = 0;
  region.v = 0;
  region.u2 = 1 / Math.max(page.width, 1);
  region.v2 = 1 / Math.max(page.height, 1);
  region.texture = page.texture;
  atlas.regions.push(region);
  return region;
}

/**
 * Like AtlasAttachmentLoader, but when allowMissing is set, missing regions
 * (including sequence frames) become 1×1 placeholders instead of throwing.
 */
class TolerantAtlasAttachmentLoader extends AtlasAttachmentLoader {
  readonly injectedPaths: string[] = [];
  private allowMissing: boolean;

  constructor(atlas: TextureAtlas, allowMissing: boolean) {
    super(atlas);
    this.allowMissing = allowMissing;
  }

  private findOrPlaceholder(path: string): TextureAtlasRegion | null {
    const found = this.atlas.findRegion(path);
    if (found) return found;
    if (!this.allowMissing) return null;
    this.injectedPaths.push(path);
    return ensurePlaceholderRegion(this.atlas, path);
  }

  override loadSequence(name: string, basePath: string, sequence: Sequence): void {
    const regions = sequence.regions;
    for (let i = 0, n = regions.length; i < n; i++) {
      const path = sequence.getPath(basePath, i);
      const region = this.findOrPlaceholder(path);
      if (region == null) {
        throw new Error(`Region not found in atlas: ${path} (sequence: ${name})`);
      }
      regions[i] = region;
    }
  }

  override newRegionAttachment(
    _skin: Skin,
    name: string,
    path: string,
    sequence: Sequence | null,
  ): RegionAttachment {
    const attachment = new RegionAttachment(name, path);
    if (sequence != null) {
      this.loadSequence(name, path, sequence);
    } else {
      const region = this.findOrPlaceholder(path);
      if (!region) {
        throw new Error(`Region not found in atlas: ${path} (region attachment: ${name})`);
      }
      attachment.region = region;
    }
    return attachment;
  }

  override newMeshAttachment(
    _skin: Skin,
    name: string,
    path: string,
    sequence: Sequence | null,
  ): MeshAttachment {
    const attachment = new MeshAttachment(name, path);
    if (sequence != null) {
      this.loadSequence(name, path, sequence);
    } else {
      const region = this.findOrPlaceholder(path);
      if (!region) {
        throw new Error(`Region not found in atlas: ${path} (mesh attachment: ${name})`);
      }
      attachment.region = region;
    }
    return attachment;
  }
}

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
        // Prefer setTimeout over rAF — background WKWebView may pause rAF.
        window.setTimeout(tick, 16);
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

/** Synchronous PNG capture — avoids WKWebView/toBlob races that duplicate frames. */
function canvasToPngBlobSync(canvas: HTMLCanvasElement): Blob {
  const dataUrl = canvas.toDataURL('image/png');
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Failed to encode PNG frame');
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
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
  allowMissing: boolean,
): Promise<{ atlasPath: string; jsonPath: string }> {
  if (!job.atlasFileName) {
    throw new Error(`Missing atlas for ${job.name}`);
  }

  const atlasFile = findAssetFile(assets, job.atlasFileName);
  if (!atlasFile) {
    throw new Error(`Atlas file not found: ${job.atlasFileName}`);
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
      if (!allowMissing) {
        throw new Error(
          `Missing texture “${imageName}” required by ${atlasFile.name}. Add it in the assets location.`,
        );
      }
      assetManager.setRawDataURI(imageName, TRANSPARENT_PNG_DATA_URI);
      continue;
    }
    assetManager.setRawDataURI(imageName, await fileToDataUri(imageFile));
  }

  return { atlasPath, jsonPath };
}

async function prepareImagesMode(
  job: SkeletonJob,
  assets: AssetFiles,
  assetManager: AssetManager,
  allowMissing: boolean,
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

  // Prefer fresh parse so sequence frames (base+padded) are always regions.
  const attachmentPaths = [
    ...new Set([...collectAttachmentPaths(job.jsonText), ...job.requiredImagePaths]),
  ];

  for (const attachmentPath of attachmentPaths) {
    const imageFile = resolveImageFile(assets, attachmentPath, job.imagesPath);
    if (!imageFile) {
      if (!allowMissing) {
        throw new Error(`Missing image for attachment „${attachmentPath}”`);
      }
      let pageFileName = `missing__${attachmentPath.replace(/[\\/]/g, '__')}.png`;
      if (usedPageNames.has(pageFileName.toLowerCase())) {
        pageFileName = `${pageFileName}__${usedPageNames.size}`;
      }
      usedPageNames.add(pageFileName.toLowerCase());
      assetManager.setRawDataURI(pageFileName, TRANSPARENT_PNG_DATA_URI);
      regions.push({
        regionName: attachmentPath,
        pageFileName,
        width: 1,
        height: 1,
      });
      continue;
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

  if (regions.length === 0) {
    // Keep a valid atlas even when every attachment is missing/ignored.
    const pageFileName = `${job.name}__placeholder.png`;
    assetManager.setRawDataURI(pageFileName, TRANSPARENT_PNG_DATA_URI);
    regions.push({
      regionName: '__placeholder__',
      pageFileName,
      width: 1,
      height: 1,
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
  allowMissing: boolean,
): Promise<{ skeletonData: SkeletonData; injectedMissingPaths: string[] }> {
  const prepared =
    job.assetMode === 'atlas'
      ? await prepareAtlasMode(job, assets, assetManager, allowMissing)
      : await prepareImagesMode(job, assets, assetManager, allowMissing);

  const { atlasPath, jsonPath } = prepared;

  assetManager.loadTextureAtlas(atlasPath);
  assetManager.loadText(jsonPath);
  await waitForAssets(assetManager);

  const atlas = assetManager.require(atlasPath) as TextureAtlas;
  const loader = new TolerantAtlasAttachmentLoader(atlas, allowMissing);
  const skeletonJson = new SkeletonJson(loader);
  skeletonJson.scale = 1;
  const skeletonData = skeletonJson.readSkeletonData(assetManager.require(jsonPath));
  return { skeletonData, injectedMissingPaths: loader.injectedPaths };
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
    throw new Error(`No animations to export for ${job.name}`);
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
    throw new Error('WebGL is unavailable in this browser');
  }

  const assetManager = new AssetManager(context);
  const renderer = new SceneRenderer(canvas, context);

  try {
    const { skeletonData } = await loadSkeletonFromJob(
      job,
      assets,
      assetManager,
      settings.ignoreMissingAssets,
    );
    const skeleton = new Skeleton(skeletonData);

    const skinName = job.selectedSkin || skeletonData.skins[0]?.name || 'default';
    try {
      skeleton.setSkinByName(skinName);
    } catch {
      throw new Error(`Skin “${skinName}” does not exist in ${job.name}`);
    }
    skeleton.setSlotsToSetupPose();
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform(Physics.update);
    const setupBounds = getSkeletonBounds(skeleton);

    const rootFolder = zip.folder(sanitizeFolderName(job.name));
    if (!rootFolder) throw new Error('Failed to create folder in archive');

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
        throw new Error(`Animation “${animName}” does not exist in ${job.name}`);
      }

      const targetFolder = settings.exportAllAnimations
        ? rootFolder.folder(sanitizeFolderName(animName))
        : rootFolder;
      if (!targetFolder) {
        throw new Error(`Failed to create animation folder „${animName}”`);
      }

      const duration = Math.max(animation.duration, 0);
      const fps = settings.fps > 0 ? settings.fps : 30;
      const frameCount = settings.firstFrameOnly
        ? 1
        : duration <= 0
          ? 1
          : Math.max(1, Math.ceil(duration * fps));

      for (let i = 0; i < frameCount; i++) {
        const time = settings.firstFrameOnly
          ? 0
          : frameCount <= 1 || duration <= 0
            ? 0
            : Math.min(i / fps, duration);

        applyAnimationPose(skeleton, animation, time, skinName);
        if (settings.ignoreMissingAssets && job.missingImagePaths.length > 0) {
          stripMissingAttachments(skeleton, job.missingImagePaths);
          skeleton.updateWorldTransform(Physics.update);
        }

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(bg.r, bg.g, bg.b, bg.a);
        gl.clear(gl.COLOR_BUFFER_BIT);

        renderer.begin();
        renderer.drawSkeleton(skeleton, settings.premultipliedAlpha);
        renderer.end();

        // Flush + sync readback (async toBlob can repeat the same frame in WKWebView).
        gl.finish();
        const blob = canvasToPngBlobSync(canvas);
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
            ? `${job.name}/${animName}: frame ${frameNumber}/${frameCount} (${animIndex + 1}/${animNames.length})`
            : `${job.name}: frame ${frameNumber}/${frameCount}`,
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

/**
 * Bake a pose at an absolute animation time.
 * Uses Animation.apply directly (not AnimationState) so every frame is an
 * independent scrub — AnimationState mixing/trackLast can leave identical poses.
 */
function applyAnimationPose(
  skeleton: Skeleton,
  animation: Animation,
  time: number,
  skinName: string,
) {
  skeleton.setSkinByName(skinName);
  skeleton.setToSetupPose();
  const duration = Math.max(animation.duration, 0);
  const t = duration <= 0 ? 0 : Math.min(Math.max(time, 0), duration);
  // lastTime=-1 forces all timelines (incl. sequences) to evaluate up to t.
  animation.apply(skeleton, -1, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
  skeleton.updateWorldTransform(Physics.update);
}

function applyPoseAtTime(
  skeleton: Skeleton,
  animName: string,
  duration: number,
  time: number,
  skinName: string,
) {
  const animation = skeleton.data.findAnimation(animName);
  if (!animation) return;
  applyAnimationPose(
    skeleton,
    animation,
    duration <= 0 ? 0 : Math.min(Math.max(time, 0), duration),
    skinName,
  );
}

function normalizeAttachmentKey(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function attachmentKeyStem(value: string): string {
  const base = value.split('/').pop() ?? value;
  return base.replace(/\.[^.]+$/, '');
}

/** Drop slot attachments that map to missing asset paths so AABB ignores them. */
function stripMissingAttachments(skeleton: Skeleton, missingPaths: string[]) {
  if (missingPaths.length === 0) return;

  const keys = missingPaths.map(normalizeAttachmentKey);
  const stems = keys.map(attachmentKeyStem);

  const isMissingKey = (value: string) => {
    const key = normalizeAttachmentKey(value);
    const stem = attachmentKeyStem(key);
    if (keys.includes(key) || stems.includes(stem)) return true;
    // Sequence frames: missing `base00` should strip attachment with path `base`
    if (keys.some((m) => m.startsWith(key) || key.startsWith(m))) return true;
    return keys.some(
      (m) => key === m || key.endsWith(`/${m}`) || m.endsWith(`/${key}`) || stem === attachmentKeyStem(m),
    );
  };

  for (const slot of skeleton.slots) {
    const attachment = slot.getAttachment();
    if (!attachment) continue;
    const path =
      'path' in attachment && typeof (attachment as { path?: string }).path === 'string'
        ? (attachment as { path: string }).path
        : attachment.name;
    if (isMissingKey(path) || isMissingKey(attachment.name)) {
      slot.setAttachment(null);
    }
  }
}

/**
 * Measures max content AABB for the selected skin/animation(s), then applies scale.
 * Samples several times along each animation so canvas advice covers motion.
 * When assets are missing, loads with placeholders then strips those attachments
 * so the reported size reflects only present textures.
 */
export async function measureJobFrameSize(
  job: SkeletonJob,
  assets: AssetFiles,
  settings: Pick<
    ExportSettings,
    'scale' | 'exportAllAnimations' | 'canvasWidth' | 'canvasHeight' | 'ignoreMissingAssets'
  >,
): Promise<FrameSizeInfo> {
  if (job.status === 'error') {
    throw new Error(job.error || 'Job has an error');
  }

  const animNames = animationsToExport(
    job,
    settings as ExportSettings,
  );
  if (animNames.length === 0) {
    throw new Error('No animations');
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
  if (!gl) throw new Error('WebGL unavailable');

  const assetManager = new AssetManager(context);
  const allowMissing = job.missingImagePaths.length > 0 || job.status === 'missing-assets';

  try {
    const { skeletonData, injectedMissingPaths } = await loadSkeletonFromJob(
      job,
      assets,
      assetManager,
      allowMissing,
    );
    const missingForMeasure = [
      ...new Set([...job.missingImagePaths, ...injectedMissingPaths]),
    ];
    const skeleton = new Skeleton(skeletonData);
    const skinName = job.selectedSkin || skeletonData.skins[0]?.name || 'default';
    skeleton.setSkinByName(skinName);
    skeleton.setSlotsToSetupPose();
    stripMissingAttachments(skeleton, missingForMeasure);

    let maxW = 0;
    let maxH = 0;

    for (const animName of animNames) {
      const animation = skeletonData.findAnimation(animName);
      if (!animation) continue;
      const duration = Math.max(animation.duration, 0);
      const steps = duration <= 0 ? 1 : Math.min(24, Math.max(4, Math.ceil(duration * 12)));

      for (let s = 0; s < steps; s++) {
        const t = duration <= 0 ? 0 : (s / Math.max(steps - 1, 1)) * duration;
        applyPoseAtTime(skeleton, animName, duration, t, skinName);
        stripMissingAttachments(skeleton, missingForMeasure);
        const bounds = getSkeletonBounds(skeleton);
        if (bounds.size.x > maxW) maxW = bounds.size.x;
        if (bounds.size.y > maxH) maxH = bounds.size.y;
      }
    }

    if (maxW < 1 || maxH < 1) {
      skeleton.setSkinByName(skinName);
      skeleton.setSlotsToSetupPose();
      skeleton.setToSetupPose();
      stripMissingAttachments(skeleton, missingForMeasure);
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
    const missingCount = job.missingImagePaths.length;

    const sourceBase = settings.exportAllAnimations
      ? `${animNames.length} anim. · skin “${skinName}” · max AABB`
      : `“${animNames[0]}” · skin “${skinName}” · max AABB`;
    const source =
      missingCount > 0
        ? `${sourceBase} · excl. ${missingCount} missing`
        : sourceBase;

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
  if (job.status === 'error') return false;
  if (job.status === 'missing-assets' && !settings.ignoreMissingAssets) return false;
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
    throw new Error('No ready files to export');
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
      message: `Preparing ${job.name} (${job.assetMode === 'atlas' ? 'atlas' : 'images'})…`,
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
    message: 'Packing ZIP…',
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  await downloadBlob(blob, `spine-frames-${stamp}.zip`);
}
