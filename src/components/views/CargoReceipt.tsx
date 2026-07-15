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
  let h = 430;
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

  return (
  <Document>
    <Page size={[226, h]} style={styles.page}>
      <View style={[styles.headerRow, styles.headerBorder]}>
        <EHILogoPDF width={70} />
        <AirlineLogoPDF airline={data.airline} logoUrl={data.airlineLogoUrl} width={70} />
      </View>

      <View style={styles.titleBar}>
        <Text style={styles.titleText}>CARGO ENTRY RECEIPT</Text>
      </View>

      <Text style={styles.originLine}>Origin: {data.hubName}</Text>

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
