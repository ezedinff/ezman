import React, { useEffect, useState } from 'react';
import { Download, X, RefreshCw } from 'lucide-react';

type Phase = 'idle' | 'available' | 'downloading' | 'error';

export const UpdateBanner: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [update, setUpdate] = useState<import('@tauri-apps/plugin-updater').Update | null>(null);

  useEffect(() => {
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return;
    (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const found = await check();
        if (found) {
          setUpdate(found);
          setVersion(found.version);
          setPhase('available');
        }
      } catch {
        // Offline or no release published yet: stay silent.
      }
    })();
  }, []);

  const install = async () => {
    if (!update) return;
    setPhase('downloading');
    try {
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        if (e.event === 'Progress') {
          received += e.data.chunkLength;
          if (total) setProgress(Math.round((received / total) * 100));
        }
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  if (phase === 'idle') return null;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-1.5 bg-blue-600/15 border-b border-blue-500/30 text-xs text-blue-100">
      <div className="flex items-center gap-2">
        {phase === 'downloading' ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
        {phase === 'available' && <span>EZMan {version} is available.</span>}
        {phase === 'downloading' && (
          <span>Downloading update{progress ? ` ${progress}%` : '…'} — the app will restart.</span>
        )}
        {phase === 'error' && <span className="text-rose-300">Update failed: {error}</span>}
      </div>
      <div className="flex items-center gap-2">
        {phase !== 'downloading' && (
          <>
            {phase === 'available' && (
              <button
                onClick={install}
                className="px-2.5 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
              >
                Update &amp; restart
              </button>
            )}
            <button onClick={() => setPhase('idle')} title="Dismiss" className="p-0.5 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
