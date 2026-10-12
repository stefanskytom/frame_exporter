import { useEffect, useMemo, useRef, useState } from 'react';
import { AssetLocator } from './components/AssetLocator';
import { ExportSettingsPanel } from './components/ExportSettingsPanel';
import { JsonImport } from './components/JsonImport';
import { SkeletonList } from './components/SkeletonList';
import { useFrameSizes } from './hooks/useFrameSizes';
import {
  buildSkeletonJobs,
  countAssetStats,
  createAssetFiles,
  listAtlasOptions,
  mergeAssetFiles,
  refreshJobsWithAssets,
  resolveJobWithAtlasChoice,
} from './lib/assets';
import { exportAllJobs, isJobExportable } from './lib/spineExport';
import {
  DEFAULT_SETTINGS,
  type AssetFiles,
  type ExportProgress,
  type ExportSettings,
  type SkeletonJob,
} from './types';
import './App.css';

const EMPTY_ASSETS: AssetFiles = {
  byKey: new Map(),
  files: [],
};

async function fileFromPath(path: string, name: string, type: string): Promise<File> {
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = await invoke<number[]>('smoke_read_file', { path });
  const copy = Uint8Array.from(bytes);
  return new File([copy], name, { type });
}

async function smokeWrite(path: string, data: Uint8Array | string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const contents =
    typeof data === 'string' ? Array.from(new TextEncoder().encode(data)) : Array.from(data);
  await invoke('smoke_write_file', { path, contents });
}

