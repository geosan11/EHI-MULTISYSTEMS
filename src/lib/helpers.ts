import { PRICING, CARGO_ROUTES } from './constants.js';
import { Transaction, PaymentMode } from './types.js';

export const fmt = (amount: number) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount).replace('NGN', '₦');
};

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
export function openPdfOrDownload(url: string, filename: string): Window | null {
  let win: Window | null = null;
  try {
    win = window.open(url, '_blank');
  } catch {
    win = null;
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

export const generatePaymentNarration = (hubName: string, serial: string | number): string => {
  let code = getHubCode(hubName);
  const d = new Date();
  const yymmdd = [
    d.getFullYear().toString().slice(2),
    (d.getMonth() + 1).toString().padStart(2, '0'),
    d.getDate().toString().padStart(2, '0')
  ].join('');
  const ser = serial.toString().padStart(3, '0');
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
export function downloadDailyCSV(
  streamType: 'cargo' | 'baggage' | 'marketing',
  transactions: any[],
  hubName: string
): void {
  const today = new Date().toISOString().slice(0, 10);
  const todayLabel = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const todayTx = transactions.filter(t => {
    if (!t.created_at) return true;
    return t.created_at.slice(0, 10) === today;
  });

  let headers: string[];
  let rows: string[][];

  if (streamType === 'cargo') {
    headers = ['Ref', 'Time', 'Consignee', 'AWB/Tag', 'Airline', 'Route', 'Pieces', 'KG', 'Content', 'Amount', 'Mode', 'Bank', 'Status'];
    rows = todayTx.map(t => {
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
    headers = ['Ref', 'Time', 'Passenger', 'PNR', 'Flight', 'Destination', 'PCS', 'Total KG', 'Excess KG', 'Amount', 'Mode', 'Bank'];
    rows = todayTx.map(t => [
      t.id,
      t.time || '',
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
  } else {
    headers = ['Ref', 'Time', 'Customer', 'Phone', 'Route', 'Big Bags', 'Med Bags', 'Sm Bags', 'Amount', 'Mode', 'Bank'];
    rows = todayTx.map(t => {
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
  }

  // Escape CSV values
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;

  const titleRow = `EHI Multisystems Nigeria Ltd — ${streamType === 'cargo' ? 'Cargo' : streamType === 'baggage' ? 'ValueJet' : 'Marketing'} Entries`;
  const dateRow = `Hub: ${hubName} | Date: ${todayLabel}`;
  const totalAmount = todayTx.reduce((s, t) => s + (t.amount || 0), 0);
  const summaryRow = `Total Entries: ${todayTx.length} | Total Revenue: NGN ${totalAmount.toLocaleString('en-NG')}`;

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