import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { cleanupOldPings } from './lib/privacy';
import { fetchAndApplyServerConfig } from './lib/supabase';

// Suppress Vite HMR WebSocket error in embedded previews
// (AI Studio iframe blocks the WebSocket — not a production issue)
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

fetchAndApplyServerConfig().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
