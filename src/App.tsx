import { useMemo, useState } from 'react';
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

export default function App() {
  const [jobs, setJobs] = useState<SkeletonJob[]>([]);
  const [assets, setAssets] = useState<AssetFiles>(EMPTY_ASSETS);
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

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

  const handleJsonFiles = async (files: File[]) => {
    setError(null);
    setDoneMessage(null);
    const newJobs = await buildSkeletonJobs(files, assets);
    setJobs((prev) => {
      const map = new Map(prev.map((j) => [j.id, j]));
      for (const job of newJobs) map.set(job.id, job);
      return [...map.values()];
    });
  };

  const handleAssets = (files: File[]) => {
    setError(null);
    setDoneMessage(null);
    const next = mergeAssetFiles(assets, createAssetFiles(files));
    setAssets(next);
    setJobs((prev) => refreshJobsWithAssets(prev, next));
  };

  const handleChangeAtlas = (id: string, atlasFileName: string) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== id) return j;
        if (!atlasFileName) {
          return refreshJobsWithAssets([{ ...j, atlasFileName: null }], assets)[0];
        }
        return {
          ...j,
          assetMode: 'atlas' as const,
          atlasFileName,
          status: 'ready' as const,
          error: undefined,
          missingImagePaths: [],
        };
      }),
    );
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
      setDoneMessage(
        settings.exportAllAnimations
          ? `Exported ${readyCount} JSON · ${totalAnims} animations (subfolders per animation).`
          : `Exported ${readyCount} ${readyCount === 1 ? 'skeleton' : 'skeletons'} to ZIP.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown export error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

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
            atlasOptions={assetStats.atlasOptions}
            exportAllAnimations={settings.exportAllAnimations}
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
