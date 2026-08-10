import type { ExportSettings, NamingPattern } from '../types';
import { resolveNamingTemplate } from '../lib/naming';
import { formatFrameName } from '../lib/naming';

interface Props {
  settings: ExportSettings;
  onChange: (next: ExportSettings) => void;
}

const NAMING_OPTIONS: { value: NamingPattern; label: string }[] = [
  { value: '{name}_{####}', label: 'nazwa_0001' },
  { value: '{name}_{frame}', label: 'nazwa_1' },
  { value: '{####}', label: '0001' },
  { value: '{name}', label: 'nazwa' },
  { value: 'custom', label: 'Własny…' },
];

export function ExportSettingsPanel({ settings, onChange }: Props) {
  const set = <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const preview = formatFrameName(resolveNamingTemplate(settings), {
    name: 'hero',
    anim: 'walk',
    frame: 1,
    index: 0,
    paddingDigits: settings.paddingDigits,
  });

  return (
    <section className="panel">
      <header className="panel-header">
        <div className="step-index">4</div>
        <div>
          <h2>Ustawienia eksportu</h2>
          <p>Canvas, skala, zakres animacji i nazewnictwo klatek.</p>
        </div>
      </header>

      <div className="settings-grid">
        <div className="span-2 toggle-row">
          <div>
            <div className="toggle-title">Wszystkie animacje</div>
            <div className="toggle-desc">
              Eksport każdej animacji do osobnego folderu wewnątrz folderu JSON
              <code className="inline-path"> json / animacja / klatki </code>
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.exportAllAnimations}
              onChange={(e) => set('exportAllAnimations', e.target.checked)}
            />
            <span className="switch-track" />
          </label>
        </div>

        <div className="span-2 toggle-row">
          <div>
            <div className="toggle-title">Tylko pierwsza klatka</div>
            <div className="toggle-desc">Eksportuje wyłącznie klatkę początkową animacji</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.firstFrameOnly}
              onChange={(e) => set('firstFrameOnly', e.target.checked)}
            />
            <span className="switch-track" />
          </label>
        </div>

        <label>
          Szerokość (px)
          <input
            type="number"
            min={1}
            max={4096}
            value={settings.canvasWidth}
            onChange={(e) => set('canvasWidth', Number(e.target.value) || 1)}
          />
        </label>

        <label>
          Wysokość (px)
          <input
            type="number"
            min={1}
            max={4096}
            value={settings.canvasHeight}
            onChange={(e) => set('canvasHeight', Number(e.target.value) || 1)}
          />
        </label>

        <label>
          Skala
          <input
            type="number"
            min={0.05}
            max={8}
            step={0.05}
            value={settings.scale}
            onChange={(e) => set('scale', Number(e.target.value) || 1)}
          />
        </label>

        <label>
          FPS
          <input
            type="number"
            min={1}
            max={120}
            value={settings.fps}
            disabled={settings.firstFrameOnly}
            onChange={(e) => set('fps', Number(e.target.value) || 1)}
          />
        </label>

        <label>
          Nazwy klatek
          <select
            value={settings.namingPattern}
            onChange={(e) => set('namingPattern', e.target.value as NamingPattern)}
          >
            {NAMING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Cyfry numeru
          <input
            type="number"
            min={1}
            max={8}
            value={settings.paddingDigits}
            onChange={(e) => set('paddingDigits', Number(e.target.value) || 1)}
          />
        </label>

        {settings.namingPattern === 'custom' && (
          <label className="span-2">
            Wzorzec
            <input
              type="text"
              value={settings.customNaming}
              placeholder="{name}_{anim}_{####}"
              onChange={(e) => set('customNaming', e.target.value)}
            />
            <span className="field-hint">
              {'{name}'}, {'{anim}'}, {'{frame}'}, {'{####}'}, {'{index}'}
            </span>
          </label>
        )}

        <div className="span-2 preview-name">
          Przykład: <code>{preview}.png</code>
        </div>

        <div className="span-2 toggle-row">
          <div>
            <div className="toggle-title">Przezroczyste tło</div>
            <div className="toggle-desc">PNG z kanałem alpha</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.transparentBackground}
              onChange={(e) => set('transparentBackground', e.target.checked)}
            />
            <span className="switch-track" />
          </label>
        </div>

        {!settings.transparentBackground && (
          <label>
            Kolor tła
            <input
              type="color"
              value={settings.backgroundColor}
              onChange={(e) => set('backgroundColor', e.target.value)}
            />
          </label>
        )}

        <div className="span-2 toggle-row">
          <div>
            <div className="toggle-title">Premultiplied alpha</div>
            <div className="toggle-desc">Włącz tylko dla tekstur/atlasu PMA</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.premultipliedAlpha}
              onChange={(e) => set('premultipliedAlpha', e.target.checked)}
            />
            <span className="switch-track" />
          </label>
        </div>
      </div>
    </section>
  );
}
