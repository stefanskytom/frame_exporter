import { useMemo, useState } from 'react';
import { AssetLocator } from './components/AssetLocator';
import { ExportSettingsPanel } from './components/ExportSettingsPanel';
import { JsonImport } from './components/JsonImport';
import { SkeletonList } from './components/SkeletonList';
import {
  buildSkeletonJobs,
  countAssetStats,
  createAssetFiles,
  listAtlasOptions,
  mergeAssetFiles,
  refreshJobsWithAssets,
} from './lib/assets';
import { exportAllJobs } from './lib/spineExport';
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

  const assetStats = useMemo(() => {
    const stats = countAssetStats(assets);
    return { ...stats, atlasOptions: listAtlasOptions(assets) };
  }, [assets]);

  const readyCount = jobs.filter((j) => j.status === 'ready' && j.selectedAnimation).length;

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
          // Re-resolve against current assets (image mode)
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
      message: 'Start eksportu…',
    });

    try {
      await exportAllJobs(jobs, assets, settings, setProgress);
      setDoneMessage(
        `Wyeksportowano ${readyCount} ${readyCount === 1 ? 'szkielet' : 'szkielety'} do archiwum ZIP (osobny folder na każdy JSON).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nieznany błąd eksportu');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-inner">
          <p className="brand">Spine Frame Exporter</p>
          <h1>Eksport klatek animacji Spine</h1>
          <p className="lede">
            Wczytaj wiele plików .json, wskaż folder obrazów (lub atlas) i wyeksportuj
            klatki PNG — każdy szkielet do własnego folderu.
          </p>
        </div>
      </header>

      <main className="layout">
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
          onChangeAnimation={(id, animation) =>
            setJobs((prev) =>
              prev.map((j) => (j.id === id ? { ...j, selectedAnimation: animation } : j)),
            )
          }
          onChangeAtlas={handleChangeAtlas}
          onRemove={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))}
          onClear={() => setJobs([])}
        />
        <ExportSettingsPanel settings={settings} onChange={setSettings} />

        <section className="panel export-bar">
          <div>
            <h2>5. Eksport</h2>
            <p>
              Gotowe do eksportu: <strong>{readyCount}</strong> / {jobs.length}
            </p>
            {progress && (
              <p className="progress-text" aria-live="polite">
                [{progress.skeletonIndex}/{progress.skeletonTotal}] {progress.message}
              </p>
            )}
            {error && <p className="error-text">{error}</p>}
            {doneMessage && <p className="success-text">{doneMessage}</p>}
          </div>
          <button
            type="button"
            className="btn primary large"
            disabled={busy || readyCount === 0}
            onClick={handleExport}
          >
            {busy ? 'Eksportuję…' : 'Eksportuj klatki (ZIP)'}
          </button>
        </section>

        <aside className="panel tip">
          <h3>Wymagania</h3>
          <ul>
            <li>
              Spine 4.x — JSON + folder obrazów (<code>images/</code>) albo JSON +{' '}
              <code>.atlas</code> + PNG.
            </li>
            <li>
              Jeśli JSON ma <code>skeleton.images</code>, wystarczy wskazać ten folder PNG.
            </li>
            <li>Wynik: jeden ZIP, w środku folder na każdy zaimportowany JSON.</li>
          </ul>
        </aside>
      </main>
    </div>
  );
}
