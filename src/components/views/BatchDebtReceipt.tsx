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

export interface BatchDebtReceiptItem {
  ref: string;
  route: string;
  type: string;
  amount: number;
  // Cargo/marketing's physical AWB tag -- distinct from `ref` (entry_ref),
  // which is this app's own internal reference and not what's written on
  // the actual tag/label. Undefined for baggage/package, which don't tag
  // the same way.
  tagNumber?: string;
  pieces?: number;
  kg?: number;
}

export interface BatchDebtReceiptData {
  batchRef: string;
  date: string;
  agentName: string;
  customerName: string;
  customerPhone?: string;
  items: BatchDebtReceiptItem[];
  totalAmount: number;
  paymentMode: string;
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

// Same 226pt-wide narrow-receipt visual language as CargoReceipt.tsx/
// PackageReceipt.tsx/MarketingReceipt.tsx -- ITEMS is the one section
// unique to this receipt (a repeating row per settled debt instead of a
// single item's details).
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
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#EEEEEE",
  },
  itemRoute: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    flex: 1,
  },
  itemRef: {
    fontSize: 6,
    fontFamily: "Courier",
    color: "#888888",
  },
  itemDetails: {
    fontSize: 7,
    fontFamily: "Helvetica",
    color: "#555555",
    marginTop: 1,
  },
  itemAmount: {
    fontSize: 8,
    fontFamily: "Courier-Bold",
    color: "#000000",
    textAlign: "right",
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

const VALUE_COL_WIDTH = 136;
// Roughly the vertical space one itemRow takes (route line + ref line +
// pieces/kg details line + border/padding) -- used only to grow the page,
// never to lay anything out, so an approximation is fine.
const ITEM_ROW_HEIGHT = 30;

const BatchDebtReceiptPDF = ({ data }: { data: BatchDebtReceiptData }) => {
  let h = 300;
  h += 14; // "*** CUSTOMER/MERCHANT COPY ***" line, unconditional
  if (data.qrCodeDataUrl) h += 60;
  if (data.customerPhone) h += 14;
  if (data.bankName) h += 14;
  h += data.items.length * ITEM_ROW_HEIGHT;

  for (const field of [data.customerName, data.agentName]) {
    const lines = estimateWrappedLines(field, VALUE_COL_WIDTH, 8);
    if (lines > 1) h += (lines - 1) * 14;
  }

  const renderPage = (copyLabel: 'CUSTOMER COPY' | 'MERCHANT COPY') => (
    <Page key={copyLabel} size={[226, h]} style={styles.page}>
      <View style={[styles.headerRow, styles.headerBorder]}>
        <EHILogoPDF width={70} />
      </View>

      <View style={styles.titleBar}>
        <Text style={styles.titleText}>BATCH DEBT SETTLEMENT RECEIPT</Text>
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
        <Text style={styles.label}>Batch Ref</Text>
        <Text style={styles.refValue}>{data.batchRef}</Text>
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
      {data.customerPhone ? (
        <View style={styles.row}>
          <Text style={styles.label}>Phone</Text>
          <Text style={styles.value}>{data.customerPhone}</Text>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>ITEMS ({data.items.length})</Text>
      </View>
      {data.items.map((item, i) => (
        <View key={i} style={styles.itemRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemRoute}>{item.route || item.type}</Text>
            <Text style={styles.itemRef}>
              {item.ref}{item.tagNumber && item.tagNumber !== item.ref ? ` · Tag: ${item.tagNumber}` : ''}
            </Text>
            {(item.pieces || item.kg) ? (
              <Text style={styles.itemDetails}>
                {item.pieces ? `${item.pieces}pcs` : ''}{item.pieces && item.kg ? ' · ' : ''}{item.kg ? `${item.kg}kg` : ''}
              </Text>
            ) : null}
          </View>
          <Text style={styles.itemAmount}>{formatNaira(item.amount)}</Text>
        </View>
      ))}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>PAYMENT</Text>
      </View>
      <View style={styles.amountBox}>
        <Text style={styles.amountBoxLabel}>TOTAL AMOUNT</Text>
        <Text style={styles.amountBoxValue}>{formatNaira(data.totalAmount)}</Text>
        <Text style={styles.amountBoxSub}>
          {data.paymentMode}{data.bankName ? ` • ${data.bankName}` : ''}
        </Text>
      </View>

      <View style={[styles.divider, { marginTop: 6 }]} />
      <Text style={styles.footerText}>app.ehimultisystems.com</Text>
      <Text style={styles.footerText}>{data.batchRef} • {data.date}</Text>
    </Page>
  );

  return (
    <Document>
      {renderPage('CUSTOMER COPY')}
      {renderPage('MERCHANT COPY')}
    </Document>
  );
};

export const downloadBatchDebtReceipt = async (data: BatchDebtReceiptData) => {
  if (!data.qrCodeDataUrl) {
    try {
      data.qrCodeDataUrl = await QRCode.toDataURL(data.batchRef, {
        margin: 1,
        width: 200,
        errorCorrectionLevel: 'L',
      });
    } catch (e) {
      console.warn("Failed to generate QR code", e);
      notifySilentError('This receipt printed without a scannable batch QR code.');
    }
  }
  const blob = await pdf(<BatchDebtReceiptPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `BatchReceipt_${data.batchRef}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
