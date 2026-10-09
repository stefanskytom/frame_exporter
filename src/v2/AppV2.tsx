import { useEffect, useMemo, useState } from 'react';
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

  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null;

  const assetStats = useMemo(() => {
    const stats = countAssetStats(assets);
    return { ...stats, atlasOptions: listAtlasOptions(assets) };
  }, [assets]);

  useEffect(() => {
    if (!selected) return;
    setLayers(defaultTracksForAnimations(selected.animations));
    // Suggest duration from looping base anim once jobs load — durations unknown until runtime;
    // keep 1s default; user can click "Fit duration".
  }, [selected?.id, selected?.animations.join(',')]);

  const handleJsonFiles = async (files: File[]) => {
    setError(null);
    setDoneMessage(null);
    const newJobs = await buildSkeletonJobs(files, assets);
    setJobs((prev) => {
      const map = new Map(prev.map((j) => [j.id, j]));
      for (const job of newJobs) map.set(job.id, job);
      const next = [...map.values()];
      if (!selectedId && next[0]) setSelectedId(next[0].id);
      return next;
    });
  };

  const handleAssets = async (files: File[]) => {
    setError(null);
    setDoneMessage(null);
    const next = mergeAssetFiles(assets, createAssetFiles(files));
    setAssets(next);
    setJobs(await refreshJobsWithAssets(jobs, next));
  };

  const set = <K extends keyof TrackExportSettings>(key: K, value: TrackExportSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  };

  const fitDuration = () => {
    if (!selected) return;
    // Without runtime durations, use heuristic: 1s for loop mixes is fine;
    // Prefer walk/run length ~1s for spineboy. Keep simple: 1.0 if looping base else 0.5.
    const base = layers.find((l) => l.trackIndex === 0);
    set('duration', base?.loop ? 1 : 0.75);
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
                duration={settings.duration}
                ignoreMissingAssets={settings.ignoreMissingAssets}
              />
              <TrackMixer
                animations={selected.animations}
                layers={layers}
                onChange={setLayers}
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
                    onChange={(e) => set('duration', Number.parseFloat(e.target.value) || 0)}
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
                <button type="button" className="btn ghost" onClick={fitDuration}>
                  Reset duration to 1s
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
