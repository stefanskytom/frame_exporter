import type { AssetFiles, AssetMode, SkeletonJob } from '../types';

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

function normalizeKey(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function stemOf(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function addKey(map: Map<string, File>, key: string, file: File) {
  const k = normalizeKey(key);
  if (!k) return;
  if (!map.has(k)) map.set(k, file);
}

export function createAssetFiles(files: FileList | File[]): AssetFiles {
  const byKey = new Map<string, File>();
  const list = Array.from(files);

  for (const file of list) {
    const rel =
      'webkitRelativePath' in file && file.webkitRelativePath
        ? file.webkitRelativePath
        : file.name;

    addKey(byKey, file.name, file);
    addKey(byKey, stemOf(file.name), file);
    addKey(byKey, rel, file);
    addKey(byKey, stemOf(rel), file);

    // Also index by path without leading folder segments commonly used in Spine
    const parts = normalizeKey(rel).split('/');
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/');
      addKey(byKey, suffix, file);
      addKey(byKey, stemOf(suffix), file);
    }
  }

  return { byKey, files: list };
}

export function mergeAssetFiles(a: AssetFiles, b: AssetFiles): AssetFiles {
  const byKey = new Map(a.byKey);
  for (const [k, v] of b.byKey) {
    if (!byKey.has(k)) byKey.set(k, v);
  }
  const seen = new Set<string>();
  const files: File[] = [];
  for (const f of [...a.files, ...b.files]) {
    const id = `${f.name}:${f.size}:${f.lastModified}:${('webkitRelativePath' in f && f.webkitRelativePath) || ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    files.push(f);
  }
  return { byKey, files };
}

export function findAssetFile(assets: AssetFiles, path: string): File | null {
  const raw = normalizeKey(path);
  const candidates = [
    raw,
    stemOf(raw),
    `${raw}.png`,
    `${raw}.jpg`,
    `${raw}.jpeg`,
    `${raw}.webp`,
    raw.split('/').pop() ?? raw,
    stemOf(raw.split('/').pop() ?? raw),
  ];

  for (const c of candidates) {
    const hit = assets.byKey.get(normalizeKey(c));
    if (hit) return hit;
  }
  return null;
}

/** Parse atlas text for page image filenames (lines before `size:`). */
export function parseAtlasImageNames(atlasText: string): string[] {
  const images: string[] = [];
  const lines = atlasText.split(/\r?\n/);
  let expectingPageName = true;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      expectingPageName = true;
      continue;
    }
    if (expectingPageName && !line.includes(':')) {
      images.push(line);
      expectingPageName = false;
      continue;
    }
    if (
      line.startsWith('size:') ||
      line.startsWith('format:') ||
      line.startsWith('filter:') ||
      line.startsWith('repeat:') ||
      line.startsWith('pma:')
    ) {
      expectingPageName = false;
    }
  }

  return images;
}

export function guessAtlasName(jsonFileName: string, assets: AssetFiles): string | null {
  const stem = jsonFileName.replace(/\.json$/i, '');
  const candidates = [
    `${stem}.atlas`,
    `${stem}.atlas.txt`,
    stem.replace(/-pro$/i, '').replace(/-ess$/i, '') + '.atlas',
    stem.replace(/-pro$/i, '-pma').replace(/-ess$/i, '-pma') + '.atlas',
    `${stem}-pma.atlas`,
  ];

  for (const c of candidates) {
    const hit = findAssetFile(assets, c);
    if (hit && /\.atlas(\.txt)?$/i.test(hit.name)) return hit.name;
  }

  const atlases = assets.files.filter((f) => /\.atlas(\.txt)?$/i.test(f.name));
  if (atlases.length === 1) return atlases[0].name;

  return null;
}

export async function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function textToDataUri(text: string): string {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
}

export async function readTextFile(file: File): Promise<string> {
  return file.text();
}

export function listAnimationsFromJson(jsonText: string): string[] {
  try {
    const data = JSON.parse(jsonText) as { animations?: Record<string, unknown> };
    if (!data.animations || typeof data.animations !== 'object') return [];
    return Object.keys(data.animations);
  } catch {
    return [];
  }
}

/** Spine 4.x: skins is an array of { name, attachments }. Older: object keyed by name. */
export function listSkinsFromJson(jsonText: string): string[] {
  try {
    const data = JSON.parse(jsonText) as {
      skins?: Array<{ name?: string }> | Record<string, unknown>;
    };
    if (!data.skins) return ['default'];

    if (Array.isArray(data.skins)) {
      const names = data.skins
        .map((s) => (typeof s?.name === 'string' && s.name.length > 0 ? s.name : null))
        .filter((n): n is string => Boolean(n));
      return names.length > 0 ? names : ['default'];
    }

    if (typeof data.skins === 'object') {
      const names = Object.keys(data.skins);
      return names.length > 0 ? names : ['default'];
    }

    return ['default'];
  } catch {
    return ['default'];
  }
}

export function pickDefaultSkin(skins: string[]): string {
  if (skins.includes('default')) return 'default';
  return skins[0] ?? 'default';
}

export function getImagesPathFromJson(jsonText: string): string {
  try {
    const data = JSON.parse(jsonText) as { skeleton?: { images?: string } };
    return data.skeleton?.images ?? './images/';
  } catch {
    return './images/';
  }
}

/** Attachment texture paths used by AtlasAttachmentLoader / image folder exports. */
export function collectAttachmentPaths(jsonText: string): string[] {
  try {
    const data = JSON.parse(jsonText) as {
      skins?: Array<{
        attachments?: Record<string, Record<string, { path?: string; type?: string; name?: string } | string>>;
      }>;
    };
    const paths = new Set<string>();
    for (const skin of data.skins ?? []) {
      const slots = skin.attachments ?? {};
      for (const attachments of Object.values(slots)) {
        for (const [attachmentName, value] of Object.entries(attachments)) {
          if (!value || typeof value === 'string') continue;
          const type = value.type ?? 'region';
          if (type === 'boundingbox' || type === 'path' || type === 'point' || type === 'clipping') {
            continue;
          }
          // linkedmesh still has its own path for region lookup in some exports;
          // parent mesh path is under `parent` but region comes from path/name.
          const path = value.path ?? attachmentName;
          if (path) paths.add(path);
        }
      }
    }
    return [...paths];
  } catch {
    return [];
  }
}

export async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to read image ${file.name}`));
      img.src = url;
    });
    return { width: img.naturalWidth || 1, height: img.naturalHeight || 1 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function resolveImageFile(
  assets: AssetFiles,
  attachmentPath: string,
  imagesPath: string,
): File | null {
  const prefix = normalizeKey(imagesPath).replace(/\/?$/, '/');
  const candidates = [
    attachmentPath,
    `${attachmentPath}.png`,
    `${prefix}${attachmentPath}`,
    `${prefix}${attachmentPath}.png`,
    `images/${attachmentPath}`,
    `images/${attachmentPath}.png`,
  ];
  for (const c of candidates) {
    const hit = findAssetFile(assets, c);
    if (hit && IMAGE_EXT.test(hit.name)) return hit;
  }
  // Last resort: any image whose stem matches
  const stem = stemOf(attachmentPath.split('/').pop() ?? attachmentPath).toLowerCase();
  for (const file of assets.files) {
    if (IMAGE_EXT.test(file.name) && stemOf(file.name).toLowerCase() === stem) return file;
  }
  return null;
}

export function buildSyntheticAtlasText(
  regions: Array<{ regionName: string; pageFileName: string; width: number; height: number }>,
): string {
  const chunks: string[] = [];
  for (const region of regions) {
    chunks.push(region.pageFileName);
    chunks.push(`size:${region.width},${region.height}`);
    chunks.push('format:RGBA8888');
    chunks.push('filter:Linear,Linear');
    chunks.push('repeat:none');
    chunks.push(region.regionName);
    chunks.push(`bounds:0,0,${region.width},${region.height}`);
    chunks.push('');
  }
  return chunks.join('\n');
}

function resolveJobAssets(
  fileName: string,
  jsonText: string,
  assets: AssetFiles,
): Pick<
  SkeletonJob,
  | 'assetMode'
  | 'atlasFileName'
  | 'imagesPath'
  | 'requiredImagePaths'
  | 'missingImagePaths'
  | 'status'
  | 'error'
> {
  const imagesPath = getImagesPathFromJson(jsonText);
  const requiredImagePaths = collectAttachmentPaths(jsonText);
  const atlasFileName = guessAtlasName(fileName, assets);

  if (atlasFileName) {
    return {
      assetMode: 'atlas' as AssetMode,
      atlasFileName,
      imagesPath,
      requiredImagePaths,
      missingImagePaths: [],
      status: 'ready',
      error: undefined,
    };
  }

  // Image-folder mode (typical Spine export without packing)
  const missingImagePaths: string[] = [];
  for (const path of requiredImagePaths) {
    if (!resolveImageFile(assets, path, imagesPath)) missingImagePaths.push(path);
  }

  const hasAnyImages = assets.files.some((f) => IMAGE_EXT.test(f.name));

  if (requiredImagePaths.length === 0) {
    return {
      assetMode: 'images',
      atlasFileName: null,
      imagesPath,
      requiredImagePaths,
      missingImagePaths: [],
      status: hasAnyImages || assets.files.length === 0 ? (assets.files.length === 0 ? 'missing-assets' : 'ready') : 'ready',
      error:
        assets.files.length === 0
          ? 'Select the folder with PNG images used by this JSON'
          : undefined,
    };
  }

  if (missingImagePaths.length === 0) {
    return {
      assetMode: 'images',
      atlasFileName: null,
      imagesPath,
      requiredImagePaths,
      missingImagePaths: [],
      status: 'ready',
      error: undefined,
    };
  }

  if (!hasAnyImages) {
    return {
      assetMode: 'images',
      atlasFileName: null,
      imagesPath,
      requiredImagePaths,
      missingImagePaths,
      status: 'missing-assets',
      error:
        'This JSON does not use an .atlas — select a folder with individual PNG images (e.g. images/).',
    };
  }

  const preview = missingImagePaths.slice(0, 5).join(', ');
  const more = missingImagePaths.length > 5 ? ` (+${missingImagePaths.length - 5})` : '';
  return {
    assetMode: 'images',
    atlasFileName: null,
    imagesPath,
    requiredImagePaths,
    missingImagePaths,
    status: 'missing-assets',
    error: `Missing ${missingImagePaths.length} images: ${preview}${more}`,
  };
}

export async function buildSkeletonJobs(
  jsonFiles: File[],
  assets: AssetFiles,
): Promise<SkeletonJob[]> {
  const jobs: SkeletonJob[] = [];

  for (const file of jsonFiles) {
    const id = `${file.name}-${file.size}-${file.lastModified}`;
    try {
      const jsonText = await readTextFile(file);
      const animations = listAnimationsFromJson(jsonText);
      const skins = listSkinsFromJson(jsonText);
      const name = file.name.replace(/\.json$/i, '');
      const resolved = resolveJobAssets(file.name, jsonText, assets);

      jobs.push({
        id,
        file,
        name,
        jsonText,
        animations,
        selectedAnimation: animations[0] ?? '',
        skins,
        selectedSkin: pickDefaultSkin(skins),
        ...resolved,
      });
    } catch (e) {
      jobs.push({
        id,
        file,
        name: file.name.replace(/\.json$/i, ''),
        jsonText: '',
        animations: [],
        selectedAnimation: '',
        skins: [],
        selectedSkin: '',
        assetMode: 'images',
        atlasFileName: null,
        imagesPath: './images/',
        requiredImagePaths: [],
        missingImagePaths: [],
        status: 'error',
        error: e instanceof Error ? e.message : 'Failed to read JSON',
      });
    }
  }

  return jobs;
}

export function refreshJobsWithAssets(jobs: SkeletonJob[], assets: AssetFiles): SkeletonJob[] {
  return jobs.map((job) => {
    if (job.status === 'error' && !job.jsonText) return job;
    const resolved = resolveJobAssets(job.file.name, job.jsonText, assets);
    return { ...job, ...resolved };
  });
}

export function listAtlasOptions(assets: AssetFiles): string[] {
  return assets.files
    .filter((f) => /\.atlas(\.txt)?$/i.test(f.name))
    .map((f) => f.name)
    .sort((a, b) => a.localeCompare(b));
}

export function countAssetStats(assets: AssetFiles) {
  let atlasCount = 0;
  let imageCount = 0;
  for (const file of assets.files) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.atlas') || name.endsWith('.atlas.txt')) atlasCount += 1;
    else if (IMAGE_EXT.test(name)) imageCount += 1;
  }
  return { total: assets.files.length, atlasCount, imageCount };
}
