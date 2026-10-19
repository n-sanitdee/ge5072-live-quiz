import {StrictMode, Suspense, lazy, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PlayerApp} from './player/PlayerApp.tsx';
import './styles.css';

const HostApp = lazy(() => import('./host/HostApp.tsx'));

// Students use the plain URL (optionally ?pin=123456 from the QR code); the teacher opens #host.
function useIsHost() {
  const [host, setHost] = useState(() => location.hash.replace(/^#\/?/, '') === 'host');
  useEffect(() => {
    const on = () => setHost(location.hash.replace(/^#\/?/, '') === 'host');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return host;
}

function App() {
  const host = useIsHost();
  if (!host) return <PlayerApp />;
  return (
    <Suspense fallback={<div className="screen center"><div className="spinner" /></div>}>
      <HostApp />
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
