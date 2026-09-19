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
  // Pre-formatted "HH:MM" (matches every Transaction.time already computed
  // by the mappers this data is built from) -- when this entry was logged,
  // not when the batch/receipt was printed.
  time?: string;
  // Cargo/package's content_type (e.g. "General Goods", "Electronics") --
  // undefined for baggage/marketing, which don't track this.
  contentType?: string;
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

// Route/destination strings are "CODE/Full City Name" (see hubRoutes.ts's
// `${h.code}/${h.name}` format) -- a batch receipt lists several of these
// at once, so the short code alone (e.g. "ABV" instead of "ABV/Abuja Air
// Cargo Station") keeps each item line compact and scannable.
function formatRouteCode(route: string): string {
  if (!route) return '';
  return route.split('/')[0];
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
  // A previous version of this nested a `{flex:1}`-only View (route/tag/
  // pieces stacked) as a sibling of the amount Text, both inside a single
  // row-direction itemRow -- that unstyled inner View's own children
  // ended up overlapping instead of stacking (react-pdf/Yoga rendered the
  // tag line on top of the route line rather than below it). Explicit
  // column-direction rows/lines, each its own top-level child of itemRow,
  // is the same defensive pattern already used elsewhere in this file
  // (the label/value `row` style above) and avoids that nesting entirely.
  itemRow: {
    flexDirection: "column",
    marginBottom: 3,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#EEEEEE",
  },
  itemHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
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
// itemRow splits its width between the text block (route/tag/pieces) and
// the right-aligned amount -- this is what's actually left for wrapping
// once a typical Naira amount ("NGN 123,456.78" at 8pt Courier-Bold, ~67pt)
// and the gap between them are accounted for. Erring smaller (a more
// generous wrap estimate) rather than exact, per estimateWrappedLines' own
// "deliberately generous" guidance.
const ITEM_TEXT_COL_WIDTH = 120;
// Approximate per-line height across the three possible lines in an item
// (8pt route, 6pt tag, 7pt pieces/kg) -- flat and slightly generous for the
// smaller-font lines rather than computing each precisely, since this only
// ever pads the page-height guess, never lays anything out.
const ITEM_LINE_HEIGHT = 10;
// itemRow's own marginBottom(3) + paddingBottom(3) + borderBottomWidth(1),
// rounded up for slack.
const ITEM_ROW_SPACING = 8;

// The previous version of this function used one flat ITEM_ROW_HEIGHT
// guess per item with no allowance for the route/destination text
// wrapping onto a second line -- exactly the under-estimate
// estimateWrappedLines' own comment warns about ("doesn't clip content,
// it silently pushes it onto a second, mostly-blank page"), which is what
// was causing this receipt to render 4 pages instead of 2 once several
// items (some with longer route names) pushed the real content past the
// guessed page height and react-pdf auto-paginated the overflow.
// pieces/kg/contentType share one line ("2pcs · 44kg · General Goods") --
// shared with the actual render below so the height estimate can never
// silently drift from what's actually drawn.
function formatItemDetailsLine(item: BatchDebtReceiptItem): string {
  const parts: string[] = [];
  if (item.pieces) parts.push(`${item.pieces}pcs`);
  if (item.kg) parts.push(`${item.kg}kg`);
  if (item.contentType) parts.push(item.contentType);
  return parts.join(' · ');
}

function estimateItemHeight(item: BatchDebtReceiptItem): number {
  const routeLines = estimateWrappedLines(item.route || item.type, ITEM_TEXT_COL_WIDTH, 8);
  let totalLines = routeLines + 1; // route(+wrap) + tag/time line
  const details = formatItemDetailsLine(item);
  // contentType can push this line long enough to wrap too -- same
  // under-estimate risk as the route line above if left unaccounted for.
  if (details) totalLines += estimateWrappedLines(details, ITEM_TEXT_COL_WIDTH, 7);
  return totalLines * ITEM_LINE_HEIGHT + ITEM_ROW_SPACING;
}

const BatchDebtReceiptPDF = ({ data }: { data: BatchDebtReceiptData }) => {
  let h = 300;
  h += 14; // "*** CUSTOMER/MERCHANT COPY ***" line, unconditional
  if (data.qrCodeDataUrl) h += 60;
  if (data.customerPhone) h += 14;
  if (data.bankName) h += 14;
  h += data.items.reduce((sum, item) => sum + estimateItemHeight(item), 0);
  // Fixed safety margin on top of the per-item estimates above -- "a
  // receipt with a little trailing blank space is fine; one that spills a
  // page is not" (estimateWrappedLines' own comment).
  h += 20;

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
          <View style={styles.itemHeaderRow}>
            <Text style={styles.itemRoute}>{formatRouteCode(item.route) || item.type}</Text>
            <Text style={styles.itemAmount}>{formatNaira(item.amount)}</Text>
          </View>
          <Text style={styles.itemRef}>
            Tag: {item.tagNumber || item.ref}{item.time ? ` · ${item.time}` : ''}
          </Text>
          {formatItemDetailsLine(item) ? (
            <Text style={styles.itemDetails}>{formatItemDetailsLine(item)}</Text>
          ) : null}
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
