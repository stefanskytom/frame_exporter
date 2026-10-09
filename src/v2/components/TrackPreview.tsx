import { useEffect, useRef, useState } from 'react';
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
import { loadSkeletonFromJob, stripMissingAttachments } from '../../lib/spineExport';
import { acquirePreviewGlSlot, PREVIEW_SIZE } from '../../lib/previewGl';
import type { AssetFiles, SkeletonJob } from '../../types';
import { applyTracksAtTime } from '../trackExport';
import { suggestDuration, type TrackLayer } from '../types';

interface Props {
  job: SkeletonJob;
  assets: AssetFiles;
  layers: TrackLayer[];
  skinName: string;
  ignoreMissingAssets: boolean;
  /** Fired after skeleton load with one full mix cycle length (seconds). */
  onCycleDuration?: (seconds: number) => void;
}

function fitCamera(
  renderer: SceneRenderer,
  canvas: HTMLCanvasElement,
  offset: Vector2,
  size: Vector2,
) {
  const pad = 1.15;
  const w = Math.max(size.x, 1);
  const h = Math.max(size.y, 1);
  const contentAspect = w / h;
  const canvasAspect = canvas.width / Math.max(canvas.height, 1);
  let viewportWidth: number;
  let viewportHeight: number;
  if (contentAspect > canvasAspect) {
    viewportWidth = w * pad;
    viewportHeight = viewportWidth / canvasAspect;
  } else {
    viewportHeight = h * pad;
    viewportWidth = viewportHeight * canvasAspect;
  }
  renderer.camera.position.x = offset.x + w / 2;
  renderer.camera.position.y = offset.y + h / 2;
  renderer.camera.near = -1024;
  renderer.camera.far = 1024;
  renderer.camera.viewportWidth = viewportWidth;
  renderer.camera.viewportHeight = viewportHeight;
  renderer.camera.update();
}

function sampleBounds(
  skeleton: Skeleton,
  state: AnimationState,
  layers: TrackLayer[],
  skin: string,
  duration: number,
  missing: string[],
): { offset: Vector2; size: Vector2 } {
  const offset = new Vector2();
  const size = new Vector2();
  const tmpO = new Vector2();
  const tmpS = new Vector2();
  let has = false;
  const steps = Math.min(12, Math.max(4, Math.ceil(Math.max(duration, 0.1) * 8)));
  for (let i = 0; i < steps; i++) {
    const t = (i / Math.max(steps - 1, 1)) * Math.max(duration, 0);
    applyTracksAtTime(skeleton, state, layers, t, skin);
    stripMissingAttachments(skeleton, missing);
    skeleton.updateWorldTransform(Physics.update);
    skeleton.getBounds(tmpO, tmpS, []);
    if (tmpS.x < 1 || tmpS.y < 1) continue;
    if (!has) {
      offset.set(tmpO.x, tmpO.y);
      size.set(tmpS.x, tmpS.y);
      has = true;
    } else {
      const minX = Math.min(offset.x, tmpO.x);
      const minY = Math.min(offset.y, tmpO.y);
      const maxX = Math.max(offset.x + size.x, tmpO.x + tmpS.x);
      const maxY = Math.max(offset.y + size.y, tmpO.y + tmpS.y);
      offset.set(minX, minY);
      size.set(maxX - minX, maxY - minY);
    }
  }
  if (!has) {
    offset.set(-50, -50);
    size.set(100, 100);
  }
  return { offset, size };
}

