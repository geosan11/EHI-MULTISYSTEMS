import { PRICING, CARGO_ROUTES } from './constants.js';
import { Transaction, PaymentMode } from './types.js';
import type { ChangeEvent } from 'react';

// Money math done as plain float multiplication/division (e.g. amount * (1
// - commissionRate / 100)) routinely lands a fraction of a kobo off an exact
// value -- 8300 * (1 - 7/100) is 7718.999999999999, not 7719 -- because 0.07
// has no exact binary representation. A single result like that displays
// fine (fmt() rounds it), but summing many such near-misses across a ledger
// before ever rounding lets the error compound into a visibly wrong total.
// Round each line item to the nearest kobo immediately after computing it,
// before it goes into any sum.
// Free-text fields across the entry forms (consignee names, remarks,
// content descriptions, etc.) are meant to be recorded in all-caps for
// consistency with printed tags/receipts. Wrapping a setState function with
// this gives a drop-in onChange handler that uppercases as the agent types,
// instead of every form re-implementing `e.target.value.toUpperCase()` by
// hand. Not for phone numbers or numeric fields -- only apply to free text.
export const upperOnChange = (setter: (v: string) => void) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setter(e.target.value.toUpperCase());

export const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;

export const fmt = (amount: number) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount).replace('NGN', '₦');
};

// Deliberately matches against the bundled CARGO_ROUTES constant, not the
// live hubs table (src/lib/hubRoutes.ts) -- this file is also imported
// server-side (server/emailParser.ts), and hubRoutes.ts pulls in
// supabase.ts, which touches `localStorage` at module load time and
// crashes plain Node. A hub added after this constant was last updated
// just falls through to the generic derived-code fallback below, same as
// today.
export function getHubCode(hubName: string | null | undefined): string {
  if (!hubName) return 'XXX';
  const normalized = hubName.toLowerCase();
  for (const route of CARGO_ROUTES) {
    if (route === 'Other') continue;
    const [code, city] = route.split('/');
    if (normalized.includes(city.toLowerCase()) || normalized.includes(code.toLowerCase())) {
      return code.toUpperCase();
    }
  }
  return hubName.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 3).padEnd(3, 'X');
}

export function getCityName(routeStr: string | null | undefined): string {
  if (!routeStr) return 'UNKNOWN';
  if (routeStr === 'Other') return 'Other';
  const parts = routeStr.split('/');
  return parts.length > 1 ? parts[1] : routeStr;
}

// Opens a blob-URL PDF in a new tab for the browser's native print dialog,
// falling back to a forced download if that fails. window.open() for a
// blob: URL is unreliable inside an installed PWA's standalone display
// window -- some platforms throw a SecurityError, others silently return
// null -- even though the identical call works fine in a normal browser
// tab. Returns the opened window (if any) so callers that want to
// auto-trigger print() can do so.
//
// Pass `preOpenedWindow` when the caller already called
// `window.open('', '_blank')` synchronously inside the click handler,
// before any await. That matters because every caller here builds the PDF
// (dynamic import, QR generation, image loads, PDF rendering) before a
// blob: URL exists to open -- by the time this function runs, several
// async ticks have passed since the click, and mobile browsers/installed
// PWAs treat window.open() at that point as an unrequested popup and
// block it, even though the exact same call succeeds when it happens
// synchronously inside the gesture. Navigating a window that was already
// opened during the gesture sidesteps that entirely -- for a normal
// browser tab.
//
// An installed/standalone PWA is a separate problem that pre-opening
// doesn't solve: window.open() there frequently hands off to a genuinely
// different browser process (Safari.app on iOS, sometimes Chrome itself
// on Android) rather than an in-app tab. That process has no access to a
// blob: URL created inside the PWA's own isolated JS realm, so it shows a
// blank/invalid-address page -- and because setting .location.href
// doesn't throw synchronously, this failure is silent: `win` stays
// truthy and the function reports success while nothing is visible to
// the user. A forced download never opens a new browsing context at all
// -- it's a same-document DOM action -- so it's the only path that's
// actually reliable once the app is running standalone.
export function isStandalonePWA(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  } catch {
    return false;
  }
}

export function openPdfOrDownload(url: string, filename: string, preOpenedWindow?: Window | null): Window | null {
  if (isStandalonePWA()) {
    preOpenedWindow?.close();
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return null;
  }

  let win: Window | null = null;
  if (preOpenedWindow !== undefined) {
    win = preOpenedWindow;
    if (win) {
      try {
        win.location.href = url;
      } catch {
        win = null;
      }
    }
  } else {
    try {
      win = window.open(url, '_blank');
    } catch {
      win = null;
    }
  }
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  return win;
}

