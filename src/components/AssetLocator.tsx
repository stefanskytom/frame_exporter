import { useId, useRef, type InputHTMLAttributes } from 'react';

interface Props {
  assetCount: number;
  atlasCount: number;
  imageCount: number;
  onAssets: (files: File[]) => void;
  disabled?: boolean;
}

export function AssetLocator({
  assetCount,
  atlasCount,
  imageCount,
  onAssets,
  disabled,
}: Props) {
  const folderId = useId();
  const filesId = useId();
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  const take = (list: FileList | null) => {
    if (!list?.length) return;
    onAssets(Array.from(list));
  };

  const folderInputProps = {
    webkitdirectory: '',
    directory: '',
  } as InputHTMLAttributes<HTMLInputElement>;

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>2. Lokalizacja assetów</h2>
        <p>
          Wskaż folder z obrazami PNG używanymi przez animację (np. <code>images/</code>).
          Plik <code>.atlas</code> jest opcjonalny — tylko jeśli eksport był spakowany.
        </p>
      </header>

      <div className="asset-actions">
        <label htmlFor={folderId} className={`btn secondary ${disabled ? 'disabled' : ''}`}>
          Wybierz folder assetów
          <input
            id={folderId}
            ref={folderRef}
            type="file"
            multiple
            disabled={disabled}
            hidden
            {...folderInputProps}
            onChange={(e) => {
              take(e.target.files);
              e.target.value = '';
            }}
          />
        </label>

        <label htmlFor={filesId} className={`btn ghost ${disabled ? 'disabled' : ''}`}>
          Lub wybierz pliki .png / .atlas
          <input
            id={filesId}
            ref={filesRef}
            type="file"
            multiple
            disabled={disabled}
            hidden
            onChange={(e) => {
              take(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      <div className="asset-stats" aria-live="polite">
        {assetCount === 0 ? (
          <span className="muted">Nie wczytano jeszcze assetów graficznych.</span>
        ) : (
          <span>
            Wczytano <strong>{assetCount}</strong> plików — obrazów:{' '}
            <strong>{imageCount}</strong>, atlasów: <strong>{atlasCount}</strong>
          </span>
        )}
      </div>
    </section>
  );
}
