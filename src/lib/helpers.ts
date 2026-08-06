import * as XLSX from 'xlsx';
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
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
};

// A sale/debt-clearance paid partly from a customer wallet and partly by
// another method (CargoForm.tsx's chargeWalletForSale auto-split, and the
// same pattern on TransactionLedger.tsx's Edit Transaction screen) is
// recorded as a single `mode` (the non-wallet remainder) plus a
// `wallet_deduction_amount` -- every receipt/print/detail view that only
// prints the bare mode string silently hides the wallet portion. Central
// place to render both components consistently wherever payment mode is
// shown.
export const formatPaymentModeDisplay = (
  mode: string,
  walletDeductionAmount: number | undefined | null,
  totalAmount: number
): string => {
  if (!walletDeductionAmount || walletDeductionAmount <= 0 || mode === 'Wallet') return mode;
  const remainder = Math.max(0, totalAmount - walletDeductionAmount);
  return `${mode} + Wallet (₦${fmt(remainder)} ${mode} · ₦${fmt(walletDeductionAmount)} Wallet)`;
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

// Reconstructs a transaction's full "DD/MM/YYYY HH:MM" display date for
// receipts/tags reprinted later, preferring its real creation timestamp
// for the date portion and its already-captured time string for the time
// portion -- NOT tnow(), which would print the reprint's own time instead
// of when the entry actually happened.
export function txDisplayDateTime(createdAt?: string, timeStr?: string): string {
  const dateStr = createdAt && !isNaN(new Date(createdAt).getTime())
    ? new Date(createdAt).toLocaleDateString('en-GB')
    : new Date().toLocaleDateString('en-GB');
  return `${dateStr} ${timeStr || tnow()}`;
}

// ── DAILY ENTRIES EXCEL DOWNLOAD ───────────────────────────────
// `transactions` is expected to already be scoped to whatever date range /
// filters the caller applied (e.g. TransactionLedger's `filteredEntries`) --
// this function must not re-filter it, or a caller-selected date range would
// silently get discarded and replaced with "today only".
export function downloadDailyExcel(
  streamType: 'cargo' | 'baggage' | 'marketing' | 'package' | 'mixed',
  transactions: any[],
  hubName: string
): void {
  const today = new Date().toISOString().slice(0, 10);
  const generatedLabel = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  let headers: string[];
  let rows: string[][];

  // Derived from created_at, not the bare `time` field (HH:MM only, no
  // day/month/year) -- without a real per-row date, a multi-day export is
  // unreadable date-wise: every row just says e.g. "14:32" with no way to
  // tell which calendar day it belongs to.
  const rowDate = (t: any): string =>
    t.created_at && !isNaN(new Date(t.created_at).getTime())
      ? new Date(t.created_at).toLocaleDateString('en-GB')
      : '';

  const rowDateTime = (iso?: string): string =>
    iso && !isNaN(new Date(iso).getTime())
      ? `${new Date(iso).toLocaleDateString('en-GB')} ${new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : '';

  // Shared columns appended to every stream's row set below: whether this
  // row is a debt-clearance collection (and which original debt it clears),
  // the full partial-payment trail, and whether/how much of this entry was
  // paid from a customer wallet. Every one of these already exists on the
  // Transaction object and is already shown on screen (TransactionLedger's
  // COLLECTION badge, PARTIAL badge, and Wallet badge/amount) -- this CSV
  // just never carried them through.
  const debtAndWalletCols = (t: any): string[] => {
    const isDC = !!t.is_debt_clearance || (typeof t.id === 'string' && t.id.startsWith('DC-'));
    const history = Array.isArray(t.paymentHistory) ? t.paymentHistory : [];
    const partialSummary = history
      .map((p: any) => `${fmt(p.amount || 0)} ${p.mode || ''} by ${p.by || ''} @ ${rowDateTime(p.at)}`.trim())
      .join(' | ');
    return [
      isDC ? 'YES' : 'NO',
      isDC ? (t.related_tx_id || '') : '',
      t.debtPaidAt ? rowDateTime(t.debtPaidAt) : '',
      history.length > 0 ? 'YES' : 'NO',
      partialSummary,
      t.wallet_id ? 'YES' : 'NO',
      t.wallet_deduction_amount ? String(t.wallet_deduction_amount) : '',
      t.retrievedAt ? rowDateTime(t.retrievedAt) : '',
      t.retrievedBy || '',
    ];
  };
  const debtAndWalletHeaders = [
    'Debt Clearance?', 'Cleared Debt Ref', 'Debt Cleared At',
    'Partial Payment?', 'Partial Payment History',
    'Wallet Used?', 'Wallet Deduction Amount',
    'Retrieved At', 'Retrieved By',
  ];

  if (streamType === 'cargo') {
    headers = ['Ref', 'Date', 'Time', 'Consignee', 'AWB/Tag', 'Airline', 'Route', 'Pieces', 'KG', 'Content', 'Amount', 'Mode', 'Bank', 'Status', ...debtAndWalletHeaders];
    rows = transactions.map(t => {
      // No AWB/tag segment in `detail` anymore (it always duplicated
      // awb_tag_number/entry_ref) -- t.awb_tag_number is the only source now.
      const parts = t.detail?.split(' · ') || [];
      return [
        t.id,
        rowDate(t),
        t.time || '',
        t.name || '',
        t.awb_tag_number || '',
        t.airline || parts[0] || '',
        getHubCode(t.route || parts[3] || ''),
        String(t.pieces != null ? t.pieces : (parts[1]?.replace(/pcs/i,'') || '')),
        String(t.kg != null ? t.kg : (parts[2]?.replace(/kg/i,'') || '')),
        t.contentType || parts[4] || '',
        String(t.amount || 0),
        formatPaymentModeDisplay(t.mode || '', t.wallet_deduction_amount, t.amount || 0),
        t.bank || '',
        t.status || 'Intake',
        ...debtAndWalletCols(t),
      ];
    });
  } else if (streamType === 'baggage') {
    headers = ['Ref', 'Date', 'Time', 'Airline', 'Passenger', 'PNR', 'Flight', 'Destination', 'PCS', 'Total KG', 'Excess KG', 'Amount', 'Mode', 'Bank', ...debtAndWalletHeaders];
    rows = transactions.map(t => [
      t.id,
      rowDate(t),
      t.time || '',
      t.airline || 'ValueJet',
      t.name || '',
      t.pnr || '',
      t.flight || '',
      getHubCode(t.destination || ''),
      String(t.pieces || ''),
      String(t.totalKg || ''),
      String(t.excessKg || t.kg || ''),
      String(t.amount || 0),
      formatPaymentModeDisplay(t.mode || '', t.wallet_deduction_amount, t.amount || 0),
      t.bank || '',
      ...debtAndWalletCols(t),
    ]);
  } else if (streamType === 'marketing') {
    headers = ['Ref', 'Date', 'Time', 'Customer', 'Phone', 'Route', 'Big Bags', 'Med Bags', 'Sm Bags', 'Amount', 'Mode', 'Bank', ...debtAndWalletHeaders];
    rows = transactions.map(t => {
      const bags = t.detail?.split(' · ')[1] || '';
      const bb = bags.match(/(\d+)BB/)?.[1] || '';
      const mb = bags.match(/(\d+)MB/)?.[1] || '';
      const sb = bags.match(/(\d+)SB/)?.[1] || '';
      return [
        t.id,
        rowDate(t),
        t.time || '',
        t.name || '',
        '',
        getHubCode(t.route || t.detail?.split(' · ')[0] || ''),
        bb, mb, sb,
        String(t.amount || 0),
        formatPaymentModeDisplay(t.mode || '', t.wallet_deduction_amount, t.amount || 0),
        t.bank || '',
        ...debtAndWalletCols(t),
      ];
    });
  } else if (streamType === 'package') {
    headers = ['Ref', 'Date', 'Time', 'Name', 'Destination', 'Content Type', 'Pieces', 'KG', 'Contents', 'Amount', 'Mode', 'Bank', 'Status', ...debtAndWalletHeaders];
    rows = transactions.map(t => {
      const parts = t.detail?.split(' · ') || [];
      return [
        t.id,
        rowDate(t),
        t.time || '',
        t.name || '',
        getHubCode(t.destination || parts[0] || ''),
        t.contentType || parts[1] || '',
        String(t.pieces != null ? t.pieces : (parts[2]?.replace(/pcs/i,'') || '')),
        String(t.kg != null ? t.kg : (parts[3]?.replace(/kg/i,'') || '')),
        t.contents || parts[4] || '',
        String(t.amount || 0),
        formatPaymentModeDisplay(t.mode || '', t.wallet_deduction_amount, t.amount || 0),
        t.bank || '',
        t.status || 'Intake',
        ...debtAndWalletCols(t),
      ];
    });
  } else {
    // 'mixed' -- generic export for the all-streams Master Ledger view,
    // where entries can be cargo/baggage/marketing/package all at once and
    // none of the stream-specific column sets above apply uniformly. Airline
    // and Pieces get their own columns (matching the stream-specific exports
    // above) instead of being buried in one combined text field. Route and
    // Content are likewise their own columns rather than one concatenated
    // "Detail" string -- Route is reduced to its bare 3-letter hub code
    // (matching the stream-specific exports above) instead of the full
    // "CODE/City" text, and Content never repeats the route/hub code that's
    // already in its own column.
    headers = ['Ref', 'Date', 'Time', 'Type', 'Name', 'Airline', 'Route', 'Content', 'Pieces', 'KG', 'Amount', 'Mode', 'Bank', 'Status', ...debtAndWalletHeaders];
    rows = transactions.map(t => {
      const parts = t.detail?.split(' · ') || [];
      // t.route/t.destination cover essentially every real entry; the
      // per-type parts[] index is only a fallback for legacy rows recorded
      // before those dedicated fields existed, mirroring each type's own
      // original position in the shared `detail` string.
      const legacyRouteFallback = t.type === 'cargo' ? parts[3] : t.type === 'baggage' ? parts[1] : parts[0];
      const route = getHubCode(t.route || t.destination || legacyRouteFallback || '');
      let content = '';
      if (t.type === 'cargo') {
        content = [t.contentType || parts[4] || '', t.sizeInches ? `${t.sizeInches}in` : ''].filter(Boolean).join(' · ');
      } else if (t.type === 'baggage') {
        content = t.flight || parts[0] || '';
      } else if (t.type === 'package') {
        content = [t.contentType || parts[1] || '', t.contents || parts[4] || ''].filter(Boolean).join(' · ');
      } else if (t.type === 'marketing') {
        // Bag-count breakdown, same source as the marketing-specific export
        // above -- deliberately excludes parts[0] (the route), which is
        // already its own column here.
        content = parts[1] || '';
      }
      return [
        t.id,
        rowDate(t),
        t.time || '',
        t.type || '',
        t.name || '',
        t.airline || '',
        route,
        content,
        String(t.pieces ?? ''),
        String(t.kg ?? t.totalKg ?? ''),
        String(t.amount || 0),
        formatPaymentModeDisplay(t.mode || '', t.wallet_deduction_amount, t.amount || 0),
        t.bank || '',
        t.status || 'Intake',
        ...debtAndWalletCols(t),
      ];
    });
  }

  const streamLabel = streamType === 'cargo' ? 'Cargo'
    : streamType === 'baggage' ? 'Excess Baggage'
    : streamType === 'marketing' ? 'Marketing'
    : streamType === 'package' ? 'Package Desk'
    : 'Master Ledger';
  const titleRow = `EHI Multisystems Nigeria Ltd — ${streamLabel} Entries`;
  const dateRow = `Hub: ${hubName} | Generated: ${generatedLabel}`;
  const totalAmount = transactions.reduce((s, t) => s + (t.amount || 0), 0);
  const summaryRow = `Total Entries: ${transactions.length} | Total Revenue: NGN ${totalAmount.toLocaleString('en-NG')}`;

  const aoa = [
    [titleRow],
    [dateRow],
    [summaryRow],
    [],
    headers,
    ...rows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(sanitizeSpreadsheetAoA(aoa));
  autoFitWorksheetColumns(ws);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, streamLabel.slice(0, 31));
  XLSX.writeFile(wb, `EHI_${streamType}_${hubName.replace(/\s+/g,'_')}_${today}.xlsx`);
}

// ── PER-AIRLINE MANIFEST EXCEL DOWNLOAD ───────────────────────
// A separate, narrower export from downloadDailyExcel above -- meant to be
// handed to (or checked against) an airline's own manifest for a
// route/flight: just tag number, content, kg, route, and amount collected,
// grouped by airline and listed in chronological order within each group.
export function downloadAirlineManifestExcel(
  transactions: any[],
  hubName: string
): void {
  const today = new Date().toISOString().slice(0, 10);
  const generatedLabel = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Only cargo/baggage entries carry a meaningful airline+route+kg pairing.
  const relevant = transactions.filter(t => (t.type === 'cargo' || t.type === 'baggage') && t.airline);

  // Group by normalized airline name (this app's own established grouping
  // convention -- see normalizeAirlineName's own callers), then sort each
  // group chronologically (oldest first) so it reads like a real manifest
  // in the order goods actually came in, not database insert order.
  const byAirline = new Map<string, any[]>();
  relevant.forEach(t => {
    const key = normalizeAirlineName(t.airline);
    if (!byAirline.has(key)) byAirline.set(key, []);
    byAirline.get(key)!.push(t);
  });
  const airlineNames = Array.from(byAirline.keys()).sort();

  const headers = ['Airline', 'Tag Number', 'Content', 'KG', 'Route', 'Amount'];
  const aoa: unknown[][] = [
    [`EHI Multisystems Nigeria Ltd — Airline Manifest`],
    [`Hub: ${hubName} | Generated: ${generatedLabel}`],
    [],
    headers,
  ];

  let grandKg = 0;
  let grandAmount = 0;

  airlineNames.forEach(airline => {
    const group = byAirline.get(airline)!.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    });
    let airlineKg = 0;
    let airlineAmount = 0;
    group.forEach(t => {
      const kg = Number(t.totalKg ?? t.excessKg ?? t.kg ?? 0) || 0;
      const content = t.type === 'baggage' ? 'Excess Baggage' : (t.contentType || '');
      const route = t.route || t.destination || '';
      const amount = Number(t.amount || 0);
      airlineKg += kg;
      airlineAmount += amount;
      aoa.push([airline, t.awb_tag_number || t.id || '', content, kg, route, amount]);
    });
    aoa.push([`${airline} SUBTOTAL`, '', '', airlineKg, '', airlineAmount]);
    aoa.push([]);
    grandKg += airlineKg;
    grandAmount += airlineAmount;
  });

  aoa.push(['GRAND TOTAL', '', '', grandKg, '', grandAmount]);

  const ws = XLSX.utils.aoa_to_sheet(sanitizeSpreadsheetAoA(aoa));
  autoFitWorksheetColumns(ws);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Manifest');
  XLSX.writeFile(wb, `EHI_Airline_Manifest_${hubName.replace(/\s+/g,'_')}_${today}.xlsx`);
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
// Example (shiftHour = 18, current time = 23:00 Thursday):
//   start = Thursday 18:00, end = Friday 18:00
//
// Example (shiftHour = 18, current time = 03:00 Friday):
//   start = Thursday 18:00, end = Friday 18:00  ← same shift
//
// NOTE: this fixed boundary and the explicit hub_shifts table (Start/End Day
// in TransactionLedger.tsx, supabase/migrations/20260818_explicit_shifts.sql)
// are two different definitions of "today's shift" that currently coexist.
// TransactionLedger's own "current shift" filter prefers a real open
// hub_shifts row when one exists and falls back to this fixed boundary
// otherwise. Analytics.tsx, AirlinePerformance.tsx, and EODReconciliation.tsx
// still use only this fixed boundary for their own "shift" period option --
// migrating them to the explicit-shift system too is a deliberate follow-up,
// not done in this pass.
export function getShiftBoundary(shiftHour: number = 18): { start: Date; end: Date } {
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

/**
 * The business date in Africa/Lagos (UTC+1) as YYYY-MM-DD.
 * NEVER use new Date().toISOString().slice(0,10) for business dates:
 * between 00:00 and 00:59 Lagos time, UTC is still on the previous
 * day, which mis-dates EOD locks and overwrites the prior day's
 * locked record via the (hub_id, date) upsert. en-CA locale is used
 * because it formats as YYYY-MM-DD natively.
 */
export function lagosBusinessDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * The reverse direction: parses a bare "YYYY-MM-DD" string (e.g. from a
 * date-picker) as browser-LOCAL midnight (or end-of-day), not UTC midnight.
 * `new Date("2026-07-28")` is UTC midnight per the JS spec -- appending a
 * literal time (`"...T00:00:00"`) makes the same constructor use local
 * time instead, which is what a client-side date-range filter almost
 * always wants (the picker's date and the browser's clock are the same
 * timezone). CorporateBilling.tsx already uses this exact convention
 * inline; pulled out here so every other bare-date-string parse can match
 * it instead of silently reverting to `new Date(str)` and dropping the
 * first ~hour of the selected start day's local transactions.
 */
export function parseLocalDateBoundary(dateStr: string, endOfDay = false): Date {
  return new Date(dateStr + (endOfDay ? 'T23:59:59.999' : 'T00:00:00'));
}

// ── SPREADSHEET FORMULA-INJECTION SANITIZATION ────────────────
/**
 * Neutralizes spreadsheet formula injection. Excel (and most spreadsheet
 * software) treats a cell value starting with =, +, -, or @ as a formula
 * to EVALUATE, not display -- a consignee/customer/vendor name entered
 * as free text at intake (e.g. `=HYPERLINK("http://evil.com","x")`)
 * becomes a live, clickable/executable formula the moment someone opens
 * an exported report in Excel. Prefixing with a leading apostrophe forces
 * the cell to plain text instead. Only strings are touched; numbers,
 * booleans, and null/undefined pass through unchanged.
 */
export function sanitizeSpreadsheetCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

/** Applies sanitizeSpreadsheetCell to every value in an array of row
 * objects (the shape XLSX.utils.json_to_sheet expects). */
export function sanitizeSpreadsheetRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map(row => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      out[key] = sanitizeSpreadsheetCell((row as Record<string, unknown>)[key]);
    }
    return out as T;
  });
}

/** Applies sanitizeSpreadsheetCell to every cell in a 2D array (the shape
 * XLSX.utils.aoa_to_sheet expects). */
export function sanitizeSpreadsheetAoA(rows: unknown[][]): unknown[][] {
  return rows.map(row => row.map(cell => sanitizeSpreadsheetCell(cell)));
}

/** Sets each column's width to fit its widest cell (header included), so
 * exported .xlsx files open readable instead of at Excel's generic default
 * width -- plain CSV can't carry this at all, and none of the app's XLSX
 * exports set it either. Reads back from the worksheet itself rather than
 * the source rows, so it works the same whether the sheet was built via
 * aoa_to_sheet or json_to_sheet. Call after the sheet is built, before
 * book_append_sheet. */
export function autoFitWorksheetColumns(ws: XLSX.WorkSheet): void {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const totalCols = range.e.c - range.s.c + 1;

  // Title/date/summary rows above the real header only populate column A --
  // measuring width from row 0 lets that one long string skew column A's
  // width across the whole sheet. Skip ahead to the first row that's
  // substantially populated (the real header/data) before measuring.
  // Majority-populated, not `populated === totalCols` -- a sheet with more
  // than one sub-table of DIFFERING column counts (e.g. Reports.tsx's
  // sales_* exports: an 11-column "ALL AGENTS COMBINED" summary followed by
  // a 13-column "PER-AGENT DETAIL" table) has totalCols set by the widest
  // sub-table, so the narrower summary row never satisfies exact equality
  // and was skipped from width measurement entirely -- even though it
  // holds real, often-large numbers (company-wide sums), leaving that
  // column too narrow. A majority threshold still correctly skips a title
  // row (usually 1-4 populated cells) while including every real sub-table
  // regardless of its own column count.
  let startRow = range.s.r;
  const majorityThreshold = Math.ceil(totalCols / 2);
  for (let r = range.s.r; r <= range.e.r; r++) {
    let populated = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (ws[XLSX.utils.encode_cell({ r, c })]) populated++;
    }
    if (populated >= majorityThreshold) { startRow = r; break; }
  }

  const cols: { wch: number }[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    let maxLen = 8;
    for (let r = startRow; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      const text = cell.w ?? String(cell.v ?? '');
      if (text.length > maxLen) maxLen = text.length;
    }
    cols.push({ wch: Math.min(maxLen + 2, 60) });
  }
  ws['!cols'] = cols;
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