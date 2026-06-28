import { PRICING } from './constants';
import { Transaction, PaymentMode } from './types';

export const fmt = (amount: number) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount).replace('NGN', '₦');
};

export const generatePaymentNarration = (hubCode: string, serial: string | number): string => {
  let code = (hubCode || 'XXX').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 3);
  if (code.length < 2) code = code.padEnd(3, 'X');
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
    headers = ['Ref', 'Time', 'Passenger', 'PNR', 'Flight', 'Destination', 'Total KG', 'Excess KG', 'Amount', 'Mode', 'Bank'];
    rows = todayTx.map(t => [
      t.id,
      t.time || '',
      t.name || '',
      t.pnr || '',
      t.flight || '',
      t.destination || '',
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
