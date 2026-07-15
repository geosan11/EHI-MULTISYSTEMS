import * as qz from 'qz-tray';
import { supabase } from './supabase.js';
import { openPdfOrDownload } from './helpers.js';

// /api/qz/* requires an authenticated caller (server/app.ts wires
// requireAuthenticatedUser onto this route) -- same reasoning as every
// other authenticated fetch in this app (see notifications.ts): without
// this header every request 401s regardless of session validity.
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Per-device printer bindings -- which physical OS printer a "receipt" or
// "tag" print job should land on. This is a hardware fact about the
// terminal, not a user/hub preference, so it lives in localStorage (same
// convention as theme/sidebar state) rather than Supabase -- syncing it
// would mean a laptop's printer name leaking onto every other device the
// same account logs into.
export type PrinterRole = 'receipt' | 'tag';

const storageKey = (role: PrinterRole) => `ehi_qz_printer_${role}`;

export function getConfiguredPrinter(role: PrinterRole): string | null {
  try {
    return localStorage.getItem(storageKey(role)) || null;
  } catch {
    return null;
  }
}

export function setConfiguredPrinter(role: PrinterRole, printerName: string | null): void {
  try {
    if (printerName) {
      localStorage.setItem(storageKey(role), printerName);
    } else {
      localStorage.removeItem(storageKey(role));
    }
  } catch {
    // localStorage unavailable (private browsing, etc.) -- nothing to persist to.
  }
}

let securityConfigured = false;

// QZ Tray only skips its "allow this site to print?" prompt once every
// request is signed by a certificate it trusts. The private key must never
// reach the browser, so both the certificate and each signature are fetched
// from the server (server/qz.ts) instead of being embedded here.
function configureSecurity(): void {
  if (securityConfigured) return;
  securityConfigured = true;

  // rejectOnFailure defaults to false in qz-tray -- without it, a cert-fetch
  // failure (server misconfigured, expired session, network blip) doesn't
  // reject at all; qz-tray just proceeds unsigned (qz-tray.js: `sendCert(null)`),
  // which means ensureConnected() never throws and printPdfSmart's fallback
  // never engages -- the print would instead hit QZ Tray's own untrusted-
  // connection prompt. Explicit true makes a cert failure a real rejection.
  qz.security.setCertificatePromise((resolve, reject) => {
    authHeaders()
      .then((headers) => fetch('/api/qz/cert', { headers }))
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`Cert fetch failed: ${res.status}`))))
      .then(resolve)
      .catch(reject);
  }, { rejectOnFailure: true });

  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise((toSign: string) => (resolve: (v?: string) => void, reject: (v?: string) => void) => {
    authHeaders()
      .then((headers) => fetch('/api/qz/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ request: toSign }),
      }))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Sign request failed: ${res.status}`))))
      .then((body) => resolve(body.signature))
      .catch((err) => reject(err?.message || 'Signing failed'));
  });
}

async function ensureConnected(): Promise<void> {
  configureSecurity();
  if (qz.websocket.isActive()) return;
  await qz.websocket.connect({ retries: 1, delay: 1 });
}

// Lists every printer the OS/QZ Tray knows about, for the Settings picker.
// Throws if QZ Tray isn't installed/running -- callers should treat that as
// "silent printing unavailable on this device" and fall back accordingly.
export async function listPrinters(): Promise<string[]> {
  await ensureConnected();
  const found = await qz.printers.find();
  return Array.isArray(found) ? found : [found];
}

export async function isQzAvailable(): Promise<boolean> {
  try {
    await ensureConnected();
    return true;
  } catch {
    return false;
  }
}

// Sends a base64-encoded PDF straight to a named OS printer via QZ Tray's
// own driver path -- no browser print dialog, no OS device picker. Throws
// on any failure (QZ not running, printer missing/offline, signing
// unreachable); callers must catch this and fall back to the existing
// open-tab/download flow rather than leaving the user with no printout.
export async function printPdfSilently(base64Pdf: string, printerName: string): Promise<void> {
  await ensureConnected();
  const config = qz.configs.create(printerName);
  await qz.print(config, [
    { type: 'pixel', format: 'pdf', flavor: 'base64', data: base64Pdf },
  ]);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Tries to send a PDF straight to a physical printer with zero dialogs via
// QZ Tray before falling back to today's open-tab/download behavior
// (openPdfOrDownload, in helpers.ts). Devices that haven't configured a QZ
// printer for this role -- which today is every device, since it's opt-in
// per terminal, and always true for the Android hub tablets QZ Tray can't
// run on -- pay no cost and see no behavior change: getConfiguredPrinter()
// returns null immediately and this falls straight through. Any failure in
// the silent path (QZ not running, printer renamed/offline, signing
// endpoint unreachable) also falls through rather than leaving the user
// with no printout at all.
//
// Returns whatever openPdfOrDownload returns (null on the silent-print or
// forced-download paths, the opened Window on the manual-print fallback)
// so callers that used to call win.print() themselves after opening still
// can.
export async function printPdfSmart(
  blob: Blob,
  filename: string,
  role: PrinterRole,
  preOpenedWindow?: Window | null,
): Promise<Window | null> {
  const printerName = getConfiguredPrinter(role);
  if (printerName) {
    try {
      const base64 = await blobToBase64(blob);
      await printPdfSilently(base64, printerName);
      preOpenedWindow?.close();
      return null;
    } catch (err) {
      console.error('Silent print failed, falling back to manual print:', err);
    }
  }
  const url = URL.createObjectURL(blob);
  const win = openPdfOrDownload(url, filename, preOpenedWindow);
  // Give the opened tab/PWA-download time to actually load the blob before
  // freeing it -- ExcessBaggageReceipt.tsx used to do this itself; centralizing
  // it here means every printPdfSmart caller gets the same cleanup instead of
  // just the one file that happened to remember to add it.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return win;
}