export function TrackPreview({
  job,
  assets,
  layers,
  skinName,
  ignoreMissingAssets,
  onCycleDuration,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const onCycleDurationRef = useRef(onCycleDuration);
  onCycleDurationRef.current = onCycleDuration;

  const allowMissing =
    ignoreMissingAssets || job.missingImagePaths.length > 0 || job.status === 'missing-assets';

  const reloadKey = [
    job.id,
    job.status,
    layers
      .map(
        (l) =>
          `${l.trackIndex}:${l.animationName}:${l.loop}:${l.delay}:${l.timeScale}:${l.alpha}`,
      )
      .join('|'),
    skinName,
    allowMissing ? '1' : '0',
    assets.files.length,
  ].join('||');

  useEffect(() => {
    const can = job.status === 'ready' || job.status === 'missing-assets';
    if (!can || !layers.some((l) => l.animationName)) {
      setStatus('error');
      setError('Select animations on tracks to preview');
      return;
    }

    let cancelled = false;
    let raf = 0;
    let release: (() => void) | null = null;
    let context: ManagedWebGLRenderingContext | null = null;
    let assetManager: AssetManager | null = null;
    let renderer: SceneRenderer | null = null;

    const teardown = () => {
      cancelAnimationFrame(raf);
      renderer?.dispose();
      renderer = null;
      assetManager?.dispose();
      assetManager = null;
      context?.gl?.getExtension('WEBGL_lose_context')?.loseContext();
      context?.dispose();
      context = null;
      release?.();
      release = null;
    };

    const boot = async () => {
      setStatus('loading');
      setError(null);
      release = await acquirePreviewGlSlot();
      if (cancelled) return;

      setCanvasEpoch((e) => e + 1);
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
      if (cancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas missing');
      canvas.width = PREVIEW_SIZE;
      canvas.height = PREVIEW_SIZE;

      context = new ManagedWebGLRenderingContext(canvas, {
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        preserveDrawingBuffer: true,
      });
      if (!context.gl) throw new Error('WebGL unavailable');
      assetManager = new AssetManager(context);
      renderer = new SceneRenderer(canvas, context, false);

      const { skeletonData, injectedMissingPaths } = await loadSkeletonFromJob(
        job,
        assets,
        assetManager,
        allowMissing,
      );
      if (cancelled) return;

      const skeleton = new Skeleton(skeletonData);
      const skin = skinName || skeletonData.skins[0]?.name || 'default';
      skeleton.setSkinByName(skin);
      const missing = [...new Set([...job.missingImagePaths, ...injectedMissingPaths])];
      const state = new AnimationState(new AnimationStateData(skeletonData));

      // Preview must loop over real animation lengths — not the export Duration field
      // (which defaults to 1s and was cutting idle/jump/etc. mid-cycle).
      const animDurations: Record<string, number> = {};
      for (const layer of layers) {
        if (!layer.animationName) continue;
        const anim = skeletonData.findAnimation(layer.animationName);
        if (anim) animDurations[layer.animationName] = Math.max(anim.duration, 0);
      }
      const cycleDuration = Math.max(suggestDuration(layers, animDurations), 0.05);
      onCycleDurationRef.current?.(cycleDuration);

      const { offset, size } = sampleBounds(
        skeleton,
        state,
        layers,
        skin,
        cycleDuration,
        missing,
      );
      fitCamera(renderer, canvas, offset, size);

      let time = 0;
      let last = performance.now();

      const drawFrame = () => {
        if (!renderer || !context?.gl) return;
        applyTracksAtTime(skeleton, state, layers, time, skin);
        stripMissingAttachments(skeleton, missing);
        skeleton.updateWorldTransform(Physics.update);
        const gl = context.gl;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.12, 0.12, 0.14, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        renderer.begin();
        renderer.drawSkeleton(skeleton, false);
        renderer.end();
      };

      drawFrame();
      if (cancelled) return;
      setStatus('ready');

      const frame = (now: number) => {
        if (cancelled || !renderer || !context) return;
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        if (!playingRef.current) return;
        time += dt;
        if (cycleDuration > 0) time %= cycleDuration;
        drawFrame();
      };
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    boot().catch((e) => {
      if (cancelled) return;
      teardown();
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Preview failed');
    });

    return () => {
      cancelled = true;
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  return (
    <div className={`v2-preview status-${status}`}>
      <canvas key={canvasEpoch} ref={canvasRef} width={PREVIEW_SIZE} height={PREVIEW_SIZE} />
      {status === 'loading' && <div className="v2-preview-overlay">Loading…</div>}
      {status === 'error' && (
        <div className="v2-preview-overlay error">{error || 'Preview failed'}</div>
      )}
      {status === 'ready' && (
        <button type="button" className="v2-preview-toggle" onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
      )}
    </div>
  );
}
