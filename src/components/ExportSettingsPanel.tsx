import type { ExportSettings, NamingPattern } from '../types';
import { resolveNamingTemplate } from '../lib/naming';
import { formatFrameName } from '../lib/naming';

interface Props {
  settings: ExportSettings;
  onChange: (next: ExportSettings) => void;
}

const NAMING_OPTIONS: { value: NamingPattern; label: string }[] = [
  { value: '{name}_{####}', label: 'name_0001' },
  { value: '{name}_{frame}', label: 'name_1' },
  { value: '{####}', label: '0001' },
  { value: '{name}', label: 'name' },
  { value: 'custom', label: 'Custom…' },
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
          <h2>Export settings</h2>
          <p>Canvas, scale, animation scope, and frame naming.</p>
        </div>
      </header>

      <div className="settings-grid">
        <div className="span-2 toggle-row">
          <div>
            <div className="toggle-title">All animations</div>
            <div className="toggle-desc">
              Export every animation into its own folder inside the JSON folder
              <code className="inline-path"> json / animation / frames </code>
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
            <div className="toggle-title">First frame only</div>
            <div className="toggle-desc">Export only the starting frame of the animation</div>
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
          Width (px)
          <input
            type="number"
            min={1}
            max={4096}
            value={settings.canvasWidth}
            onChange={(e) => set('canvasWidth', Number(e.target.value) || 1)}
          />
        </label>

        <label>
          Height (px)
          <input
            type="number"
            min={1}
            max={4096}
            value={settings.canvasHeight}
            onChange={(e) => set('canvasHeight', Number(e.target.value) || 1)}
          />
        </label>

        <label>
          Scale
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
          Frame names
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
          Number digits
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
            Pattern
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
          Example: <code>{preview}.png</code>
        </div>

        <div className="span-2 toggle-row">
          <div>
            <div className="toggle-title">Transparent background</div>
            <div className="toggle-desc">PNG with alpha channel</div>
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
            Background color
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
            <div className="toggle-desc">Enable only for PMA textures / atlases</div>
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
