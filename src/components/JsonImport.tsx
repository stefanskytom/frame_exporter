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
        <h2>1. Pliki Spine JSON</h2>
        <p>Zaimportuj jeden lub wiele plików .json jednocześnie — z listy plików albo z całego folderu.</p>
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
        <span className="dropzone-title">Upuść pliki .json tutaj</span>
        <span className="dropzone-hint">albo wybierz poniżej — w oknie dialogu widać całą zawartość folderu</span>

        <div className="dropzone-actions">
          <label htmlFor={filesId} className={`btn secondary ${disabled ? 'disabled' : ''}`}>
            Wybierz pliki .json
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
            Wybierz folder
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