export default function App() {
  const [jobs, setJobs] = useState<SkeletonJob[]>([]);
  const [assets, setAssets] = useState<AssetFiles>(EMPTY_ASSETS);
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const jobsRef = useRef(jobs);
  const assetsRef = useRef(assets);
  const assetLoadChain = useRef(Promise.resolve());
  jobsRef.current = jobs;
  assetsRef.current = assets;

  const frameSizes = useFrameSizes(jobs, assets, settings);

  const assetStats = useMemo(() => {
    const stats = countAssetStats(assets);
    return { ...stats, atlasOptions: listAtlasOptions(assets) };
  }, [assets]);

  const readyCount = jobs.filter((j) => isJobExportable(j, settings)).length;
  const totalAnims = jobs
    .filter((j) => isJobExportable(j, settings))
    .reduce(
      (sum, j) =>
        sum + (settings.exportAllAnimations ? j.animations.length : j.selectedAnimation ? 1 : 0),
      0,
    );

  const missingAssetCount = jobs.reduce((sum, j) => sum + j.missingImagePaths.length, 0);

  const handleJsonFiles = async (files: File[]) => {
    setError(null);
    setDoneMessage(null);
    const newJobs = await buildSkeletonJobs(files, assetsRef.current);
    setJobs((prev) => {
      const map = new Map(prev.map((j) => [j.id, j]));
      for (const job of newJobs) map.set(job.id, job);
      return [...map.values()];
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

  const handleChangeAtlas = async (id: string, atlasFileName: string) => {
    const updated = await Promise.all(
      jobs.map(async (j) => {
        if (j.id !== id) return j;
        return resolveJobWithAtlasChoice(j, assets, atlasFileName || null);
      }),
    );
    setJobs(updated);
  };

  const handleExport = async () => {
    setError(null);
    setDoneMessage(null);
    setBusy(true);
    setProgress({
      currentSkeleton: '',
      currentFrame: 0,
      totalFrames: 0,
      skeletonIndex: 0,
      skeletonTotal: readyCount,
      message: 'Starting export…',
    });

    try {
      await exportAllJobs(jobs, assets, settings, setProgress);
      const ignoredNote =
        settings.ignoreMissingAssets && missingAssetCount > 0
          ? ` · ignored ${missingAssetCount} missing asset${missingAssetCount === 1 ? '' : 's'}`
          : '';
      setDoneMessage(
        settings.exportAllAnimations
          ? `Exported ${readyCount} JSON · ${totalAnims} animations (subfolders per animation).${ignoredNote}`
          : `Exported ${readyCount} ${readyCount === 1 ? 'skeleton' : 'skeletons'} to ZIP.${ignoredNote}`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown export error';
      if (message === 'Save cancelled') {
        setDoneMessage(null);
        setError(null);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // Automated .app smoke test (env-injected by Tauri when FRAME_EXPORTER_SMOKE_* is set)
  useEffect(() => {
    let cancelled = false;
    let started = false;

    const runSmoke = async () => {
      const dir = window.__FRAME_EXPORTER_SMOKE_DIR__;
      const out = window.__FRAME_EXPORTER_SMOKE_OUT__;
      if (!dir || !out || cancelled || started) return;
      started = true;

      const statusPath = `${out}.status.json`;

      try {
        setError(null);
        setDoneMessage(null);
        setBusy(true);

        const json = await fileFromPath(`${dir}/spineboy-pro.json`, 'spineboy-pro.json', 'application/json');
        const atlas = await fileFromPath(`${dir}/spineboy.atlas`, 'spineboy.atlas', 'text/plain');
        const png = await fileFromPath(`${dir}/spineboy.png`, 'spineboy.png', 'image/png');

        const assetPack = createAssetFiles([atlas, png]);
        setAssets(assetPack);
        const newJobs = await buildSkeletonJobs([json], assetPack);
        const readyJobs = await refreshJobsWithAssets(newJobs, assetPack);
        setJobs(readyJobs);

        const smokeSettings: ExportSettings = {
          ...DEFAULT_SETTINGS,
          firstFrameOnly: true,
          exportAllAnimations: false,
        };
        setSettings(smokeSettings);

        const exportable = readyJobs.filter((j) => isJobExportable(j, smokeSettings));
        if (!exportable.length) {
          throw new Error(
            `Smoke: no exportable jobs (${readyJobs.map((j) => `${j.name}:${j.status}:${j.error ?? ''}`).join('; ')})`,
          );
        }

        setProgress({
          currentSkeleton: '',
          currentFrame: 0,
          totalFrames: 0,
          skeletonIndex: 0,
          skeletonTotal: exportable.length,
          message: 'Smoke export…',
        });

        await exportAllJobs(readyJobs, assetPack, smokeSettings, setProgress);
        setDoneMessage(`Smoke export ok → ${out}`);
        await smokeWrite(
          statusPath,
          JSON.stringify({ ok: true, out, jobs: exportable.map((j) => j.name) }, null, 2),
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        try {
          await smokeWrite(statusPath, JSON.stringify({ ok: false, error: message }, null, 2));
        } catch {
          // ignore
        }
        try {
          await smokeWrite(`${out}.failed`, message);
        } catch {
          // ignore
        }
      } finally {
        setBusy(false);
        setProgress(null);
      }
    };

    window.addEventListener('frame-exporter-smoke', runSmoke);
    if (window.__FRAME_EXPORTER_SMOKE_DIR__ && window.__FRAME_EXPORTER_SMOKE_OUT__) {
      void runSmoke();
    }
    const poll = window.setInterval(() => {
      if (window.__FRAME_EXPORTER_SMOKE_DIR__ && window.__FRAME_EXPORTER_SMOKE_OUT__) {
        void runSmoke();
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener('frame-exporter-smoke', runSmoke);
    };
  }, []);

  return (
    <div className="app-shell">
      <div className="app-glow" aria-hidden />
      <header className="topbar">
        <div className="topbar-brand">
          <span className="traffic">
            <i />
            <i />
            <i />
          </span>
          <div>
            <p className="brand">Frame Exporter</p>
            <p className="brand-sub">Spine → PNG</p>
          </div>
        </div>
        <p className="topbar-hint">Dark · macOS style</p>
      </header>

      <main className="app">
        <section className="intro">
          <h1>Animation frame export</h1>
          <p>
            Import Spine JSON files, point to assets, and generate PNG sequences. Each
            skeleton gets its own folder — optionally with subfolders per animation.
          </p>
        </section>

        <div className="layout">
          <JsonImport onJsonFiles={handleJsonFiles} disabled={busy} />
          <AssetLocator
            assetCount={assetStats.total}
            atlasCount={assetStats.atlasCount}
            imageCount={assetStats.imageCount}
            onAssets={handleAssets}
            disabled={busy}
          />
          <SkeletonList
            jobs={jobs}
            assets={assets}
            atlasOptions={assetStats.atlasOptions}
            exportAllAnimations={settings.exportAllAnimations}
            ignoreMissingAssets={settings.ignoreMissingAssets}
            scale={settings.scale}
            canvasWidth={settings.canvasWidth}
            canvasHeight={settings.canvasHeight}
            frameSizes={frameSizes}
            onChangeAnimation={(id, animation) =>
              setJobs((prev) =>
                prev.map((j) => (j.id === id ? { ...j, selectedAnimation: animation } : j)),
              )
            }
            onChangeSkin={(id, skin) =>
              setJobs((prev) =>
                prev.map((j) => (j.id === id ? { ...j, selectedSkin: skin } : j)),
              )
            }
            onChangeAtlas={handleChangeAtlas}
            onApplySuggestedCanvas={(width, height) =>
              setSettings((prev) => ({
                ...prev,
                canvasWidth: width,
                canvasHeight: height,
              }))
            }
            onRemove={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))}
            onClear={() => setJobs([])}
          />
          <ExportSettingsPanel settings={settings} onChange={setSettings} />

          <section className="panel export-bar">
            <div className="export-meta">
              <div className="step-index">5</div>
              <div>
                <h2>Export</h2>
                <p>
                  Ready: <strong>{readyCount}</strong> / {jobs.length}
                  {settings.exportAllAnimations && readyCount > 0 ? (
                    <>
                      {' '}
                      · <strong>{totalAnims}</strong> animations
                    </>
                  ) : null}
                  {missingAssetCount > 0 ? (
                    <>
                      {' '}
                      · <span className={settings.ignoreMissingAssets ? 'warn-text' : 'error-text'}>
                        {missingAssetCount} missing
                        {settings.ignoreMissingAssets ? ' (ignored)' : ''}
                      </span>
                    </>
                  ) : null}
                </p>
                {progress && (
                  <p className="progress-text" aria-live="polite">
                    [{progress.skeletonIndex}/{progress.skeletonTotal}] {progress.message}
                  </p>
                )}
                {error && <p className="error-text">{error}</p>}
                {doneMessage && <p className="success-text">{doneMessage}</p>}
              </div>
            </div>
            <button
              type="button"
              className="btn primary large"
              disabled={busy || readyCount === 0}
              onClick={handleExport}
            >
              {busy ? 'Exporting…' : 'Export ZIP'}
            </button>
          </section>

          <aside className="panel tip">
            <h3>ZIP structure</h3>
            <pre className="tree">
{`export.zip
└── hero/
    ├── walk/
    │   └── hero_0001.png
    └── idle/
        └── hero_0001.png`}
            </pre>
            <p className="tip-note">
              With a single animation, frames sit directly in the JSON folder. Spine 4.x —
              images or atlas.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
