export type TrackBlendMode = 'replace' | 'add';

/** One AnimationState track layered at export/preview time. */
export interface TrackLayer {
  id: string;
  /** Spine track index (0 = base). */
  trackIndex: number;
  /** Animation name, or empty to disable. */
  animationName: string;
  loop: boolean;
  /** Seconds before this track starts relative to export time 0. */
  delay: number;
  timeScale: number;
  /** 0–1 contribution of this track. */
  alpha: number;
}

export interface TrackExportSettings {
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  fps: number;
  /** Total timeline length in seconds (covers looping base tracks). */
  duration: number;
  firstFrameOnly: boolean;
  transparentBackground: boolean;
  backgroundColor: string;
  premultipliedAlpha: boolean;
  paddingDigits: number;
  namingPattern: '{name}_{####}' | '{name}_tracks_{####}' | 'custom';
  customNaming: string;
  ignoreMissingAssets: boolean;
}

export const DEFAULT_TRACK_SETTINGS: TrackExportSettings = {
  canvasWidth: 512,
  canvasHeight: 512,
  scale: 1,
  fps: 30,
  duration: 1,
  firstFrameOnly: false,
  transparentBackground: true,
  backgroundColor: '#000000',
  premultipliedAlpha: false,
  paddingDigits: 4,
  namingPattern: '{name}_tracks_{####}',
  customNaming: '{name}_tracks_{####}',
  ignoreMissingAssets: false,
};

export function createTrackLayer(
  trackIndex: number,
  animationName = '',
  overrides: Partial<TrackLayer> = {},
): TrackLayer {
  return {
    id: `track-${trackIndex}-${Math.random().toString(36).slice(2, 8)}`,
    trackIndex,
    animationName,
    loop: trackIndex === 0,
    delay: 0,
    timeScale: 1,
    alpha: 1,
    ...overrides,
  };
}

export function defaultTracksForAnimations(animations: string[]): TrackLayer[] {
  const base = animations.includes('walk')
    ? 'walk'
    : animations.includes('run')
      ? 'run'
      : animations[0] ?? '';
  const overlay = ['aim', 'shoot', 'gun-aim', 'attack']
    .find((n) => animations.includes(n) && n !== base) ?? '';

  const tracks = [createTrackLayer(0, base, { loop: true })];
  if (overlay) {
    tracks.push(createTrackLayer(1, overlay, { loop: true, alpha: 1 }));
  }
  return tracks;
}

/** Local time on a track for a global export timestamp. */
export function trackLocalTime(
  globalTime: number,
  layer: TrackLayer,
  animationDuration: number,
): number | null {
  const scale = layer.timeScale === 0 ? 0 : layer.timeScale;
  let t = (globalTime - layer.delay) * scale;
  if (t < 0) return null; // not started yet
  if (animationDuration <= 0) return 0;
  if (layer.loop) {
    t = t % animationDuration;
    if (t < 0) t += animationDuration;
    return t;
  }
  return Math.min(t, animationDuration);
}

/** One full cycle of the mix (longest track, respecting delay + timeScale). */
export function suggestDuration(layers: TrackLayer[], animDurations: Record<string, number>): number {
  let max = 0.5;
  for (const layer of layers) {
    if (!layer.animationName) continue;
    const d = animDurations[layer.animationName] ?? 0;
    if (d <= 0) continue;
    const scale = Math.abs(layer.timeScale) || 1;
    // Looping tracks: show one full cycle at the configured speed.
    max = Math.max(max, Math.max(0, layer.delay) + d / scale);
  }
  return Math.round(max * 1000) / 1000;
}
