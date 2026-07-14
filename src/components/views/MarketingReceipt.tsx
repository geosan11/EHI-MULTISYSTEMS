import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import { EHILogoPDF } from "../EHILogoPDF";
import { AirlineLogoPDF } from "../AirlineLogoPDF";
import { resolveAirlineLogoUrl } from "../../lib/airlineLogos";
import { estimateWrappedLines } from "../../lib/helpers";

export interface MarketingReceiptData {
  entryRef: string;
  awbTagNumber?: string;
  airline?: string;
  date: string;
  agentName: string;
  customerName: string;
  phone?: string;
  route: string;
  bigBags: number;
  medBags: number;
  smallBags: number;
  amount: number;
  paymentMode: string;
  paymentNarration?: string;
  bankName?: string;
  qrCodeDataUrl?: string;
  airlineLogoUrl?: string | null;
  remark?: string;
}

export interface MarketingDailySummaryData {
  date: string;
  agentName: string;
  hubName: string;
  entries: Array<{
    customerName: string;
    route: string;
    bags: string;
    amount: number;
    paymentMode: string;
    bank?: string;
  }>;
  totalSales: number;
  cashSales: number;
  transferSales: number;
  expenses: Array<{ type: string; amount: number; description: string }>;
  totalExpenses: number;
  balanceToRemit: number;
}

