import { useEffect, useId, useRef, useState } from 'react';
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
import { loadSkeletonFromJob, stripMissingAttachments } from '../lib/spineExport';
import { acquirePreviewGlSlot, PREVIEW_SIZE } from '../lib/previewGl';
import type { AssetFiles, SkeletonJob } from '../types';

interface Props {
  job: SkeletonJob;
  assets: AssetFiles;
  animationName: string;
  skinName: string;
  ignoreMissingAssets: boolean;
}

function expandBounds(
  intoOffset: Vector2,
  intoSize: Vector2,
  offset: Vector2,
  size: Vector2,
  has: { value: boolean },
) {
  if (size.x < 1 || size.y < 1) return;
  if (!has.value) {
    intoOffset.set(offset.x, offset.y);
    intoSize.set(size.x, size.y);
    has.value = true;
    return;
  }
  const minX = Math.min(intoOffset.x, offset.x);
  const minY = Math.min(intoOffset.y, offset.y);
  const maxX = Math.max(intoOffset.x + intoSize.x, offset.x + size.x);
  const maxY = Math.max(intoOffset.y + intoSize.y, offset.y + size.y);
  intoOffset.set(minX, minY);
  intoSize.set(maxX - minX, maxY - minY);
}

function fitCamera(
  renderer: SceneRenderer,
  canvas: HTMLCanvasElement,
  offset: Vector2,
  size: Vector2,
) {
  const pad = 1.2;
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

function measureAnimBounds(
  skeleton: Skeleton,
  state: AnimationState,
  animName: string,
  duration: number,
  skin: string,
  missing: string[],
): { offset: Vector2; size: Vector2 } {
  const offset = new Vector2();
  const size = new Vector2();
  const tmpO = new Vector2();
  const tmpS = new Vector2();
  const has = { value: false };

  const steps = duration <= 0 ? 1 : Math.min(12, Math.max(4, Math.ceil(duration * 8)));
  for (let i = 0; i < steps; i++) {
    const t = duration <= 0 ? 0 : (i / Math.max(steps - 1, 1)) * duration;
    skeleton.setSkinByName(skin);
    skeleton.setSlotsToSetupPose();
    skeleton.setToSetupPose();
    state.clearTracks();
    const entry = state.setAnimation(0, animName, false);
    entry.trackTime = t;
    entry.animationLast = -1;
    state.apply(skeleton);
    stripMissingAttachments(skeleton, missing);
    skeleton.updateWorldTransform(Physics.update);
    skeleton.getBounds(tmpO, tmpS, []);
    expandBounds(offset, size, tmpO, tmpS, has);
  }

  if (!has.value || size.x < 1 || size.y < 1) {
    offset.set(-50, -50);
    size.set(100, 100);
  }
  return { offset, size };
}

export function AnimationPreview({
  job,
  assets,
  animationName,
  skinName,
  ignoreMissingAssets,
}: Props) {
  const reactId = useId();
  const slotId = `${job.id}:${reactId}`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const canPreview = job.status === 'ready' || job.status === 'missing-assets';
  const allowMissing =
    ignoreMissingAssets || job.missingImagePaths.length > 0 || job.status === 'missing-assets';

  const reloadKey = [
    job.id,
    job.status,
    job.assetMode,
    job.atlasFileName ?? '',
    job.missingImagePaths.join(','),
    assets.files.length,
    animationName,
    skinName,
    allowMissing ? '1' : '0',
    slotId,
  ].join('|');

  useEffect(() => {
    if (!canPreview || !animationName) {
      setStatus('error');
      setError(animationName ? null : 'No animation selected');
      return;
    }

    const wrap = wrapRef.current;
    if (!wrap) return;

    let cancelled = false;
    let session = 0;
    let raf = 0;
    let releaseSlot: (() => void) | null = null;
    let context: ManagedWebGLRenderingContext | null = null;
    let assetManager: AssetManager | null = null;
    let renderer: SceneRenderer | null = null;
    let bootPromise: Promise<void> | null = null;
    let booted = false;

    const teardownGl = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      renderer?.dispose();
      renderer = null;
      assetManager?.dispose();
      assetManager = null;
      const gl = context?.gl;
      const lose = gl?.getExtension('WEBGL_lose_context');
      lose?.loseContext();
      context?.dispose();
      context = null;
      releaseSlot?.();
      releaseSlot = null;
      booted = false;
      bootPromise = null;
    };

    const boot = async () => {
      const mySession = session;
      setStatus('loading');
      setError(null);

      releaseSlot = await acquirePreviewGlSlot();
      if (cancelled || mySession !== session) {
        releaseSlot();
        releaseSlot = null;
        return;
      }

      // Fresh canvas each boot — WebGL context cannot be reliably reused after loseContext.
      setCanvasEpoch((e) => e + 1);
      await new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      });
      if (cancelled || mySession !== session) return;

      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Preview canvas missing');

      canvas.width = PREVIEW_SIZE;
      canvas.height = PREVIEW_SIZE;

      context = new ManagedWebGLRenderingContext(canvas, {
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        preserveDrawingBuffer: true,
      });
      const gl = context.gl;
      if (!gl) throw new Error('WebGL unavailable');

      assetManager = new AssetManager(context);
      // twoColorTint=false; never call SceneRenderer.resize() (MAX_VIEWPORT_DIMS crash).
      renderer = new SceneRenderer(canvas, context, false);

      const { skeletonData, injectedMissingPaths } = await loadSkeletonFromJob(
        job,
        assets,
        assetManager,
        allowMissing,
      );
      if (cancelled || mySession !== session) return;

      const skeleton = new Skeleton(skeletonData);
      const skin = skinName || skeletonData.skins[0]?.name || 'default';
      try {
        skeleton.setSkinByName(skin);
      } catch {
        throw new Error(`Skin “${skin}” not found`);
      }

      const missing = [...new Set([...job.missingImagePaths, ...injectedMissingPaths])];
      if (!skeletonData.findAnimation(animationName)) {
        throw new Error(`Animation “${animationName}” not found`);
      }

      const state = new AnimationState(new AnimationStateData(skeletonData));
      const animation = skeletonData.findAnimation(animationName)!;
      const { offset, size } = measureAnimBounds(
        skeleton,
        state,
        animationName,
        Math.max(animation.duration, 0),
        skin,
        missing,
      );
      fitCamera(renderer, canvas, offset, size);

      skeleton.setSkinByName(skin);
      skeleton.setSlotsToSetupPose();
      skeleton.setToSetupPose();
      state.clearTracks();
      state.setAnimation(0, animationName, true);

      const draw = () => {
        if (!renderer || !context?.gl) return;
        const glCtx = context.gl;
        stripMissingAttachments(skeleton, missing);
        skeleton.updateWorldTransform(Physics.update);
        glCtx.viewport(0, 0, canvas.width, canvas.height);
        glCtx.clearColor(0.12, 0.12, 0.14, 1);
        glCtx.clear(glCtx.COLOR_BUFFER_BIT);
        renderer.begin();
        renderer.drawSkeleton(skeleton, false);
        renderer.end();
      };

      state.update(0);
      state.apply(skeleton);
      draw();

      if (cancelled || mySession !== session) return;
      booted = true;
      setStatus('ready');

      let last = performance.now();
      const frame = (now: number) => {
        if (cancelled || mySession !== session || !renderer || !context) return;
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        if (!playingRef.current) return;
        state.update(dt);
        state.apply(skeleton);
        draw();
      };
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const startBoot = () => {
      if (cancelled || booted || bootPromise) return;
      const expectedSession = session;
      bootPromise = boot().catch((e) => {
        if (cancelled || expectedSession !== session) return;
        teardownGl();
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Preview failed');
      });
    };

    const stopPreview = () => {
      session += 1;
      teardownGl();
      if (!cancelled) setStatus('idle');
    };

    // Large margin so cards just below the fold still boot (and headless viewports work).
    const rootMargin = '480px';
    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              const visible = entries.some((e) => e.isIntersecting);
              if (visible) startBoot();
              else stopPreview();
            },
            { threshold: 0, rootMargin },
          )
        : null;

    if (observer) {
      observer.observe(wrap);
      // Kick immediately — don't wait for the first IO callback.
      startBoot();
    } else {
      startBoot();
    }

    return () => {
      cancelled = true;
      session += 1;
      observer?.disconnect();
      teardownGl();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, canPreview]);

  if (!canPreview) {
    return (
      <div className="anim-preview is-disabled" ref={wrapRef}>
        <div className="anim-preview-placeholder muted">Preview unavailable</div>
      </div>
    );
  }

  return (
    <div className={`anim-preview status-${status}`} ref={wrapRef}>
      <canvas
        key={canvasEpoch}
        ref={canvasRef}
        width={PREVIEW_SIZE}
        height={PREVIEW_SIZE}
        aria-label="Animation preview"
      />
      {(status === 'loading' || status === 'idle') && (
        <div className="anim-preview-overlay muted">
          {status === 'idle' ? '…' : 'Loading…'}
        </div>
      )}
      {status === 'error' && (
        <div className="anim-preview-overlay error">{error || 'Preview failed'}</div>
      )}
      {status === 'ready' && (
        <button
          type="button"
          className="anim-preview-toggle"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
      )}
    </div>
  );
}
