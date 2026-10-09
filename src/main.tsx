import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './smokeBoot';
import App from './App.tsx';
import AppV2 from './v2/AppV2.tsx';

type AppVersion = 'v1' | 'v2';

function readVersion(): AppVersion {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === 'v2' || hash === '2') return 'v2';
  if (hash === 'v1' || hash === '1') return 'v1';
  const stored = localStorage.getItem('frame-exporter-version');
  return stored === 'v2' ? 'v2' : 'v1';
}

function VersionShell() {
  const [version, setVersion] = useState<AppVersion>(readVersion);

  useEffect(() => {
    localStorage.setItem('frame-exporter-version', version);
    const want = version === 'v2' ? 'v2' : 'v1';
    if (window.location.hash.replace(/^#/, '') !== want) {
      window.location.hash = want;
    }
  }, [version]);

  useEffect(() => {
    const onHash = () => setVersion(readVersion());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      <div className="version-switch" role="navigation" aria-label="App version">
        <button
          type="button"
          className={version === 'v1' ? 'active' : ''}
          onClick={() => setVersion('v1')}
        >
          v1 Classic
        </button>
        <button
          type="button"
          className={version === 'v2' ? 'active' : ''}
          onClick={() => setVersion('v2')}
        >
          v2 Tracks
        </button>
      </div>
      {version === 'v2' ? <AppV2 /> : <App />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VersionShell />
  </StrictMode>,
);
