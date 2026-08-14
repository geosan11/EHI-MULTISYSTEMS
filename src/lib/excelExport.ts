// xlsx-dependent exports split out of helpers.ts so that file (imported
// nearly everywhere, including EHIApp.tsx and TransactionLedger.tsx, for
// trivial always-needed helpers like fmt/getHubCode) no longer drags xlsx
// (a large library) into the main bundle just by existing. Every consumer
// of the functions below must import this module dynamically
// (`await import('../../lib/excelExport')`), never statically -- a static
// import here defeats the whole point, since it pulls xlsx back into
// whatever chunk the importing file lands in.
import * as XLSX from 'xlsx';
// exceljs, not xlsx, for downloadDailyExcel/downloadAirlineManifestExcel
// below -- xlsx's free/community build (what every other Excel export in
// this app still uses) cannot write cell styling (font/fill) at all, that's
// a paid-tier-only feature of that library. exceljs supports it natively,
// which is the only way to give debt-collection rows real italic+faded
// formatting in the actual spreadsheet. autoFitWorksheetColumns below stays
// xlsx-typed and unchanged -- BankReconciliation/ExpensesTab/B2BSalesTab/
// Analytics/AirlinePerformance/AuditLog/Reports all still dynamically import
// xlsx directly and call it with their own xlsx worksheets.
import * as ExcelJS from 'exceljs';
import { fmt, getHubCode, formatPaymentModeDisplay, normalizeAirlineName, sanitizeSpreadsheetAoA } from './helpers.js';

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

// Same auto-fit heuristic as autoFitWorksheetColumns above, ported for
// exceljs's Worksheet API -- used only by the two functions below. Not
// exported: nothing outside this file builds exceljs worksheets.
function autoFitExcelJsColumns(ws: ExcelJS.Worksheet): void {
  let totalCols = 0;
  ws.eachRow(row => { if (row.cellCount > totalCols) totalCols = row.cellCount; });
  if (totalCols === 0) return;

  // Same "skip title/date/summary rows before measuring" heuristic as
  // autoFitWorksheetColumns above -- see its comment for why majority-
  // populated, not exact equality.
  let startRow = 1;
  const majorityThreshold = Math.ceil(totalCols / 2);
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    let populated = 0;
    for (let c = 1; c <= totalCols; c++) {
      const v = row.getCell(c).value;
      if (v !== null && v !== undefined && v !== '') populated++;
    }
    if (populated >= majorityThreshold) { startRow = r; break; }
  }

  for (let c = 1; c <= totalCols; c++) {
    let maxLen = 8;
    for (let r = startRow; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).getCell(c).value;
      const text = v == null ? '' : String(v);
      if (text.length > maxLen) maxLen = text.length;
    }
    ws.getColumn(c).width = Math.min(maxLen + 2, 60);
  }
}

