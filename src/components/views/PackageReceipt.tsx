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
import { estimateWrappedLines } from "../../lib/helpers";
import { notifySilentError } from "../../lib/ToastContext";

export interface PackageReceiptData {
  entryRef: string;
  date: string;
  agentName: string;
  customerName: string;
  phone?: string;
  destination: string;
  contentType: string;
  pieces?: number;
  kg?: number;
  contents?: string;
  amount: number;
  paymentMode: string;
  paymentNarration?: string;
  bankName?: string;
  qrCodeDataUrl?: string;
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
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 0,
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
  copyLabelText: {
    fontSize: 8,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  // Moderate size -- big enough to scan reliably, small enough not to
  // dominate a small-format (226pt) receipt the way CargoReceipt.tsx's
  // 64x64 would here.
  qrContainer: { alignItems: "center", marginVertical: 4 },
  qrImage: { width: 56, height: 56 },
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
  refValue: {
    fontSize: 8,
    fontWeight: "bold",
    fontFamily: "Courier-Bold",
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
  footerText: {
    fontSize: 7,
    color: "#888888",
    textAlign: "center",
    marginTop: 1,
  },
});

// page width (226) minus left+right padding (12+12) minus the fixed label
// column (60), with a 6pt safety cushion -- matches CargoReceipt.tsx/
// MarketingReceipt.tsx's identical 226pt-wide row layout, so the same
// column width applies here.
const VALUE_COL_WIDTH = 136;

const PackageReceiptPDF = ({ data }: { data: PackageReceiptData }) => {
  let h = 360;
  // The "*** CUSTOMER/MERCHANT COPY ***" line renders unconditionally on
  // every copy -- same unaccounted-for-line risk CargoReceipt.tsx's own
  // comment warns about if this isn't budgeted for.
  h += 14;
  if (data.qrCodeDataUrl) h += 60;
  if (data.phone) h += 14;
  if (data.bankName) h += 14;
  if (data.paymentMode === "Transfer" && data.paymentNarration) h += 14;
  if (data.pieces) h += 14;
  if (data.kg) h += 14;
  if (data.contents) h += 14;

  for (const field of [data.customerName, data.destination, data.contents, data.agentName, data.paymentNarration, data.bankName]) {
    if (!field) continue;
    const lines = estimateWrappedLines(field, VALUE_COL_WIDTH, 8);
    if (lines > 1) h += (lines - 1) * 14;
  }

  // Two copies (CUSTOMER, MERCHANT) as separate pages in the same PDF --
  // mirrors CargoReceipt.tsx, which already does this; package never had it.
  const renderPage = (copyLabel: 'CUSTOMER COPY' | 'MERCHANT COPY') => (
      <Page key={copyLabel} size={[226, h]} style={styles.page}>
        <View style={[styles.headerRow, styles.headerBorder]}>
          <EHILogoPDF width={70} />
        </View>

        <View style={styles.titleBar}>
          <Text style={styles.titleText}>PACKAGE / PARCEL RECEIPT</Text>
        </View>
        <Text style={styles.copyLabelText}>*** {copyLabel} ***</Text>

        {data.qrCodeDataUrl ? (
          <View style={styles.qrContainer}>
            <Image src={data.qrCodeDataUrl} style={styles.qrImage} />
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>TRANSACTION INFO</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Ref</Text>
          <Text style={styles.refValue}>{data.entryRef}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Date</Text>
          <Text style={styles.value}>{data.date}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Agent</Text>
          <Text style={styles.value}>{data.agentName}</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>CUSTOMER DETAILS</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Customer</Text>
          <Text style={styles.value}>{data.customerName}</Text>
        </View>
        {data.phone ? (
          <View style={styles.row}>
            <Text style={styles.label}>Phone</Text>
            <Text style={styles.value}>{data.phone}</Text>
          </View>
        ) : null}
        <View style={styles.row}>
          <Text style={styles.label}>Destination</Text>
          <Text style={styles.value}>{data.destination}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Type</Text>
          <Text style={styles.value}>{data.contentType}</Text>
        </View>
        {data.pieces ? (
          <View style={styles.row}>
            <Text style={styles.label}>Pieces</Text>
            <Text style={styles.value}>{data.pieces}</Text>
          </View>
        ) : null}
        {data.kg ? (
          <View style={styles.row}>
            <Text style={styles.label}>Weight</Text>
            <Text style={styles.value}>{data.kg} KG</Text>
          </View>
        ) : null}
        {data.contents ? (
          <View style={styles.row}>
            <Text style={styles.label}>Contents</Text>
            <Text style={styles.value}>{data.contents}</Text>
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

export const downloadPackageReceipt = async (data: PackageReceiptData) => {
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
  const blob = await pdf(<PackageReceiptPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Receipt_${data.entryRef}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};

export interface PackageDailySummaryData {
  date: string;
  agentName: string;
  hubName: string;
  entries: Array<{
    customerName: string;
    destination: string;
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
    marginBottom: 20,
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
    padding: 5,
  },
  tableColLarge: {
    width: "22%",
    borderStyle: "solid",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
    padding: 5,
  },
  tableCol: {
    width: "15%",
    borderStyle: "solid",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderColor: "#e5e7eb",
    padding: 5,
  },
  tableCellHeader: { fontSize: 8, fontWeight: "bold" },
  tableCell: { fontSize: 8 },
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
    backgroundColor: "#DBEAFE",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#3B82F6",
  },
  balanceText: { fontSize: 14, fontWeight: "bold", color: "#1E3A8A" },
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

const PackageDailySummaryPDF = ({ data }: { data: PackageDailySummaryData }) => (
  <Document>
    <Page size="A4" style={summaryStyles.page}>
      <View style={summaryStyles.header}>
        <View style={{ alignItems: "center", marginBottom: 15 }}>
          <EHILogoPDF width={120} />
        </View>
        <Text style={summaryStyles.title}>PACKAGE & PARCEL DESK — DAILY SUMMARY</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10 }}>
          <Text style={{ fontSize: 10 }}>Date: {data.date}</Text>
          <Text style={{ fontSize: 10 }}>Agent: {data.agentName}</Text>
        </View>
        <Text style={{ fontSize: 10, marginTop: 5 }}>Hub: {data.hubName}</Text>
      </View>

      <Text style={summaryStyles.tableTitle}>ENTRIES</Text>
      <View style={summaryStyles.table}>
        <View style={summaryStyles.tableRow}>
          <View style={summaryStyles.tableColSmall}><Text style={summaryStyles.tableCellHeader}>#</Text></View>
          <View style={summaryStyles.tableColLarge}><Text style={summaryStyles.tableCellHeader}>Customer</Text></View>
          <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCellHeader}>Destination</Text></View>
          <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCellHeader}>Type</Text></View>
          <View style={summaryStyles.tableColSmall}><Text style={summaryStyles.tableCellHeader}>Pcs</Text></View>
          <View style={summaryStyles.tableColSmall}><Text style={summaryStyles.tableCellHeader}>KG</Text></View>
          <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCellHeader}>Amount (NGN)</Text></View>
          <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCellHeader}>Mode</Text></View>
        </View>
        {data.entries.map((entry, i) => (
          <View style={summaryStyles.tableRow} key={i}>
            <View style={summaryStyles.tableColSmall}><Text style={summaryStyles.tableCell}>{i + 1}</Text></View>
            <View style={summaryStyles.tableColLarge}><Text style={summaryStyles.tableCell}>{entry.customerName}</Text></View>
            <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCell}>{entry.destination}</Text></View>
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
        <Text style={{ fontSize: 8, color: "#1E3A8A", marginTop: 2 }}>(Cash in Hand minus Total Expenses)</Text>
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

export const downloadPackageDailySummary = async (data: PackageDailySummaryData) => {
  const blob = await pdf(<PackageDailySummaryPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `PackageDailySummary_${data.date.replace(/[/ ]/g, "_")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