// react-pdf/Yoga doesn't expose real font-metrics text measurement before
// render, so a receipt's page height (computed ahead of time from a fixed
// per-field guess -- see CargoReceipt.tsx/ExcessBaggageReceipt.tsx) has no
// way to know a free-text field (consignee name, passenger name, a long
// route/destination string) will wrap onto extra lines until it's too
// late: an under-estimate doesn't clip content, it silently pushes it onto
// a second, mostly-blank page. This estimates wrapped line count from an
// average glyph-width factor for Helvetica-Bold so callers can pad their
// height guess before that happens -- deliberately generous (a receipt
// with a little trailing blank space is fine; one that spills a page is not).
export function estimateWrappedLines(text: string, colWidthPt: number, fontSizePt: number): number {
  const avgCharWidth = fontSizePt * 0.6;
  const charsPerLine = Math.max(1, Math.floor(colWidthPt / avgCharWidth));
  return Math.max(1, Math.ceil((text || '').length / charsPerLine));
}

// serial is a caller-supplied value used purely to keep same-day narration
// codes at the same hub visually distinct for staff manually matching a
// bank-transfer alert to a sale -- it's not a database key, so it isn't
// worth an atomic server-side sequence the way AWB numbers are. Padded to
// 4 digits (was 3, a 900-value space) since a busy hub can plausibly issue
// enough same-day Transfer/POS transactions for a 3-digit random serial to
// collide (birthday-paradox: ~50% odds after ~36 draws in one day).
export const generatePaymentNarration = (hubName: string, serial: string | number): string => {
  let code = getHubCode(hubName);
  const d = new Date();
  const yymmdd = [
    d.getFullYear().toString().slice(2),
    (d.getMonth() + 1).toString().padStart(2, '0'),
    d.getDate().toString().padStart(2, '0')
  ].join('');
  const ser = serial.toString().padStart(4, '0');
  return `EHI-${code}-${yymmdd}-${ser}`;
};

export const extractNarrationFromText = (text: string): string | null => {
  const match = text.match(/EHI-[A-Z]{2,4}-\d{6}-\d{3,4}/i);
  return match ? match[0].toUpperCase() : null;
};

