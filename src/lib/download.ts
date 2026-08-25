import { saveAs } from 'file-saver';

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

declare global {
  interface Window {
    __FRAME_EXPORTER_SMOKE_DIR__?: string;
    __FRAME_EXPORTER_SMOKE_OUT__?: string;
  }
}

/** Browser: saveAs download. Desktop (Tauri): native Save dialog + write file. */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (!isTauriRuntime()) {
    saveAs(blob, filename);
    return;
  }

  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const smokeOut = window.__FRAME_EXPORTER_SMOKE_OUT__;
  if (smokeOut) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('smoke_write_file', { path: smokeOut, contents: Array.from(bytes) });
    } catch {
      await writeFile(smokeOut, bytes);
    }
    return;
  }

  const { save } = await import('@tauri-apps/plugin-dialog');

  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
  });

  if (!path) {
    throw new Error('Save cancelled');
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(path, bytes);
}
