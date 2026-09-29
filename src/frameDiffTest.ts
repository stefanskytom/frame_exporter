/**
 * Dev-only WebGL test: bake walk frames with the same path as export and compare hashes.
 */
import {
  AtlasAttachmentLoader,
  MixBlend,
  MixDirection,
  Physics,
  RegionAttachment,
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

const logEl = document.getElementById('log')!;
const framesEl = document.getElementById('frames')!;

function log(msg: string, cls?: string) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.appendChild(line);
}

async function sha1Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function canvasToPngBlobSync(canvas: HTMLCanvasElement): Blob {
  const dataUrl = canvas.toDataURL('image/png');
  const comma = dataUrl.indexOf(',');
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

async function fileToDataUri(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function countNonClear(gl: WebGLRenderingContext, w: number, h: number, clear: number[]): number {
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (
      pixels[i] !== clear[0] ||
      pixels[i + 1] !== clear[1] ||
      pixels[i + 2] !== clear[2]
    ) {
      n += 1;
    }
  }
  return n;
}

async function main() {
  logEl.textContent = '';
  log('start');
  const base = '/test-fixtures/spineboy';
  const [jsonRes, atlasRes, pngRes] = await Promise.all([
    fetch(`${base}/spineboy-pro.json`),
    fetch(`${base}/spineboy.atlas`),
    fetch(`${base}/spineboy.png`),
  ]);
  if (!jsonRes.ok || !atlasRes.ok || !pngRes.ok) {
    throw new Error('Missing fixtures');
  }

  const jsonText = await jsonRes.text();
  const atlasText = await atlasRes.text();
  const pngBlob = await pngRes.blob();

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = new ManagedWebGLRenderingContext(canvas, {
    alpha: true,
    premultipliedAlpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  const gl = context.gl;
  if (!gl) throw new Error('No WebGL');

  const assetManager = new AssetManager(context);
  const atlasPath = 'spineboy.atlas';
  const jsonPath = 'spineboy-pro.json';
  const pngName = 'spineboy.png';

  assetManager.setRawDataURI(atlasPath, `data:text/plain,${encodeURIComponent(atlasText)}`);
  assetManager.setRawDataURI(jsonPath, `data:text/plain,${encodeURIComponent(jsonText)}`);
  assetManager.setRawDataURI(pngName, await fileToDataUri(pngBlob));

  assetManager.loadTextureAtlas(atlasPath);
  assetManager.loadText(jsonPath);
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (!assetManager.isLoadingComplete()) {
        window.setTimeout(tick, 16);
        return;
      }
      if (assetManager.hasErrors()) {
        reject(new Error(JSON.stringify(assetManager.getErrors())));
        return;
      }
      resolve();
    };
    tick();
  });
  log('assets loaded');

  const atlas = assetManager.require(atlasPath) as TextureAtlas;
  const skeletonData = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
    assetManager.require(jsonPath),
  );
  const skeleton = new Skeleton(skeletonData);
  const animation = skeletonData.findAnimation('walk')!;
  const skinName = skeletonData.skins[0]?.name || 'default';
  const renderer = new SceneRenderer(canvas, context);

  skeleton.setSkinByName(skinName);
  skeleton.setToSetupPose();
  skeleton.updateWorldTransform(Physics.update);

  let regionOk = 0;
  let regionFail = 0;
  for (const slot of skeleton.slots) {
    const att = slot.getAttachment();
    if (!att) continue;
    if (att instanceof RegionAttachment) regionOk += 1;
    else if (att.constructor.name === 'RegionAttachment') regionFail += 1;
  }
  log(`instanceof RegionAttachment ok=${regionOk} mismatch=${regionFail}`);

  const offset = new Vector2();
  const size = new Vector2();
  skeleton.getBounds(offset, size, []);
  renderer.camera.position.x = offset.x + size.x / 2;
  renderer.camera.position.y = offset.y + size.y / 2;
  renderer.camera.viewportWidth = Math.max(size.x * 1.15, 1);
  renderer.camera.viewportHeight = Math.max(size.y * 1.15, 1);
  renderer.camera.update();

  const times = [0, 0.25, 0.5, 0.75];
  const hashes: string[] = [];
  const clear = [255, 0, 255];

  for (const t of times) {
    skeleton.setSkinByName(skinName);
    skeleton.setToSetupPose();
    animation.apply(skeleton, -1, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
    skeleton.updateWorldTransform(Physics.update);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(1, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.begin();
    renderer.drawSkeleton(skeleton, false);
    renderer.end();
    gl.finish();

    const drawn = countNonClear(gl, canvas.width, canvas.height, clear);
    const blob = canvasToPngBlobSync(canvas);
    const buf = await blob.arrayBuffer();
    const hash = await sha1Hex(buf);
    hashes.push(hash);

    const img = document.createElement('img');
    img.width = 128;
    img.height = 128;
    img.src = URL.createObjectURL(blob);
    img.title = `t=${t} ${hash.slice(0, 8)}`;
    framesEl.appendChild(img);

    log(`t=${t.toFixed(2)} hash=${hash.slice(0, 12)}… drawnPx=${drawn} size=${buf.byteLength}`);
  }

  const unique = new Set(hashes);
  if (unique.size < 2) {
    log(`FAIL: only ${unique.size} unique frame(s)`, 'fail');
    document.title = 'FAIL frame-diff';
    (window as unknown as { __FRAME_DIFF_RESULT__: string }).__FRAME_DIFF_RESULT__ = 'fail';
  } else {
    log(`OK: ${unique.size}/${hashes.length} unique rendered frames`, 'ok');
    document.title = 'OK frame-diff';
    (window as unknown as { __FRAME_DIFF_RESULT__: string }).__FRAME_DIFF_RESULT__ = 'ok';
  }

  renderer.dispose();
  assetManager.dispose();
}

main().catch((e) => {
  log(String(e), 'fail');
  document.title = 'FAIL frame-diff';
  (window as unknown as { __FRAME_DIFF_RESULT__: string }).__FRAME_DIFF_RESULT__ = 'fail';
});
