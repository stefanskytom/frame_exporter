import type { SkeletonJob } from '../types';
import type { FrameSizeMap } from '../hooks/useFrameSizes';
import type { FrameSizeInfo } from '../lib/spineExport';

interface Props {
  jobs: SkeletonJob[];
  atlasOptions: string[];
  exportAllAnimations: boolean;
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
  frameSizes: FrameSizeMap;
  onChangeAnimation: (id: string, animation: string) => void;
  onChangeSkin: (id: string, skin: string) => void;
  onChangeAtlas: (id: string, atlasFileName: string) => void;
  onApplySuggestedCanvas?: (width: number, height: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

const statusLabel: Record<SkeletonJob['status'], string> = {
  ready: 'Gotowy',
  'missing-assets': 'Brak assetów',
  error: 'Błąd',
};

function formatPx(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function FrameSizeBlock({
  info,
  scale,
  canvasWidth,
  canvasHeight,
  onApplySuggestedCanvas,
}: {
  info: FrameSizeInfo | { error: string } | { loading: true } | undefined;
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
  onApplySuggestedCanvas?: (width: number, height: number) => void;
}) {
  if (!info) return null;
  if ('loading' in info) {
    return <p className="frame-size muted">Pomiar rozmiaru klatki…</p>;
  }
  if ('error' in info) {
    return <p className="frame-size error">Rozmiar klatki: {info.error}</p>;
  }

  const scaledLabel = `${formatPx(info.scaledWidth)} × ${formatPx(info.scaledHeight)} px`;
  const rawLabel = `${formatPx(info.width)} × ${formatPx(info.height)}`;

  return (
    <div className={`frame-size ${info.fitsCanvas ? 'ok' : 'warn'}`}>
      <div className="frame-size-row">
        <span className="frame-size-label">Rozmiar klatki</span>
        <strong>{scaledLabel}</strong>
        <span className="frame-size-scale">@ skala {scale}</span>
      </div>
      <div className="frame-size-sub">
        bez skali: {rawLabel} · canvas: {canvasWidth} × {canvasHeight}
        {info.fitsCanvas ? ' · mieści się' : ' · wystaje poza canvas'}
      </div>
      <div className="frame-size-sub muted">{info.source}</div>
      {!info.fitsCanvas && onApplySuggestedCanvas && (
        <button
          type="button"
          className="btn ghost compact"
          onClick={() =>
            onApplySuggestedCanvas(info.suggestedCanvasWidth, info.suggestedCanvasHeight)
          }
        >
          Ustaw canvas na {info.suggestedCanvasWidth} × {info.suggestedCanvasHeight}
        </button>
      )}
    </div>
  );
}

export function SkeletonList({
  jobs,
  atlasOptions,
  exportAllAnimations,
  scale,
  canvasWidth,
  canvasHeight,
  frameSizes,
  onChangeAnimation,
  onChangeSkin,
  onChangeAtlas,
  onApplySuggestedCanvas,
  onRemove,
  onClear,
}: Props) {
  return (
    <section className="panel">
      <header className="panel-header row">
        <div className="panel-header-main">
          <div className="step-index">3</div>
          <div>
            <h2>Szkielety</h2>
            <p>
              Tu wybierasz animację, skin oraz widzisz rozmiar klatki (po skali) — po
              wczytaniu JSON i assetów.
            </p>
          </div>
        </div>
        {jobs.length > 0 && (
          <button type="button" className="btn ghost" onClick={onClear}>
            Wyczyść
          </button>
        )}
      </header>

      {jobs.length === 0 ? (
        <div className="empty-jobs">
          <p className="muted">
            Najpierw dodaj pliki <strong>.json</strong> (krok 1) i folder assetów (krok 2).
            Potem pojawią się: wybór skina, animacji oraz pomiar rozmiaru klatki w px.
          </p>
        </div>
      ) : (
      <div className="job-list">
        {jobs.map((job) => (
          <article key={job.id} className={`job-card status-${job.status}`}>
            <div className="job-main">
              <div className="job-title">
                <span className="job-name">{job.name}</span>
                <span className={`badge status-${job.status}`}>{statusLabel[job.status]}</span>
                <span className="badge mode">
                  {job.assetMode === 'atlas' ? 'atlas' : 'obrazy'}
                </span>
                {exportAllAnimations && job.animations.length > 0 && (
                  <span className="badge mode">{job.animations.length} anim.</span>
                )}
                {job.skins.length > 1 && (
                  <span className="badge mode">{job.skins.length} skinów</span>
                )}
              </div>
              <div className="job-meta">
                <span>{job.file.name}</span>
                {job.assetMode === 'atlas' && job.atlasFileName && (
                  <span>{job.atlasFileName}</span>
                )}
                {job.assetMode === 'images' && (
                  <span>
                    {job.imagesPath} · {job.requiredImagePaths.length} tex
                  </span>
                )}
              </div>
              {job.error && <p className="job-error">{job.error}</p>}
              {job.status === 'ready' && (
                <FrameSizeBlock
                  info={frameSizes[job.id]}
                  scale={scale}
                  canvasWidth={canvasWidth}
                  canvasHeight={canvasHeight}
                  onApplySuggestedCanvas={onApplySuggestedCanvas}
                />
              )}
              {job.status === 'missing-assets' && (
                <p className="frame-size muted">
                  Rozmiar klatki pojawi się, gdy assety będą kompletne (status: Gotowy).
                </p>
              )}
            </div>

            <div className="job-controls">
              {!exportAllAnimations && (
                <label>
                  Animacja
                  <select
                    value={job.selectedAnimation}
                    disabled={job.animations.length === 0}
                    onChange={(e) => onChangeAnimation(job.id, e.target.value)}
                  >
                    {job.animations.length === 0 && <option value="">Brak animacji</option>}
                    {job.animations.map((anim) => (
                      <option key={anim} value={anim}>
                        {anim}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {job.skins.length > 0 && (
                <label>
                  Skin
                  <select
                    value={job.selectedSkin}
                    disabled={job.skins.length === 0}
                    onChange={(e) => onChangeSkin(job.id, e.target.value)}
                  >
                    {job.skins.map((skin) => (
                      <option key={skin} value={skin}>
                        {skin}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {atlasOptions.length > 0 && (
                <label>
                  Atlas
                  <select
                    value={job.atlasFileName ?? ''}
                    onChange={(e) => onChangeAtlas(job.id, e.target.value)}
                  >
                    <option value="">auto / obrazy</option>
                    {atlasOptions.map((atlas) => (
                      <option key={atlas} value={atlas}>
                        {atlas}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <button type="button" className="btn ghost danger" onClick={() => onRemove(job.id)}>
                Usuń
              </button>
            </div>
          </article>
        ))}
      </div>
      )}
    </section>
  );
}