export const uid = (prefix: 'WB' | 'VJ' | 'AC' | 'MK' | 'CG' | 'TR'): string => {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${dateStr}-${randomStr}`;
};

export const tnow = (): string => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
};

export function generatePickupPin(): string {
  return String(Math.floor(10000 + Math.random() * 90000));
}

// ── DAILY ENTRIES CSV DOWNLOAD ────────────────────────────────
// `transactions` is expected to already be scoped to whatever date range /
// filters the caller applied (e.g. TransactionLedger's `filteredEntries`) --
// this function must not re-filter it, or a caller-selected date range would
// silently get discarded and replaced with "today only".
export function downloadDailyCSV(
  streamType: 'cargo' | 'baggage' | 'marketing' | 'package' | 'mixed',
  transactions: any[],
  hubName: string
): void {
  const today = new Date().toISOString().slice(0, 10);
  const generatedLabel = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  let headers: string[];
  let rows: string[][];

  if (streamType === 'cargo') {
    headers = ['Ref', 'Time', 'Consignee', 'AWB/Tag', 'Airline', 'Route', 'Pieces', 'KG', 'Content', 'Amount', 'Mode', 'Bank', 'Status'];
    rows = transactions.map(t => {
      const parts = t.detail?.split(' · ') || [];
      return [
        t.id,
        t.time || '',
        t.name || '',
        t.awb_tag_number || parts[1] || '',
        t.airline || parts[0] || '',
        t.route || parts[4] || '',
        String(t.pieces || parts[2]?.replace('pcs','') || ''),
        String(t.kg || ''),
        t.contentType || parts[5] || '',
        String(t.amount || 0),
        t.mode || '',
        t.bank || '',
        t.status || 'Intake',
      ];
    });
  } else if (streamType === 'baggage') {
    headers = ['Ref', 'Time', 'Airline', 'Passenger', 'PNR', 'Flight', 'Destination', 'PCS', 'Total KG', 'Excess KG', 'Amount', 'Mode', 'Bank'];
    rows = transactions.map(t => [
      t.id,
      t.time || '',
      t.airline || 'ValueJet',
      t.name || '',
      t.pnr || '',
      t.flight || '',
      t.destination || '',
      String(t.pieces || ''),
      String(t.totalKg || ''),
      String(t.excessKg || t.kg || ''),
      String(t.amount || 0),
      t.mode || '',
      t.bank || '',
    ]);
  } else if (streamType === 'marketing') {
    headers = ['Ref', 'Time', 'Customer', 'Phone', 'Route', 'Big Bags', 'Med Bags', 'Sm Bags', 'Amount', 'Mode', 'Bank'];
    rows = transactions.map(t => {
      const bags = t.detail?.split(' · ')[1] || '';
      const bb = bags.match(/(\d+)BB/)?.[1] || '';
      const mb = bags.match(/(\d+)MB/)?.[1] || '';
      const sb = bags.match(/(\d+)SB/)?.[1] || '';
      return [
        t.id,
        t.time || '',
        t.name || '',
        '',
        t.route || t.detail?.split(' · ')[0] || '',
        bb, mb, sb,
        String(t.amount || 0),
        t.mode || '',
        t.bank || '',
      ];
    });
  } else if (streamType === 'package') {
    headers = ['Ref', 'Time', 'Name', 'Destination', 'Content Type', 'Pieces', 'KG', 'Contents', 'Amount', 'Mode', 'Bank', 'Status'];
    rows = transactions.map(t => {
      const parts = t.detail?.split(' · ') || [];
      return [
        t.id,
        t.time || '',
        t.name || '',
        t.destination || parts[0] || '',
        t.contentType || parts[1] || '',
        String(t.pieces || parts[2]?.replace('pcs','') || ''),
        String(t.kg || parts[3]?.replace('kg','') || ''),
        t.contents || parts[4] || '',
        String(t.amount || 0),
        t.mode || '',
        t.bank || '',
        t.status || 'Intake',
      ];
    });
  } else {
    // 'mixed' -- generic export for the all-streams Master Ledger view,
    // where entries can be cargo/baggage/marketing/package all at once and
    // none of the stream-specific column sets above apply uniformly.
    headers = ['Ref', 'Time', 'Type', 'Name', 'Detail', 'Amount', 'Mode', 'Bank', 'Status'];
    rows = transactions.map(t => [
      t.id,
      t.time || '',
      t.type || '',
      t.name || '',
      t.detail || '',
      String(t.amount || 0),
      t.mode || '',
      t.bank || '',
      t.status || 'Intake',
    ]);
  }

  // Escape CSV values
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;

  const streamLabel = streamType === 'cargo' ? 'Cargo'
    : streamType === 'baggage' ? 'Excess Baggage'
    : streamType === 'marketing' ? 'Marketing'
    : streamType === 'package' ? 'Package Desk'
    : 'Master Ledger';
  const titleRow = `EHI Multisystems Nigeria Ltd — ${streamLabel} Entries`;
  const dateRow = `Hub: ${hubName} | Generated: ${generatedLabel}`;
  const totalAmount = transactions.reduce((s, t) => s + (t.amount || 0), 0);
  const summaryRow = `Total Entries: ${transactions.length} | Total Revenue: NGN ${totalAmount.toLocaleString('en-NG')}`;

  const csvLines = [
    esc(titleRow),
    esc(dateRow),
    esc(summaryRow),
    '',
    headers.map(esc).join(','),
    ...rows.map(r => r.map(esc).join(',')),
  ];

  const csv = csvLines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EHI_${streamType}_${hubName.replace(/\s+/g,'_')}_${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── AIRLINE NAME NORMALIZATION ────────────────────────────────
// Cargo entries and commission config keys have historically used both short
// and long airline names ("Green Africa" vs "Green Africa Airways"). This
// collapses any known variant to the single canonical long-form name so
// breakdowns and commission lookups never fragment one airline into two rows.
const AIRLINE_NAME_MAP: Record<string, string> = {
  'green africa': 'Green Africa Airways',
  'green africa airways': 'Green Africa Airways',
  'united nigeria': 'United Nigeria Airlines',
  'united nigeria airlines': 'United Nigeria Airlines',
  'arik air': 'Arik Air',
  'arik': 'Arik Air',
};

export function normalizeAirlineName(raw: string | null | undefined): string {
  if (!raw) return 'Unknown';
  const key = raw.trim().toLowerCase();
  return AIRLINE_NAME_MAP[key] || raw.trim();
}

export function cleanRoute(route: string | null | undefined): string {
  if (!route) return '—';
  return route.replace(/\s*(Air\s+)?Cargo\s+Station/gi, '').trim().toUpperCase();
}

// ── SHIFT BOUNDARY ────────────────────────────────────────────
// The "cargo day" in Nigerian domestic stations runs from a hub-
// configured hour (default 19 = 7 PM) to the same hour the next
// calendar day. This replaces the old midnight (00:00) cutoff
// used by EODReconciliation, which was assigning post-midnight
// entries to the wrong operational shift every single day.
//
// Returns { start, end } in local time:
//   - start: today at shiftHour if current time >= shiftHour,
//            else yesterday at shiftHour (we're in previous shift)
//   - end:   start + 24 hours (exclusive)
//
// Example (shiftHour = 19, current time = 23:00 Thursday):
//   start = Thursday 19:00, end = Friday 19:00
//
// Example (shiftHour = 19, current time = 03:00 Friday):
//   start = Thursday 19:00, end = Friday 19:00  ← same shift
//
export function getShiftBoundary(shiftHour: number = 19): { start: Date; end: Date } {
  const now = new Date();
  const currentHour = now.getHours();

  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(shiftHour);

  // If we haven't reached today's shift start yet, we are still
  // inside the shift that started yesterday at shiftHour.
  if (currentHour < shiftHour) {
    start.setDate(start.getDate() - 1);
  }

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

// Formats a shift boundary as a human-readable label for display
// in the EOD header and ledger shift selector.
// e.g. "Thu 17 Jul 7:00 PM → Fri 18 Jul 7:00 PM"
export function formatShiftLabel(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  return `${fmt(start)} → ${fmt(end)}`;
}