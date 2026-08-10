import type { SkeletonJob } from '../types';

interface Props {
  jobs: SkeletonJob[];
  atlasOptions: string[];
  onChangeAnimation: (id: string, animation: string) => void;
  onChangeAtlas: (id: string, atlasFileName: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

const statusLabel: Record<SkeletonJob['status'], string> = {
  ready: 'Gotowy',
  'missing-assets': 'Brak assetów',
  error: 'Błąd',
};

export function SkeletonList({
  jobs,
  atlasOptions,
  onChangeAnimation,
  onChangeAtlas,
  onRemove,
  onClear,
}: Props) {
  if (jobs.length === 0) return null;

  return (
    <section className="panel">
      <header className="panel-header row">
        <div>
          <h2>3. Animacje do eksportu</h2>
          <p>
            Każdy JSON trafi do osobnego folderu. Wybierz animację źródłową dla każdego
            pliku.
          </p>
        </div>
        <button type="button" className="btn ghost" onClick={onClear}>
          Wyczyść listę
        </button>
      </header>

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
              </div>
              <div className="job-meta">
                <span>{job.file.name}</span>
                {job.assetMode === 'atlas' && job.atlasFileName && (
                  <span>atlas: {job.atlasFileName}</span>
                )}
                {job.assetMode === 'images' && (
                  <span>
                    images: {job.imagesPath} · {job.requiredImagePaths.length} plików
                  </span>
                )}
              </div>
              {job.error && <p className="job-error">{job.error}</p>}
            </div>

            <div className="job-controls">
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

              {atlasOptions.length > 0 && (
                <label>
                  Atlas (opcjonalnie)
                  <select
                    value={job.atlasFileName ?? ''}
                    onChange={(e) => onChangeAtlas(job.id, e.target.value)}
                  >
                    <option value="">— auto / obrazy —</option>
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
    </section>
  );
}
