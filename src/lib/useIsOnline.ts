import { useEffect, useState } from 'react';

// Local to whichever form/screen needs it -- deliberately not threaded
// through as a prop from EHIApp.tsx's own isOffline state, since the only
// consumers (the 4 entry forms' Wallet-mode gating) just need to know
// "can a network request be trusted right now", not the richer state
// EHIApp.tsx tracks (pending sync count, etc).
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}
