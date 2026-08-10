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
  { value: '{name}', label: 'nazwa (tylko pierwsza klatka)' },
  { value: 'custom', label: 'Własny wzorzec…' },
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
        <h2>4. Ustawienia eksportu</h2>
        <p>Skala, rozmiar canvasu, nazewnictwo klatek i tryb eksportu.</p>
      </header>

      <div className="settings-grid">
        <label>
          Szerokość canvasu (px)
          <input
            type="number"
            min={1}
            max={4096}
            value={settings.canvasWidth}
            onChange={(e) => set('canvasWidth', Number(e.target.value) || 1)}
          />
        </label>

        <label>
          Wysokość canvasu (px)
          <input
            type="number"
            min={1}
            max={4096}
            value={settings.canvasHeight}
            onChange={(e) => set('canvasHeight', Number(e.target.value) || 1)}
          />
        </label>

        <label>
          Skala klatek
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
          FPS eksportu
          <input
            type="number"
            min={1}
            max={120}
            value={settings.fps}
            disabled={settings.firstFrameOnly}
            onChange={(e) => set('fps', Number(e.target.value) || 1)}
          />
        </label>

        <label className="span-2 checkbox">
          <input
            type="checkbox"
            checked={settings.firstFrameOnly}
            onChange={(e) => set('firstFrameOnly', e.target.checked)}
          />
          Eksportuj tylko pierwszą (początkową) klatkę wybranej animacji
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
          Liczba cyfr w numerze
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
            Własny wzorzec
            <input
              type="text"
              value={settings.customNaming}
              placeholder="{name}_{anim}_{####}"
              onChange={(e) => set('customNaming', e.target.value)}
            />
            <span className="field-hint">
              Placeholdery: {'{name}'}, {'{anim}'}, {'{frame}'}, {'{####}'}, {'{index}'}
            </span>
          </label>
        )}

        <div className="span-2 preview-name">
          Przykład nazwy: <code>{preview}.png</code>
        </div>

        <label className="span-2 checkbox">
          <input
            type="checkbox"
            checked={settings.transparentBackground}
            onChange={(e) => set('transparentBackground', e.target.checked)}
          />
          Przezroczyste tło
        </label>

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

        <label className="span-2 checkbox">
          <input
            type="checkbox"
            checked={settings.premultipliedAlpha}
            onChange={(e) => set('premultipliedAlpha', e.target.checked)}
          />
          Premultiplied alpha (PMA) — włącz tylko gdy tekstury/atlas są w formacie PMA
        </label>
      </div>
    </section>
  );
}
