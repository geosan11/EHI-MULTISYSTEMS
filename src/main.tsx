import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App.tsx';
import './index.css';
import { cleanupOldPings } from './lib/privacy';
import { fetchAndApplyServerConfig } from './lib/supabase';

// Error monitoring. Deliberately minimal: error capture only, no
// tracesSampleRate/replay/profiling — this app previously had zero
// centralized error visibility (only a 100-entry in-memory per-tab log
// that vanished on refresh), so the priority is knowing an error
// happened at all, not full distributed tracing. VITE_SENTRY_DSN is not
// secret (Sentry DSNs are designed to be public, same as the Supabase
// anon key) so it's safe to bundle client-side. If it's unset, Sentry.init
// is skipped entirely rather than throwing.
const sentryDsn = (import.meta as any).env?.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: (import.meta as any).env?.MODE || 'production',
  });
}

// Suppress Vite HMR WebSocket error in embedded previews
window.addEventListener('unhandledrejection', (event) => {
  if (
    event.reason?.message?.includes('WebSocket') ||
    event.reason?.message?.includes('websocket')
  ) {
    event.preventDefault();
  }
});

// Vite's dynamic-import runtime dispatches this event when a lazily-loaded
// chunk 404s -- this hits any tab (especially an installed PWA, which stays
// open for days) that was already loaded before a new deploy went out: the
// hashed chunk filenames baked into the code already running in that tab
// no longer exist on the server, so import() rejects and every button that
// lazy-loads a print/report module (e.g. escposBaggagePrinting,
// escposMarketingPrinting) fails with a "Failed to fetch dynamically
// imported module" error that has nothing to do with the feature itself.
// A reload re-fetches the current index.html and gets the right hashes.
// Guarded with sessionStorage so a genuinely broken deploy (still 404ing
// after the reload) surfaces its real error instead of reloading forever.
window.addEventListener('vite:preloadError', () => {
  const key = 'ehi_preload_error_reloaded';
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, '1');
    window.location.reload();
  }
});

// The service worker (vite.config.ts: registerType 'autoUpdate') is built
// with skipWaiting + clientsClaim, so a new deploy's SW activates and
// takes control of every already-open tab/installed-PWA instance almost
// immediately -- but that alone does NOT reload the page. The JS that's
// already executing in memory keeps running untouched; only a fresh
// navigation picks up the new bundle. Without this listener, every fix
// shipped in a deploy is invisible to anyone who already had the app open
// (which, for an installed PWA people leave running for days, is the
// common case) until they think to manually force-close and reopen it.
// This is the standard Workbox-recommended pattern: reload once, the
// moment the new SW takes over.
if ('serviceWorker' in navigator) {
  // Only reload on a genuine update -- i.e. this tab was already controlled
  // by a service worker before this listener was attached. On a first-ever
  // install, clientsClaim() hands control of this same, still-loading page
  // to the new SW too, which fires this exact same 'controllerchange' event
  // -- reloading then just restarts the cold-start fetch/parse for no
  // reason, doubling load time on precisely the slow mobile connections
  // where that hurts most (and can land the reload mid-fetch on a flaky
  // connection, making the app appear to fail to open at all).
  const wasAlreadyControlled = !!navigator.serviceWorker.controller;
  let refreshingAfterSWUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wasAlreadyControlled || refreshingAfterSWUpdate) return;
    refreshingAfterSWUpdate = true;
    window.location.reload();
  });
}

// Chrome/Firefox change a focused <input type="number">'s value on mouse
// wheel / trackpad scroll -- an intentional browser feature (it doubles as
// the spinner's scroll shortcut) that's actively harmful here: agents type
// a KG or amount, then scroll the page to reach the next field or the
// summary panel while that input still has focus, silently decrementing
// whatever they just entered by however many scroll ticks fired (50kg
// becoming 47kg, 45.5kg, etc. with zero visible error). This affects every
// numeric field across the app (Cargo/Package/Marketing/ValueJet weight and
// amount fields, commission/rate config, and more) -- rather than adding a
// per-input onWheel guard in ~16 separate files (and remembering it again
// for every future one), blur any focused number input the instant a wheel
// event reaches it. The blur happens synchronously within this handler,
// before the browser's own default wheel-triggered step change would
// apply, so the value is never touched -- the page keeps scrolling
// normally, the input just stops being the thing capturing the scroll.
window.addEventListener('wheel', () => {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.type === 'number') {
    active.blur();
  }
}, { passive: true });

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
