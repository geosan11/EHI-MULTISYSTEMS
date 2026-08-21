import {
  INIT,
  CENTER,
  LEFT,
  BOLD_ON,
  BOLD_OFF,
  FONT_B_ON,
  FONT_A_ON,
  FEED_AND_CUT,
  concatChunks,
} from './escposShared';
import { fmt, getHubCode } from './helpers';

export interface LedgerPrintEntry {
  id: string;
  name: string;
  detail: string;
  amount: number;
  mode: string;
  status: string;
  source: 'transaction' | 'expense';
  time: string;
  type: string;
  raw: any;
}

export interface LedgerPrintMetadata {
  hubName: string;
  hubCode: string;
  shiftDate: string;
  agentName: string;
  printedAt: string;
  totalAmount: number;
  cashAmount: number;
  transferAmount: number;
  posAmount: number;
  debtAmount: number;
  walletAmount: number;
}

/**
 * Compiles a compact 80mm ESC/POS thermal receipt stream for the transaction ledger.
 * Format per row:
 *   ID
 *   <DEST_CODE>  <KG>KG  <PC>PC  ₦<AMOUNT>
 */
export async function compileLedger80mmStream(
  entries: LedgerPrintEntry[],
  meta: LedgerPrintMetadata
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  // Initialize printer
  chunks.push(new Uint8Array(INIT));
  chunks.push(new Uint8Array(CENTER));

  // Header Title
  chunks.push(new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode("EHI MULTISYSTEMS LOGISTICS\n"));
  chunks.push(encoder.encode("80MM LEDGER SUMMARY\n"));
  chunks.push(new Uint8Array(BOLD_OFF));

  const lineChar = "-".repeat(48) + "\n";
  const doubleLine = "=".repeat(48) + "\n";

  // Shift & Station Info
  chunks.push(new Uint8Array(LEFT));
  chunks.push(encoder.encode(`Hub: ${meta.hubCode || 'ORIGIN'} (${meta.hubName})\n`));
  chunks.push(encoder.encode(`Agent: ${meta.agentName || 'Staff'}\n`));
  chunks.push(encoder.encode(`Printed: ${meta.printedAt} | Entries: ${entries.length}\n`));
  chunks.push(encoder.encode(lineChar));

  // Financial KPI Summary Block
  chunks.push(new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode(`TOTAL REVENUE: N${fmt(meta.totalAmount)}\n`));
  chunks.push(new Uint8Array(BOLD_OFF));
  chunks.push(encoder.encode(`CASH: N${fmt(meta.cashAmount)} | TRSF: N${fmt(meta.transferAmount)} | POS: N${fmt(meta.posAmount)}\n`));
  chunks.push(encoder.encode(`DEBT: N${fmt(meta.debtAmount)} | WALLET: N${fmt(meta.walletAmount)}\n`));
  chunks.push(encoder.encode(lineChar));

  // Column Header
  chunks.push(new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode("ID / DEST               KG     PC       AMOUNT\n"));
  chunks.push(new Uint8Array(BOLD_OFF));
  chunks.push(encoder.encode(lineChar));

  let totalKg = 0;
  let totalPcs = 0;

  // Render Entries
  entries.forEach((e, idx) => {
    if (e.type === 'shift-marker') return;

    const raw = e.raw || {};
    // Cargo/Marketing entries carry their destination in `route` (e.g.
    // "LOS/Lagos"), not `destination` -- only Baggage(manifests)/Package
    // use `destination`. Without checking route too, those two types
    // always fell through to the literal string 'DEST', which getHubCode's
    // fallback then truncates to 3 chars -- producing "DES" on the printed
    // receipt instead of a real destination code.
    const destCode = getHubCode(raw.destination || raw.route || raw.hub || 'DEST');
    const kgVal = Math.round(parseFloat(raw.totalKg || raw.kg || raw.excessKg || 0) || 0);
    const pcsVal = parseInt(raw.pieces || raw.pcs || 1) || 1;

    totalKg += kgVal;
    totalPcs += pcsVal;

    const numStr = (idx + 1).toString().padStart(2, '0');
    const idLine = `${numStr} ${e.id}\n`;
    chunks.push(new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode(idLine));
    chunks.push(new Uint8Array(BOLD_OFF));

    // Customer/consignee/passenger name (+ this entry's own date, since a
    // debt printed today can easily be from weeks ago), in the printer's
    // condensed Font B -- deliberately smaller than the ID/spec lines so
    // it doesn't eat into the limited 80mm width, while still being
    // legible for a quick "whose shipment, and from when" glance without
    // opening the app.
    if (e.name) {
      // Intl-backed toLocaleDateString() THROWS a RangeError (not just
      // "Invalid Date" text) on a malformed created_at -- same reasoning
      // as ledgerSearch.ts's safeTimeString -- which would otherwise crash
      // this whole print for every entry over one bad row's date.
      const parsedDate = raw.created_at ? new Date(raw.created_at) : null;
      const dateStr = parsedDate && !isNaN(parsedDate.getTime())
        ? parsedDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })
        : '';
      chunks.push(new Uint8Array(FONT_B_ON));
      chunks.push(encoder.encode(`   ${e.name.slice(0, 30)}${dateStr ? ` · ${dateStr}` : ''}\n`));
      chunks.push(new Uint8Array(FONT_A_ON));
    }

    const destPart = `   ${destCode.padEnd(5)}`;
    const kgPart = `${kgVal}KG`.padStart(8);
    const pcPart = `${pcsVal}PC`.padStart(5);
    const amtPart = `N${fmt(e.amount)}`.padStart(14);

    const specLine = `${destPart}${kgPart}${pcPart} ${amtPart}\n`;
    chunks.push(encoder.encode(specLine));
    chunks.push(encoder.encode("\n"));
  });

  // Footer Totals
  chunks.push(encoder.encode(lineChar));
  chunks.push(new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode(`TOTAL WEIGHT: ${Math.round(totalKg)} KG\n`));
  chunks.push(encoder.encode(`TOTAL PIECES: ${totalPcs} PCS\n`));
  chunks.push(encoder.encode(`TOTAL REVENUE: N${fmt(meta.totalAmount)}\n`));
  chunks.push(new Uint8Array(BOLD_OFF));
  chunks.push(encoder.encode(doubleLine));
  chunks.push(encoder.encode("\n"));

  chunks.push(new Uint8Array(FEED_AND_CUT));

  return concatChunks(chunks);
}
