import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
  Image,
} from "@react-pdf/renderer";
import QRCode from "qrcode";
import { EHILogoPDF } from "../EHILogoPDF";
import { AirlineLogoPDF } from "../AirlineLogoPDF";
import { estimateWrappedLines } from "../../lib/helpers";
import { printPdfSmart } from "../../lib/qzPrint";
import { resolveAirlineLogoUrl } from "../../lib/airlineLogos";
import { notifySilentError } from "../../lib/ToastContext";

export interface CargoReceiptData {
  entryRef: string;
  serialNumber: number;
  date: string;
  hubName: string;
  agentName: string;
  airline: string;
  consignee: string;
  awbTagNumber: string;
  pieces: number;
  kg: number;
  route: string;
  contentType: string;
  amount: number;
  paymentMode: string;
  bankName?: string;
  paymentNarration?: string;
  remark?: string;
  qrCodeDataUrl?: string;
  airlineLogoUrl?: string | null;
  pickupPin?: string;
}

function formatNaira(n: number | string): string {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  return 'NGN ' + (num || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const styles = StyleSheet.create({
  page: { padding: 12, fontFamily: "Helvetica", backgroundColor: "#FFFFFF" },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  headerBorder: {
    borderBottomWidth: 2,
    borderBottomColor: "#000000",
    marginBottom: 0,
  },
  titleBar: {
    backgroundColor: "#000000",
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 3,
  },
  titleText: {
    fontSize: 9,
    color: "#FFFFFF",
    textAlign: "center",
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  originLine: {
    fontSize: 8,
    color: "#555555",
    textAlign: "center",
    marginBottom: 4,
  },
  copyLabelText: {
    fontSize: 8,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  divider: {
    marginVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#000000",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  label: {
    fontSize: 7,
    color: "#777777",
    textTransform: "uppercase",
    width: 60,
    fontFamily: "Helvetica",
  },
  value: {
    fontSize: 8,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    flex: 1,
    textAlign: "right",
  },
  sectionHeader: {
    backgroundColor: "#F5F5F5",
    padding: 3,
    marginTop: 6,
    marginBottom: 3,
  },
  sectionHeaderText: {
    fontSize: 7,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    color: "#333333",
  },
  amountBox: {
    backgroundColor: "#000000",
    padding: 6,
    marginTop: 4,
  },
  amountBoxLabel: {
    fontSize: 7,
    color: "#FFFFFF",
    textTransform: "uppercase",
    fontFamily: "Helvetica",
  },
  amountBoxValue: {
    fontSize: 16,
    fontWeight: "bold",
    fontFamily: "Courier-Bold",
    color: "#FFFFFF",
    marginVertical: 2,
  },
  amountBoxSub: {
    fontSize: 8,
    color: "#FFFFFF",
    fontFamily: "Helvetica",
  },
  qrContainer: { alignItems: "center", marginVertical: 4 },
  qrImage: { width: 64, height: 64 },
  pinContainer: {
    borderWidth: 2,
    borderColor: "#000000",
    alignItems: "center",
    padding: 6,
    marginVertical: 4,
  },
  pinLabel: {
    fontSize: 7,
    color: "#777777",
    textTransform: "uppercase",
    fontFamily: "Helvetica",
  },
  pinValue: {
    fontSize: 18,
    fontFamily: "Courier-Bold",
    fontWeight: "bold",
    color: "#000000",
    letterSpacing: 3,
    marginVertical: 3,
  },
  pinHelper: { fontSize: 7, color: "#555555", textAlign: "center" },
  footerText: {
    fontSize: 7,
    color: "#888888",
    textAlign: "center",
    marginTop: 1,
  },
});

// page width (226) minus left+right padding (12+12) minus the fixed label
// column (60), with a 6pt safety cushion -- what's actually left for a
// row's wrappable value text. Kept slightly narrower than the true 142pt
// so a value near the wrap boundary rounds up to an extra line instead of
// running out of room (matching this file's own generous-estimate philosophy).
const VALUE_COL_WIDTH = 136;

const CargoReceiptOnlyPDF = ({ data }: { data: CargoReceiptData }) => {
  // Base measured empirically by rendering the shortest-plausible receipt
  // (short consignee, no pin/bank/narration/remark) to a real PDF and
  // checking its actual page count -- the previous base (355) was short
  // by ~30-50pt even in that minimal case, before any optional section or
  // wrapped text, so every receipt with a QR code (i.e. every real one)
  // was already silently spilling a mostly-blank second page.
  let h = 445;
  // The "*** CUSTOMER/MERCHANT COPY ***" line renders unconditionally on
  // every copy but was added after the base above was measured -- without
  // this it's the exact unaccounted-for line the comment above warns
  // about, silently pushing content onto a second, mostly-blank page.
  h += 14;
  if (data.qrCodeDataUrl) h += 70;
  if (data.pickupPin) h += 70;
  if (data.bankName) h += 20;
  if (data.paymentMode === "Transfer" && data.paymentNarration) h += 25;
  if (data.remark) h += 35;

  // Consignee/route/content/airline are free text (or a long single-hub
  // route name) with no length cap in the cargo form -- a fixed estimate
  // that only accounted for optional sections, not text wrapping within a
  // row, let a long enough value silently push content onto an unwanted,
  // near-empty second page instead of fitting on the one page a receipt
  // roll actually needs.
  for (const field of [data.consignee, data.route, data.contentType, data.airline]) {
    const lines = estimateWrappedLines(field, VALUE_COL_WIDTH, 8);
    if (lines > 1) h += (lines - 1) * 12;
  }

  // Two copies (CUSTOMER, MERCHANT) as separate pages in the same PDF --
  // mirrors escposCargoReceiptPrinting.ts's thermal-printer output, which
  // already prints both. The PDF path never had this: the "PDF Receipt"
  // button produced a single page with no copy distinction at all.
  const renderPage = (copyLabel: 'CUSTOMER COPY' | 'MERCHANT COPY') => (
    <Page key={copyLabel} size={[226, h]} style={styles.page}>
      <View style={[styles.headerRow, styles.headerBorder]}>
        <EHILogoPDF width={70} />
        <AirlineLogoPDF airline={data.airline} logoUrl={data.airlineLogoUrl} width={70} />
      </View>

      <View style={styles.titleBar}>
        <Text style={styles.titleText}>CARGO ENTRY RECEIPT</Text>
      </View>

      <Text style={styles.originLine}>Origin: {data.hubName}</Text>
      <Text style={styles.copyLabelText}>*** {copyLabel} ***</Text>

      {data.qrCodeDataUrl ? (
        <View style={styles.qrContainer}>
          <Image src={data.qrCodeDataUrl} style={styles.qrImage} />
        </View>
      ) : null}

      {data.pickupPin ? (
        <View style={styles.pinContainer}>
          <Text style={styles.pinLabel}>PICKUP PIN</Text>
          <Text style={styles.pinValue}>{data.pickupPin}</Text>
          <Text style={styles.pinHelper}>Share this PIN with the consignee.</Text>
          <Text style={styles.pinHelper}>They must present it to collect cargo.</Text>
        </View>
      ) : null}

      <View style={styles.divider} />

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>SHIPMENT DETAILS</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Entry Ref</Text>
        <Text style={styles.value}>{data.entryRef}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>S/N</Text>
        <Text style={styles.value}>Entry #{data.serialNumber}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Date</Text>
        <Text style={styles.value}>{data.date}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Agent</Text>
        <Text style={styles.value}>{data.agentName || 'System'}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Airline</Text>
        <Text style={styles.value}>{data.airline}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>AWB/Tag</Text>
        <Text style={styles.value}>{data.awbTagNumber}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Consignee</Text>
        <Text style={styles.value}>{data.consignee}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Route</Text>
        <Text style={styles.value}>{data.route}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Content</Text>
        <Text style={styles.value}>{data.contentType}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Pieces</Text>
        <Text style={styles.value}>{data.pieces}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Weight</Text>
        <Text style={styles.value}>{Math.round(data.kg)} KG</Text>
      </View>

      {data.remark ? (
        <View style={styles.row}>
          <Text style={styles.label}>Remark</Text>
          <Text style={styles.value}>{data.remark}</Text>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>PAYMENT</Text>
      </View>

      <View style={styles.amountBox}>
        <Text style={styles.amountBoxLabel}>TOTAL AMOUNT</Text>
        <Text style={styles.amountBoxValue}>{formatNaira(data.amount)}</Text>
        <Text style={styles.amountBoxSub}>
          {data.paymentMode}{data.bankName ? ` • ${data.bankName}` : ''}
        </Text>
        {data.paymentMode === "Transfer" && data.paymentNarration ? (
          <Text style={[styles.amountBoxSub, { marginTop: 2 }]}>
            Narration: {data.paymentNarration}
          </Text>
        ) : null}
      </View>

      <View style={[styles.divider, { marginTop: 6 }]} />

      <Text style={styles.footerText}>app.ehimultisystems.com</Text>
      <Text style={styles.footerText}>{data.entryRef} • {data.date}</Text>
    </Page>
  );

  return (
    <Document>
      {renderPage('CUSTOMER COPY')}
      {renderPage('MERCHANT COPY')}
    </Document>
  );
};

export const printCargoReceipt = async (data: CargoReceiptData) => {
  if (!data.qrCodeDataUrl) {
    try {
      data.qrCodeDataUrl = await QRCode.toDataURL(data.entryRef, {
        margin: 1,
        width: 200,
        errorCorrectionLevel: 'L',
      });
    } catch (e) {
      console.warn("Failed to generate QR code", e);
      notifySilentError('This receipt printed without a scannable tracking QR code.');
    }
  }
  if (data.airlineLogoUrl === undefined) {
    data.airlineLogoUrl = await resolveAirlineLogoUrl(data.airline);
  }
  const blob = await pdf(<CargoReceiptOnlyPDF data={data} />).toBlob();
  await printPdfSmart(blob, `Receipt_${data.entryRef}.pdf`, 'receipt');
};

export interface CargoDailySummaryData {
  periodStart: string;
  periodEnd: string;
  agentName: string;
  hubName: string;
  entries: Array<{
    consignee: string;
    airline: string;
    awb: string;
    route: string;
    contentType: string;
    pieces?: number;
    kg?: number;
    amount: number;
    paymentMode: string;
    bank?: string;
  }>;
  totalSales: number;
  cashSales: number;
  posSales: number;
  transferSales: number;
  debtSales: number;
  expenses: Array<{ type: string; amount: number; description: string }>;
  totalExpenses: number;
  balanceCash: number;
}

const summaryStyles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica" },
  header: { marginBottom: 20 },
  title: {
    fontSize: 12,
    color: "#6b7280",
    textTransform: "uppercase",
    marginBottom: 10,
  },
  periodLine: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#92400E",
    marginBottom: 10,
  },
  tableTitle: {
    fontSize: 10,
    fontWeight: "bold",
    marginTop: 15,
    marginBottom: 5,
  },
  table: {
    display: "flex",
    width: "auto",
    borderStyle: "solid",
    borderWidth: 1,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderColor: "#e5e7eb",
  },
  tableRow: { flexDirection: "row" },
  tableColSmall: {
    width: "6%",
    borderStyle: "solid",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
    padding: 4,
  },
  tableColLarge: {
    width: "17%",
    borderStyle: "solid",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
    padding: 4,
  },
  tableCol: {
    width: "12%",
    borderStyle: "solid",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderColor: "#e5e7eb",
    padding: 4,
  },
  tableCellHeader: { fontSize: 7, fontWeight: "bold" },
  tableCell: { fontSize: 7 },
  summaryBox: {
    marginTop: 20,
    padding: 15,
    backgroundColor: "#f9fafb",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  balanceBox: {
    marginTop: 15,
    padding: 15,
    backgroundColor: "#FEF3C7",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#F59E0B",
  },
  balanceText: { fontSize: 14, fontWeight: "bold", color: "#92400E" },
  signatures: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 50,
  },
  signatureLine: {
    borderTopWidth: 1,
    borderTopColor: "#000",
    paddingTop: 5,
    width: 200,
    fontSize: 10,
  },
});

const CargoDailySummaryPDF = ({ data }: { data: CargoDailySummaryData }) => (
  <Document>
    <Page size="A4" orientation="landscape" style={summaryStyles.page}>
      <View style={summaryStyles.header}>
        <View style={{ alignItems: "center", marginBottom: 15 }}>
          <EHILogoPDF width={120} />
        </View>
        <Text style={summaryStyles.title}>CARGO DESK — PERIOD SUMMARY</Text>
        <Text style={summaryStyles.periodLine}>
          Period: {data.periodStart} → {data.periodEnd}
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 5 }}>
          <Text style={{ fontSize: 10 }}>Agent: {data.agentName}</Text>
          <Text style={{ fontSize: 10 }}>Hub: {data.hubName}</Text>
        </View>
      </View>

      <Text style={summaryStyles.tableTitle}>ENTRIES ({data.entries.length})</Text>
      <View style={summaryStyles.table}>
        <View style={summaryStyles.tableRow}>
          <View style={summaryStyles.tableColSmall}><Text style={summaryStyles.tableCellHeader}>#</Text></View>
          <View style={summaryStyles.tableColLarge}><Text style={summaryStyles.tableCellHeader}>Consignee</Text></View>
          <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCellHeader}>Airline</Text></View>
          <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCellHeader}>AWB</Text></View>
          <View style={summaryStyles.tableColLarge}><Text style={summaryStyles.tableCellHeader}>Route</Text></View>
          <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCellHeader}>Content</Text></View>
          <View style={summaryStyles.tableColSmall}><Text style={summaryStyles.tableCellHeader}>Pcs</Text></View>
          <View style={summaryStyles.tableColSmall}><Text style={summaryStyles.tableCellHeader}>KG</Text></View>
          <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCellHeader}>Amount (NGN)</Text></View>
          <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCellHeader}>Mode</Text></View>
        </View>
        {data.entries.map((entry, i) => (
          <View style={summaryStyles.tableRow} key={i}>
            <View style={summaryStyles.tableColSmall}><Text style={summaryStyles.tableCell}>{i + 1}</Text></View>
            <View style={summaryStyles.tableColLarge}><Text style={summaryStyles.tableCell}>{entry.consignee}</Text></View>
            <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCell}>{entry.airline}</Text></View>
            <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCell}>{entry.awb}</Text></View>
            <View style={summaryStyles.tableColLarge}><Text style={summaryStyles.tableCell}>{entry.route}</Text></View>
            <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCell}>{entry.contentType}</Text></View>
            <View style={summaryStyles.tableColSmall}><Text style={summaryStyles.tableCell}>{entry.pieces || '-'}</Text></View>
            <View style={summaryStyles.tableColSmall}><Text style={summaryStyles.tableCell}>{entry.kg || '-'}</Text></View>
            <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCell}>{entry.amount.toLocaleString("en-NG", { maximumFractionDigits: 2 })}</Text></View>
            <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCell}>{entry.paymentMode}</Text></View>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <View style={{ width: "48%" }}>
          <View style={summaryStyles.summaryBox}>
            <Text style={{ fontSize: 10, fontWeight: "bold", marginBottom: 5 }}>REVENUE</Text>
            <Text style={{ fontSize: 9, marginBottom: 3 }}>Total Sales: NGN {data.totalSales.toLocaleString("en-NG")}</Text>
            <Text style={{ fontSize: 9, marginBottom: 3 }}>Cash: NGN {data.cashSales.toLocaleString("en-NG")}</Text>
            <Text style={{ fontSize: 9, marginBottom: 3 }}>POS: NGN {data.posSales.toLocaleString("en-NG")}</Text>
            <Text style={{ fontSize: 9, marginBottom: 3 }}>Transfer: NGN {data.transferSales.toLocaleString("en-NG")}</Text>
            {data.debtSales > 0 && <Text style={{ fontSize: 9, color: "#9A3412" }}>Unpaid Credit Sales (Owed): NGN {data.debtSales.toLocaleString("en-NG")}</Text>}
          </View>
        </View>

        <View style={{ width: "48%" }}>
          <View style={summaryStyles.summaryBox}>
            <Text style={{ fontSize: 10, fontWeight: "bold", marginBottom: 5 }}>EXPENSES ({data.expenses.length})</Text>
            {data.expenses.map((exp, i) => (
              <Text key={i} style={{ fontSize: 9, marginBottom: 3 }}>
                {exp.type} - {exp.description}: NGN {exp.amount.toLocaleString("en-NG")}
              </Text>
            ))}
            <Text style={{ fontSize: 9, fontWeight: "bold", marginTop: 3 }}>
              Total Expenses: NGN {data.totalExpenses.toLocaleString("en-NG")}
            </Text>
          </View>
        </View>
      </View>

      <View style={summaryStyles.balanceBox}>
        <Text style={summaryStyles.balanceText}>BALANCE CASH: NGN {data.balanceCash.toLocaleString("en-NG")}</Text>
        <Text style={{ fontSize: 8, color: "#92400E", marginTop: 2 }}>(Cash in Hand minus Total Expenses)</Text>
      </View>

      <View style={summaryStyles.signatures}>
        <Text style={summaryStyles.signatureLine}>Agent Signature: __________________</Text>
        <Text style={summaryStyles.signatureLine}>Supervisor Signature: _______________</Text>
      </View>

      <Text style={{ fontSize: 8, color: "#9ca3af", textAlign: "center", marginTop: 30 }}>
        Generated by EHI Logistics Platform
      </Text>
    </Page>
  </Document>
);

export const downloadCargoDailySummary = async (data: CargoDailySummaryData) => {
  const blob = await pdf(<CargoDailySummaryPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `CargoPeriodSummary_${data.periodEnd.replace(/[/ :]/g, "_")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
