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
        <div className="step-index">2</div>
        <div>
          <h2>Asset location</h2>
          <p>
            PNG folder (e.g. <code>images/</code>). <code>.atlas</code> only needed for packed
            exports.
          </p>
        </div>
      </header>

      <div className="asset-actions">
        <label htmlFor={folderId} className={`btn secondary ${disabled ? 'disabled' : ''}`}>
          Choose assets folder
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
          .png / .atlas files
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

      <div className={`asset-stats ${assetCount > 0 ? 'filled' : ''}`} aria-live="polite">
        {assetCount === 0 ? (
          <span className="muted">No assets loaded yet</span>
        ) : (
          <div className="stat-pills">
            <span className="stat-pill">
              <strong>{assetCount}</strong> files
            </span>
            <span className="stat-pill">
              <strong>{imageCount}</strong> images
            </span>
            <span className="stat-pill">
              <strong>{atlasCount}</strong> atlases
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
