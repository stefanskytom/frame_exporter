import { createTrackLayer, type TrackLayer } from '../types';

interface Props {
  animations: string[];
  layers: TrackLayer[];
  onChange: (layers: TrackLayer[]) => void;
}

export function TrackMixer({ animations, layers, onChange }: Props) {
  const update = (id: string, patch: Partial<TrackLayer>) => {
    onChange(layers.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const addTrack = () => {
    const nextIndex =
      layers.length === 0 ? 0 : Math.max(...layers.map((l) => l.trackIndex)) + 1;
    onChange([...layers, createTrackLayer(nextIndex, animations[0] ?? '', { loop: nextIndex === 0 })]);
  };

  const removeTrack = (id: string) => {
    if (layers.length <= 1) return;
    onChange(layers.filter((l) => l.id !== id));
  };

  return (
    <section className="panel v2-tracks">
      <header className="panel-header">
        <div className="step-index">3</div>
        <div>
          <h2>Animation tracks</h2>
          <p>
            Layer Spine tracks (e.g. walk on 0 + aim on 1). Higher tracks override only what they
            key — same as Spine Preview.
          </p>
        </div>
      </header>

      <div className="v2-track-list">
        {layers
          .slice()
          .sort((a, b) => a.trackIndex - b.trackIndex)
          .map((layer) => (
            <div key={layer.id} className="v2-track-row">
              <div className="v2-track-badge">T{layer.trackIndex}</div>
              <label className="v2-field">
                <span>Animation</span>
                <select
                  value={layer.animationName}
                  onChange={(e) => update(layer.id, { animationName: e.target.value })}
                >
                  <option value="">— none —</option>
                  {animations.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
              <label className="v2-check">
                <input
                  type="checkbox"
                  checked={layer.loop}
                  onChange={(e) => update(layer.id, { loop: e.target.checked })}
                />
                Loop
              </label>
              <label className="v2-field narrow">
                <span>Delay</span>
                <input
                  type="number"
                  min={0}
                  step={0.05}
                  value={layer.delay}
                  onChange={(e) =>
                    update(layer.id, { delay: Number.parseFloat(e.target.value) || 0 })
                  }
                />
              </label>
              <label className="v2-field narrow">
                <span>Time scale</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={layer.timeScale}
                  onChange={(e) =>
                    update(layer.id, { timeScale: Number.parseFloat(e.target.value) || 0 })
                  }
                />
              </label>
              <label className="v2-field narrow">
                <span>Alpha</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={layer.alpha}
                  onChange={(e) =>
                    update(layer.id, {
                      alpha: Math.min(1, Math.max(0, Number.parseFloat(e.target.value) || 0)),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="btn ghost compact"
                disabled={layers.length <= 1}
                onClick={() => removeTrack(layer.id)}
              >
                Remove
              </button>
            </div>
          ))}
      </div>

      <div className="v2-track-actions">
        <button type="button" className="btn ghost" onClick={addTrack}>
          Add track
        </button>
      </div>
    </section>
  );
}
