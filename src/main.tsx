import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { cleanupOldPings } from './lib/privacy';
import { fetchAndApplyServerConfig } from './lib/supabase';

// Suppress Vite HMR WebSocket error in embedded previews
window.addEventListener('unhandledrejection', (event) => {
  if (
    event.reason?.message?.includes('WebSocket') ||
    event.reason?.message?.includes('websocket')
  ) {
    event.preventDefault();
  }
});

// Run data retention policies
cleanupOldPings();

// CRITICAL: Await Supabase config BEFORE mounting React.
// Without this, getSession() fires against the dummy URL (race condition)
// and users are shown the login screen even with a valid session.
fetchAndApplyServerConfig()
  .catch(() => {})
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