function formatNaira(n: number | string): string {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  return 'NGN ' + (num || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const styles = StyleSheet.create({
  page: { padding: 6, fontFamily: "Helvetica", backgroundColor: "#FFFFFF" },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
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
  awbValue: {
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
  bagRow: {
    flexDirection: "row",
    marginVertical: 4,
  },
  bagBox: {
    borderWidth: 1,
    borderColor: "#000000",
    flex: 1,
    margin: 1,
    padding: 4,
    alignItems: "center",
  },
  bagCount: {
    fontSize: 18,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    color: "#000000",
  },
  bagLabel: {
    fontSize: 7,
    textTransform: "uppercase",
    color: "#777777",
    fontFamily: "Helvetica",
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

// Row layout: page padding 6pt each side, label column fixed at 60pt --
// matches CargoReceipt.tsx's identical 226pt-wide row layout, so the same
// column width applies here.
const VALUE_COL_WIDTH = 148;

const MarketingReceiptPDF = ({ data }: { data: MarketingReceiptData }) => {
  // +45 to accommodate the larger header logos (now sized to fill each
  // half of the page width instead of a small centered logo).
  let h = 335;
  if (data.awbTagNumber) h += 14;
  if (data.phone) h += 14;
  if (data.airline) h += 14;
  if (data.bankName) h += 14;
  if (data.paymentMode === "Transfer" && data.paymentNarration) h += 14;
  if (data.remark) h += 28;

  // Customer/route/remark/narration are free text with no length cap on
  // entry -- a fixed per-field estimate above only accounts for whether a
  // section is present, not how much text it holds. Same bug class fixed
  // in CargoReceipt.tsx: an underestimate here doesn't clip text, it
  // silently pushes content onto an unwanted, near-empty second page.
  for (const field of [data.customerName, data.route, data.remark, data.paymentNarration, data.agentName]) {
    if (!field) continue;
    const lines = estimateWrappedLines(field, VALUE_COL_WIDTH, 8);
    if (lines > 1) h += (lines - 1) * 12;
  }

  return (
  <Document>
    <Page size={[226, h]} style={styles.page}>
      <View style={[styles.headerRow, styles.headerBorder]}>
        <EHILogoPDF width={105} />
        {data.airline && <AirlineLogoPDF airline={data.airline} logoUrl={data.airlineLogoUrl} width={105} />}
      </View>

      <View style={styles.titleBar}>
        <Text style={styles.titleText}>FIELD MARKETING RECEIPT</Text>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>TRANSACTION INFO</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Ref</Text>
        <Text style={styles.value}>{data.entryRef}</Text>
      </View>
      {data.awbTagNumber ? (
        <View style={styles.row}>
          <Text style={styles.label}>Tag Ref</Text>
          <Text style={styles.awbValue}>{data.awbTagNumber}</Text>
        </View>
      ) : null}
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
        <Text style={styles.label}>Route</Text>
        <Text style={styles.value}>{data.route}</Text>
      </View>
      {data.airline ? (
        <View style={styles.row}>
          <Text style={styles.label}>Airline</Text>
          <Text style={styles.value}>{data.airline}</Text>
        </View>
      ) : null}

      {data.remark ? (
        <View style={styles.row}>
          <Text style={styles.label}>Remark</Text>
          <Text style={styles.value}>{data.remark}</Text>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>BAG BREAKDOWN</Text>
      </View>

      <View style={styles.bagRow}>
        <View style={styles.bagBox}>
          <Text style={styles.bagCount}>{data.bigBags}</Text>
          <Text style={styles.bagLabel}>BB</Text>
        </View>
        <View style={styles.bagBox}>
          <Text style={styles.bagCount}>{data.medBags}</Text>
          <Text style={styles.bagLabel}>MB</Text>
        </View>
        <View style={styles.bagBox}>
          <Text style={styles.bagCount}>{data.smallBags}</Text>
          <Text style={styles.bagLabel}>SB</Text>
        </View>
      </View>

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
  </Document>
  );
};

export const downloadMarketingReceipt = async (data: MarketingReceiptData) => {
  if (data.airlineLogoUrl === undefined && data.airline) {
    data.airlineLogoUrl = await resolveAirlineLogoUrl(data.airline);
  }
  const blob = await pdf(<MarketingReceiptPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Receipt_${data.entryRef}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};

const summaryStyles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica" },
  header: { marginBottom: 20 },
  companyName: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 4,
  },
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
  tableColHeader: {
    width: "16.6%",
    borderStyle: "solid",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
    padding: 5,
  },
  tableColHeaderSmall: {
    width: "8%",
    borderStyle: "solid",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
    padding: 5,
  },
  tableColHeaderLarge: {
    width: "25%",
    borderStyle: "solid",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
    padding: 5,
  },
  tableCol: {
    width: "16.6%",
    borderStyle: "solid",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderColor: "#e5e7eb",
    padding: 5,
  },
  tableColSmall: {
    width: "8%",
    borderStyle: "solid",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderColor: "#e5e7eb",
    padding: 5,
  },
  tableColLarge: {
    width: "25%",
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
    backgroundColor: "#D1FAE5",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#10B981",
  },
  balanceText: { fontSize: 14, fontWeight: "bold", color: "#065F46" },
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

const MarketingDailySummaryPDF = ({
  data,
}: {
  data: MarketingDailySummaryData;
}) => (
  <Document>
    <Page size="A4" style={summaryStyles.page}>
      <View style={summaryStyles.header}>
        <View style={{ alignItems: "center", marginBottom: 15 }}>
          <EHILogoPDF width={120} />
        </View>
        <Text style={summaryStyles.title}>FIELD MARKETING DAILY SUMMARY</Text>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginTop: 10,
          }}
        >
          <Text style={{ fontSize: 10 }}>Date: {data.date}</Text>
          <Text style={{ fontSize: 10 }}>Agent: {data.agentName}</Text>
        </View>
        <Text style={{ fontSize: 10, marginTop: 5 }}>Hub: {data.hubName}</Text>
      </View>

      <Text style={summaryStyles.tableTitle}>ENTRIES</Text>
      <View style={summaryStyles.table}>
        <View style={summaryStyles.tableRow}>
          <View style={summaryStyles.tableColSmall}>
            <Text style={summaryStyles.tableCellHeader}>#</Text>
          </View>
          <View style={summaryStyles.tableColLarge}>
            <Text style={summaryStyles.tableCellHeader}>Customer</Text>
          </View>
          <View style={summaryStyles.tableColLarge}>
            <Text style={summaryStyles.tableCellHeader}>Route</Text>
          </View>
          <View style={summaryStyles.tableCol}>
            <Text style={summaryStyles.tableCellHeader}>Bags</Text>
          </View>
          <View style={summaryStyles.tableCol}>
            <Text style={summaryStyles.tableCellHeader}>Amount (NGN)</Text>
          </View>
          <View style={summaryStyles.tableCol}>
            <Text style={summaryStyles.tableCellHeader}>Mode</Text>
          </View>
        </View>
        {data.entries.map((entry, i) => (
          <View style={summaryStyles.tableRow} key={i}>
            <View style={summaryStyles.tableColSmall}>
              <Text style={summaryStyles.tableCell}>{i + 1}</Text>
            </View>
            <View style={summaryStyles.tableColLarge}>
              <Text style={summaryStyles.tableCell}>{entry.customerName}</Text>
            </View>
            <View style={summaryStyles.tableColLarge}>
              <Text style={summaryStyles.tableCell}>{entry.route}</Text>
            </View>
            <View style={summaryStyles.tableCol}>
              <Text style={summaryStyles.tableCell}>{entry.bags}</Text>
            </View>
            <View style={summaryStyles.tableCol}>
              <Text style={summaryStyles.tableCell}>
                {entry.amount.toLocaleString("en-NG")}
              </Text>
            </View>
            <View style={summaryStyles.tableCol}>
              <Text style={summaryStyles.tableCell}>{entry.paymentMode}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <View style={{ width: "48%" }}>
          <View style={summaryStyles.summaryBox}>
            <Text style={{ fontSize: 10, fontWeight: "bold", marginBottom: 5 }}>
              REVENUE
            </Text>
            <Text style={{ fontSize: 9, marginBottom: 3 }}>
              Total Sales: NGN {data.totalSales.toLocaleString("en-NG")}
            </Text>
            <Text style={{ fontSize: 9, marginBottom: 3 }}>
              Cash Sales: NGN {data.cashSales.toLocaleString("en-NG")}
            </Text>
            <Text style={{ fontSize: 9 }}>
              Transfer/POS: NGN {data.transferSales.toLocaleString("en-NG")}
            </Text>
          </View>
        </View>

        <View style={{ width: "48%" }}>
          <View style={summaryStyles.summaryBox}>
            <Text style={{ fontSize: 10, fontWeight: "bold", marginBottom: 5 }}>
              EXPENSES ({data.expenses.length})
            </Text>
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
        <Text style={summaryStyles.balanceText}>
          BALANCE TO REMIT: NGN {data.balanceToRemit.toLocaleString("en-NG")}
        </Text>
        <Text style={{ fontSize: 8, color: "#065F46", marginTop: 2 }}>
          (Cash Sales minus Total Expenses)
        </Text>
      </View>

      <View style={summaryStyles.signatures}>
        <Text style={summaryStyles.signatureLine}>
          Agent Signature: __________________
        </Text>
        <Text style={summaryStyles.signatureLine}>
          Supervisor Signature: _______________
        </Text>
      </View>

      <Text
        style={{
          fontSize: 8,
          color: "#9ca3af",
          textAlign: "center",
          marginTop: 30,
        }}
      >
        Generated by EHI Logistics Platform
      </Text>
    </Page>
  </Document>
);

export const downloadMarketingDailySummary = async (
  data: MarketingDailySummaryData,
) => {
  const blob = await pdf(<MarketingDailySummaryPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MarketingDailySummary_${data.date.replace(/[/ ]/g, "_")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
