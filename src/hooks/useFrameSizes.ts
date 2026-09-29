import { useEffect, useRef, useState } from 'react';
import { measureJobFrameSize, type FrameSizeInfo } from '../lib/spineExport';
import type { AssetFiles, ExportSettings, SkeletonJob } from '../types';

export type FrameSizeMap = Record<string, FrameSizeInfo | { error: string } | { loading: true }>;

export function useFrameSizes(
  jobs: SkeletonJob[],
  assets: AssetFiles,
  settings: ExportSettings,
): FrameSizeMap {
  const [sizes, setSizes] = useState<FrameSizeMap>({});
  const genRef = useRef(0);

  const selectionKey = jobs
    .map(
      (j) =>
        `${j.id}:${j.status}:${j.selectedAnimation}:${j.selectedSkin}:${j.atlasFileName}:${j.assetMode}:${j.missingImagePaths.length}`,
    )
    .join('|');

  useEffect(() => {
    const gen = ++genRef.current;
    const measurable = jobs.filter(
      (j) => j.status === 'ready' || j.status === 'missing-assets',
    );

    if (measurable.length === 0) {
      setSizes({});
      return;
    }

    setSizes(Object.fromEntries(measurable.map((j) => [j.id, { loading: true as const }])));

    const timer = window.setTimeout(async () => {
      const next: FrameSizeMap = {};
      for (const job of measurable) {
        if (genRef.current !== gen) return;
        try {
          next[job.id] = await measureJobFrameSize(job, assets, settings);
        } catch (e) {
          next[job.id] = {
            error: e instanceof Error ? e.message : 'Failed to measure frame',
          };
        }
        if (genRef.current === gen) {
          setSizes({ ...next });
        }
      }
    }, 280);

    return () => {
      window.clearTimeout(timer);
      genRef.current += 1;
    };
    // jobs captured via selectionKey + ready set; assets/settings drive remasure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectionKey,
    assets,
    settings.scale,
    settings.exportAllAnimations,
    settings.canvasWidth,
    settings.canvasHeight,
  ]);

  return sizes;
}
