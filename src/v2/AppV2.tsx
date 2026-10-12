import { useEffect, useMemo, useRef, useState } from 'react';
import { AssetLocator } from '../components/AssetLocator';
import { JsonImport } from '../components/JsonImport';
import {
  buildSkeletonJobs,
  countAssetStats,
  createAssetFiles,
  listAtlasOptions,
  mergeAssetFiles,
  refreshJobsWithAssets,
} from '../lib/assets';
import type { AssetFiles, SkeletonJob } from '../types';
import { TrackMixer } from './components/TrackMixer';
import { TrackPreview } from './components/TrackPreview';
import { exportMixedTracks } from './trackExport';
import {
  DEFAULT_TRACK_SETTINGS,
  createTrackLayer,
  defaultTracksForAnimations,
  type TrackExportSettings,
  type TrackLayer,
} from './types';
import './AppV2.css';

const EMPTY_ASSETS: AssetFiles = { byKey: new Map(), files: [] };

export default function AppV2() {
  const [jobs, setJobs] = useState<SkeletonJob[]>([]);
  const [assets, setAssets] = useState<AssetFiles>(EMPTY_ASSETS);
  const [selectedId, setSelectedId] = useState<string>('');
  const [layers, setLayers] = useState<TrackLayer[]>([createTrackLayer(0)]);
  const [settings, setSettings] = useState<TrackExportSettings>(DEFAULT_TRACK_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  /** When true, preview-reported cycle length overwrites export Duration. */
  const [autoDuration, setAutoDuration] = useState(true);
  const [cycleDuration, setCycleDuration] = useState<number | null>(null);

  const jobsRef = useRef(jobs);
  const assetsRef = useRef(assets);
  const assetLoadChain = useRef(Promise.resolve());
  jobsRef.current = jobs;
  assetsRef.current = assets;

  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null;

  const assetStats = useMemo(() => {
    const stats = countAssetStats(assets);
    return { ...stats, atlasOptions: listAtlasOptions(assets) };
  }, [assets]);

  const selectedAnimKey = selected?.animations.join(',') ?? '';
  useEffect(() => {
    if (!selected) return;
    setLayers(defaultTracksForAnimations(selected.animations));
    setAutoDuration(true);
    setCycleDuration(null);
    // Reset mixer when the chosen skeleton (or its animation list) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selectedAnimKey]);

  const handleJsonFiles = async (files: File[]) => {
    setError(null);
    setDoneMessage(null);
    const newJobs = await buildSkeletonJobs(files, assetsRef.current);
    let merged: SkeletonJob[] = [];
    setJobs((prev) => {
      const map = new Map(prev.map((j) => [j.id, j]));
      for (const job of newJobs) map.set(job.id, job);
      merged = [...map.values()];
      return merged;
    });
    setSelectedId((prev) => {
      if (prev && merged.some((j) => j.id === prev)) return prev;
      return newJobs[0]?.id ?? merged[0]?.id ?? '';
    });
  };

  const handleAssets = async (files: File[]) => {
    setError(null);
    setDoneMessage(null);
    const incoming = createAssetFiles(files);
    const run = assetLoadChain.current.then(async () => {
      const next = mergeAssetFiles(assetsRef.current, incoming);
      assetsRef.current = next;
      setAssets(next);
      const refreshed = await refreshJobsWithAssets(jobsRef.current, next);
      jobsRef.current = refreshed;
      setJobs(refreshed);
    });
    assetLoadChain.current = run.then(
      () => undefined,
      () => undefined,
    );
    await run;
  };

  const set = <K extends keyof TrackExportSettings>(key: K, value: TrackExportSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  };

  const fitDuration = () => {
    if (cycleDuration == null) return;
    setAutoDuration(true);
    set('duration', cycleDuration);
  };

  const handleCycleDuration = (seconds: number) => {
    setCycleDuration(seconds);
    if (autoDuration) set('duration', seconds);
  };

  const handleExport = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setDoneMessage(null);
    setProgress(null);
    try {
      await exportMixedTracks(selected, assets, layers, settings, (p) => {
        setProgress(p.message);
      });
      setDoneMessage(`Exported mixed tracks for ${selected.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const canExport =
    selected &&
    (selected.status === 'ready' ||
      (selected.status === 'missing-assets' && settings.ignoreMissingAssets)) &&
    layers.some((l) => l.animationName);

  return (
    <div className="app-shell v2-shell">
      <div className="app-glow" />
      <header className="topbar v2-topbar">
        <div className="topbar-brand">
          <div className="traffic" aria-hidden>
            <i />
            <i />
            <i />
          </div>
          <div>
            <div className="brand-title">
              Frame Exporter <span className="v2-badge">2.0</span>
            </div>
            <div className="brand-sub">Multi-track mix · bake layered Spine animations to PNG</div>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="stat-pill">{jobs.length} JSON</span>
          <span className="stat-pill">{assetStats.atlasCount} atlas</span>
          <span className="stat-pill">{assetStats.imageCount} images</span>
        </div>
      </header>

      <main className="v2-main">
        <div className="v2-grid">
          <JsonImport onJsonFiles={handleJsonFiles} disabled={busy} />
          <AssetLocator
            onAssets={handleAssets}
            disabled={busy}
            assetCount={assets.files.length}
            atlasCount={assetStats.atlasCount}
            imageCount={assetStats.imageCount}
          />
        </div>

        {jobs.length > 0 && (
          <section className="panel">
            <header className="panel-header">
              <div className="step-index">2</div>
              <div>
                <h2>Skeleton</h2>
                <p>Pick the JSON whose animations you want to layer on tracks.</p>
              </div>
            </header>
            <div className="v2-job-pick">
              <select
                value={selected?.id ?? ''}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name} · {j.status} · {j.animations.length} anim
                  </option>
                ))}
              </select>
              {selected && selected.skins.length > 1 && (
                <label className="v2-field">
                  <span>Skin</span>
                  <select
                    value={selected.selectedSkin}
                    onChange={(e) => {
                      const skin = e.target.value;
                      setJobs((prev) =>
                        prev.map((j) =>
                          j.id === selected.id ? { ...j, selectedSkin: skin } : j,
                        ),
                      );
                    }}
                  >
                    {selected.skins.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </section>
        )}

        {selected && (
          <>
            <div className="v2-workbench">
              <TrackPreview
                job={selected}
                assets={assets}
                layers={layers}
                skinName={selected.selectedSkin}
                ignoreMissingAssets={settings.ignoreMissingAssets}
                onCycleDuration={handleCycleDuration}
              />
              <TrackMixer
                animations={selected.animations}
                layers={layers}
                onChange={(next) => {
                  setAutoDuration(true);
                  setLayers(next);
                }}
              />
            </div>

            <section className="panel">
              <header className="panel-header">
                <div className="step-index">4</div>
                <div>
                  <h2>Export mixed frames</h2>
                  <p>Bake the layered track pose to a PNG sequence (ZIP).</p>
                </div>
              </header>

              <div className="v2-export-grid">
                <label className="v2-field">
                  <span>Duration (s)</span>
                  <input
                    type="number"
                    min={0.05}
                    step={0.05}
                    value={settings.duration}
                    onChange={(e) => {
                      setAutoDuration(false);
                      set('duration', Number.parseFloat(e.target.value) || 0);
                    }}
                  />
                </label>
                <label className="v2-field">
                  <span>FPS</span>
                  <input
                    type="number"
                    min={1}
                    value={settings.fps}
                    onChange={(e) => set('fps', Number.parseInt(e.target.value, 10) || 1)}
                  />
                </label>
                <label className="v2-field">
                  <span>Canvas W</span>
                  <input
                    type="number"
                    min={1}
                    value={settings.canvasWidth}
                    onChange={(e) =>
                      set('canvasWidth', Number.parseInt(e.target.value, 10) || 1)
                    }
                  />
                </label>
                <label className="v2-field">
                  <span>Canvas H</span>
                  <input
                    type="number"
                    min={1}
                    value={settings.canvasHeight}
                    onChange={(e) =>
                      set('canvasHeight', Number.parseInt(e.target.value, 10) || 1)
                    }
                  />
                </label>
                <label className="v2-field">
                  <span>Scale</span>
                  <input
                    type="number"
                    min={0.01}
                    step={0.1}
                    value={settings.scale}
                    onChange={(e) => set('scale', Number.parseFloat(e.target.value) || 1)}
                  />
                </label>
                <label className="v2-check block">
                  <input
                    type="checkbox"
                    checked={settings.firstFrameOnly}
                    onChange={(e) => set('firstFrameOnly', e.target.checked)}
                  />
                  First frame only
                </label>
                <label className="v2-check block">
                  <input
                    type="checkbox"
                    checked={settings.transparentBackground}
                    onChange={(e) => set('transparentBackground', e.target.checked)}
                  />
                  Transparent background
                </label>
                <label className="v2-check block">
                  <input
                    type="checkbox"
                    checked={settings.ignoreMissingAssets}
                    onChange={(e) => set('ignoreMissingAssets', e.target.checked)}
                  />
                  Ignore missing assets
                </label>
              </div>

              <div className="v2-export-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={fitDuration}
                  disabled={cycleDuration == null}
                >
                  Fit to animation cycle
                  {cycleDuration != null ? ` (${cycleDuration}s)` : ''}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={!canExport || busy}
                  onClick={handleExport}
                >
                  {busy ? 'Exporting…' : 'Export mixed tracks ZIP'}
                </button>
              </div>
              {progress && <p className="muted">{progress}</p>}
              {error && <p className="error-text">{error}</p>}
              {doneMessage && <p className="ok-text">{doneMessage}</p>}
            </section>
          </>
        )}

        {jobs.length === 0 && (
          <section className="panel">
            <p className="muted">
              Load a Spine JSON and atlas/images, then layer animations on tracks (classic example:{' '}
              <strong>walk</strong> on track 0 + <strong>aim</strong> or <strong>shoot</strong> on
              track 1).
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
