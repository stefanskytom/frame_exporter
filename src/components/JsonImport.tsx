import { useId, useRef, type InputHTMLAttributes } from 'react';

interface Props {
  onJsonFiles: (files: File[]) => void;
  disabled?: boolean;
}

export function JsonImport({ onJsonFiles, disabled }: Props) {
  const filesId = useId();
  const folderId = useId();
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    const jsons = Array.from(list).filter((f) => f.name.toLowerCase().endsWith('.json'));
    if (jsons.length) onJsonFiles(jsons);
  };

  const folderInputProps = {
    webkitdirectory: '',
    directory: '',
  } as InputHTMLAttributes<HTMLInputElement>;

  return (
    <section className="panel">
      <header className="panel-header">
        <div className="step-index">1</div>
        <div>
          <h2>Spine JSON files</h2>
          <p>One or many files — from a file list or an entire folder.</p>
        </div>
      </header>

      <div
        className={`dropzone ${disabled ? 'disabled' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (disabled) return;
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="dropzone-icon" aria-hidden>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 16V4m0 0 4 4m-4-4-4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <span className="dropzone-title">Drop .json files here</span>
        <span className="dropzone-hint">or pick from disk</span>

        <div className="dropzone-actions">
          <label htmlFor={filesId} className={`btn secondary ${disabled ? 'disabled' : ''}`}>
            Choose files
            <input
              id={filesId}
              ref={filesRef}
              type="file"
              multiple
              disabled={disabled}
              hidden
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>

          <label htmlFor={folderId} className={`btn ghost ${disabled ? 'disabled' : ''}`}>
            Choose folder
            <input
              id={folderId}
              ref={folderRef}
              type="file"
              multiple
              disabled={disabled}
              hidden
              {...folderInputProps}
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
