/**
 * Headless smoke boot for the Tauri .app (FRAME_EXPORTER_SMOKE_* env).
 * Runs outside React so it is not blocked by mount timing.
 */
import {
  buildSkeletonJobs,
  createAssetFiles,
  refreshJobsWithAssets,
} from './lib/assets';
import { exportAllJobs, isJobExportable } from './lib/spineExport';
import { DEFAULT_SETTINGS, type ExportSettings } from './types';

declare global {
  interface Window {
    __FRAME_EXPORTER_SMOKE_DIR__?: string;
    __FRAME_EXPORTER_SMOKE_OUT__?: string;
    __FRAME_EXPORTER_SMOKE_SEEN__?: number;
    __FRAME_EXPORTER_SMOKE_TICK__?: number;
  }
}

async function invokeSmokeWrite(path: string, data: Uint8Array | string): Promise<void> {
  const contents =
    typeof data === 'string' ? Array.from(new TextEncoder().encode(data)) : Array.from(data);
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: Function } })
    .__TAURI_INTERNALS__;
  if (internals?.invoke) {
    await internals.invoke('smoke_write_file', { path, contents });
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('smoke_write_file', { path, contents });
}

async function invokeSmokeRead(path: string): Promise<Uint8Array> {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: Function } })
    .__TAURI_INTERNALS__;
  let bytes: number[];
  if (internals?.invoke) {
    bytes = await internals.invoke('smoke_read_file', { path });
  } else {
    const { invoke } = await import('@tauri-apps/api/core');
    bytes = await invoke('smoke_read_file', { path });
  }
  return Uint8Array.from(bytes);
}

async function fileFromPath(path: string, name: string, type: string): Promise<File> {
  const bytes = await invokeSmokeRead(path);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type });
}

let started = false;

async function runSmoke(): Promise<void> {
  const dir = window.__FRAME_EXPORTER_SMOKE_DIR__;
  const out = window.__FRAME_EXPORTER_SMOKE_OUT__;
  if (!dir || !out || started) return;
  started = true;

  const statusPath = `${out}.status.json`;
  try {
    await invokeSmokeWrite(`${out}.js-started`, `seen=${window.__FRAME_EXPORTER_SMOKE_SEEN__ ?? 0}`);

    await invokeSmokeWrite(`${out}.step`, 'reading-files');
    const json = await fileFromPath(`${dir}/spineboy-pro.json`, 'spineboy-pro.json', 'application/json');
    const atlas = await fileFromPath(`${dir}/spineboy.atlas`, 'spineboy.atlas', 'text/plain');
    const png = await fileFromPath(`${dir}/spineboy.png`, 'spineboy.png', 'image/png');

    await invokeSmokeWrite(`${out}.step`, 'building-jobs');
    const assets = createAssetFiles([atlas, png]);
    const jobs = refreshJobsWithAssets(await buildSkeletonJobs([json], assets), assets);
    const settings: ExportSettings = {
      ...DEFAULT_SETTINGS,
      firstFrameOnly: true,
      exportAllAnimations: false,
    };
    const exportable = jobs.filter((j) => isJobExportable(j, settings));
    if (!exportable.length) {
      throw new Error(
        `Smoke: no exportable jobs (${jobs.map((j) => `${j.name}:${j.status}:${j.error ?? ''}`).join('; ')})`,
      );
    }

    await invokeSmokeWrite(
      `${out}.step`,
      `exporting jobs=${exportable.map((j) => j.name).join(',')}`,
    );
    await exportAllJobs(jobs, assets, settings, () => undefined);
    await invokeSmokeWrite(`${out}.step`, 'done');
    await invokeSmokeWrite(
      statusPath,
      JSON.stringify({ ok: true, out, jobs: exportable.map((j) => j.name) }, null, 2),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      await invokeSmokeWrite(statusPath, JSON.stringify({ ok: false, error: message }, null, 2));
    } catch {
      // ignore
    }
    try {
      await invokeSmokeWrite(`${out}.failed`, message);
    } catch {
      // ignore
    }
  }
}

window.addEventListener('frame-exporter-smoke', () => {
  void runSmoke();
});
window.setInterval(() => {
  void runSmoke();
}, 400);
void runSmoke();