// exceljs has no writeFile-for-browser convenience (that's an xlsx-specific
// wrapper over FileSaver) -- building the Blob + temporary <a> ourselves is
// the standard pattern for triggering a download from a generated buffer.
async function downloadExcelJsWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── DAILY ENTRIES EXCEL DOWNLOAD ───────────────────────────────
// `transactions` is expected to already be scoped to whatever date range /
// filters the caller applied (e.g. TransactionLedger's `filteredEntries`) --
// this function must not re-filter it, or a caller-selected date range would
// silently get discarded and replaced with "today only".
export async function downloadDailyExcel(
  streamType: 'cargo' | 'baggage' | 'marketing' | 'package' | 'mixed',
  transactions: any[],
  hubName: string
): Promise<void> {
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
  // Shared with the italic/faded row-styling pass further down, after the
  // sheet is built -- both need the exact same "is this row a debt
  // collection" test, applied to the same transactions in the same order.
  const isDebtCollectionRow = (t: any): boolean =>
    !!t.is_debt_clearance || (typeof t.id === 'string' && t.id.startsWith('DC-'));

  const debtAndWalletCols = (t: any): string[] => {
    const isDC = isDebtCollectionRow(t);
    const history = Array.isArray(t.paymentHistory) ? t.paymentHistory : [];
    const partialSummary = history
      .map((p: any) => `${fmt(p.amount || 0)} ${p.mode || ''} by ${p.by || ''} @ ${rowDateTime(p.at)}`.trim())
      .join(' | ');
    return [
      isDC ? 'YES' : 'NO',
      isDC ? (t.related_tx_id || '') : '',
      // debtPaidAt is only natively populated by package_entries -- for a
      // debt-collection row on any other stream, its own created_at IS the
      // collection timestamp (see 20260941_debt_collection_events.sql),
      // so fall back to that instead of showing this column blank.
      isDC ? rowDateTime(t.debtPaidAt || t.created_at) : (t.debtPaidAt ? rowDateTime(t.debtPaidAt) : ''),
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
    headers = ['Ref', 'Date', 'Time', 'Consignee', 'AWB/Tag', 'Airline', 'Route', 'Pieces', 'KG', 'Content', 'Amount', 'Mode', 'Bank', 'Status', 'Agent', ...debtAndWalletHeaders];
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
        t.enteredByName || '',
        ...debtAndWalletCols(t),
      ];
    });
  } else if (streamType === 'baggage') {
    headers = ['Ref', 'Date', 'Time', 'Airline', 'Passenger', 'PNR', 'Flight', 'Destination', 'PCS', 'Total KG', 'Excess KG', 'Amount', 'Mode', 'Bank', 'Agent', ...debtAndWalletHeaders];
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
      t.enteredByName || '',
      ...debtAndWalletCols(t),
    ]);
  } else if (streamType === 'marketing') {
    headers = ['Ref', 'Date', 'Time', 'Customer', 'Phone', 'Route', 'Big Bags', 'Med Bags', 'Sm Bags', 'Amount', 'Mode', 'Bank', 'Agent', ...debtAndWalletHeaders];
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
        t.enteredByName || '',
        ...debtAndWalletCols(t),
      ];
    });
  } else if (streamType === 'package') {
    headers = ['Ref', 'Date', 'Time', 'Name', 'Destination', 'Content Type', 'Pieces', 'KG', 'Contents', 'Amount', 'Mode', 'Bank', 'Status', 'Agent', ...debtAndWalletHeaders];
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
        t.enteredByName || '',
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
    headers = ['Ref', 'Date', 'Time', 'Type', 'Name', 'Airline', 'Route', 'Content', 'Pieces', 'KG', 'Amount', 'Mode', 'Bank', 'Status', 'Agent', ...debtAndWalletHeaders];
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
        t.enteredByName || '',
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

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(streamLabel.slice(0, 31));
  sanitizeSpreadsheetAoA(aoa).forEach(r => ws.addRow(r));
  autoFitExcelJsColumns(ws);

  // Debt-collection rows read as "money collected", not "new sale" --
  // italic + a muted grey font is the closest Excel equivalent of the
  // on-screen Ledger's blue-tinted opacity fade for the same rows
  // (TransactionLedger.tsx) -- cell text has no real opacity/transparency
  // to fade with, so grey stands in for it. transactions/rows/isDcFlags
  // are all built from the same array in the same order, so index i lines
  // up across all three; +6 for the 4 title/date/summary/blank rows above
  // headers (rows 1-4), the header row itself (row 5), then exceljs rows
  // are 1-indexed -- so row 6 is the first data row.
  const isDcFlags = transactions.map(isDebtCollectionRow);
  isDcFlags.forEach((isDc, i) => {
    if (!isDc) return;
    ws.getRow(6 + i).eachCell({ includeEmpty: true }, cell => {
      cell.font = { italic: true, color: { argb: 'FF888888' } };
    });
  });

  await downloadExcelJsWorkbook(wb, `EHI_${streamType}_${hubName.replace(/\s+/g,'_')}_${today}.xlsx`);
}

// ── PER-AIRLINE MANIFEST EXCEL DOWNLOAD ───────────────────────
// A separate, narrower export from downloadDailyExcel above -- meant to be
// handed to (or checked against) an airline's own manifest for a
// route/flight: just tag number, content, kg, route, and amount collected,
// grouped by airline and listed in chronological order within each group.
export async function downloadAirlineManifestExcel(
  transactions: any[],
  hubName: string
): Promise<void> {
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

  const headers = ['Airline', 'Tag Number', 'Content', 'KG', 'Route', 'Amount', 'Agent'];
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
      aoa.push([airline, t.awb_tag_number || t.id || '', content, kg, route, amount, t.enteredByName || '']);
    });
    aoa.push([`${airline} SUBTOTAL`, '', '', airlineKg, '', airlineAmount, '']);
    aoa.push([]);
    grandKg += airlineKg;
    grandAmount += airlineAmount;
  });

  aoa.push(['GRAND TOTAL', '', '', grandKg, '', grandAmount, '']);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Manifest');
  sanitizeSpreadsheetAoA(aoa).forEach(r => ws.addRow(r));
  autoFitExcelJsColumns(ws);
  await downloadExcelJsWorkbook(wb, `EHI_Airline_Manifest_${hubName.replace(/\s+/g,'_')}_${today}.xlsx`);
}
