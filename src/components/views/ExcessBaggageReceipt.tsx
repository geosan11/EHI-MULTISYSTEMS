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
import { resolveAirlineLogoUrl } from "../../lib/airlineLogos";
import { estimateWrappedLines } from "../../lib/helpers";
import { printPdfSmart } from "../../lib/qzPrint";
import { notifySilentError } from "../../lib/ToastContext";

export interface BaggageReceiptData {
  airlineName: string;
  entryRef: string;
  date: string;
  hubName: string;
  agentName: string;
  passengerName: string;
  flightNumber: string;
  destination: string;
  totalPieces: number;
  totalBaggage: number;
  freeAllowance: number;
  excessKg: number;
  ratePerKg: number;
  amount: number;
  paymentMode: string;
  paymentNarration?: string;
  bankName?: string;
  qrCodeDataUrl?: string;
  airlineLogoUrl?: string | null;
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
  title: {
    fontSize: 10,
    color: "#000000",
    textTransform: "uppercase",
    marginBottom: 4,
    alignSelf: "center",
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
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
    marginVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: "#000000",
    borderBottomStyle: "dashed",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  label: {
    fontSize: 8,
    color: "#000000",
    textTransform: "uppercase",
    width: 60,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
  },
  value: {
    fontSize: 8,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    flex: 1,
    textAlign: "right",
  },
  amountContainer: {
    marginTop: 4,
    padding: 4,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#000000",
  },
  amountLabel: {
    fontSize: 10,
    color: "#000000",
    textTransform: "uppercase",
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
  },
  amountValue: {
    fontSize: 12,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    textAlign: "right",
  },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: 2 },
  footerText: {
    fontSize: 7,
    color: "#000000",
    textAlign: "center",
    marginTop: 1,
  },
  sectionTitle: {
    fontSize: 9,
    color: "#000000",
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
    textTransform: "uppercase",
  },
  qrContainer: { alignItems: "center", marginVertical: 2 },
  qrImage: { width: 55, height: 55 },
});

// page width (226) minus left+right padding (12+12) minus the fixed label
// column (60), with a 6pt safety cushion -- what's actually left for a
// row's wrappable value text. Kept slightly narrower than the true 142pt
// so a value near the wrap boundary rounds up to an extra line instead of
// running out of room (matching this file's own generous-estimate philosophy).
const VALUE_COL_WIDTH = 136;

const BaggageReceiptPDF = ({ data }: { data: BaggageReceiptData }) => {
  // Base measured empirically the same way as CargoReceipt.tsx's -- the
  // previous base (315) was short even for the shortest-plausible receipt
  // before any optional section, so every real receipt (which always has
  // a QR code) was already silently spilling a mostly-blank second page.
  let h = 450;
  if (data.qrCodeDataUrl) h += 60;
  if (data.bankName) h += 20;
  if (data.paymentMode === "Transfer" && data.paymentNarration) h += 25;

  // Passenger name/destination are free text (or a long single-hub route
  // name) with no length cap in the ticketing form -- a fixed estimate
  // that only accounted for optional sections, not text wrapping within a
  // row, let a long enough value silently push content onto an unwanted,
  // near-empty second page instead of fitting on the one page a receipt
  // roll actually needs.
  for (const field of [data.passengerName, data.destination]) {
    const lines = estimateWrappedLines(field, VALUE_COL_WIDTH, 8);
    if (lines > 1) h += (lines - 1) * 12;
  }

  // Two copies (CUSTOMER, MERCHANT) as separate pages in the same PDF --
  // mirrors CargoReceipt.tsx, which already does this; baggage never had it.
  const renderPage = (copyLabel: 'CUSTOMER COPY' | 'MERCHANT COPY') => (
    <Page key={copyLabel} size={[226, h]} style={styles.page}>
      <View style={styles.headerRow}>
        <EHILogoPDF width={70} />
        <AirlineLogoPDF airline={data.airlineName} logoUrl={data.airlineLogoUrl} width={70} />
      </View>
      <Text style={styles.title}>EXCESS BAGGAGE RECEIPT</Text>
      <Text style={{ fontSize: 10, textAlign: 'center', marginBottom: 6 }}>Origin: {data.hubName}</Text>
      <Text style={styles.copyLabelText}>*** {copyLabel} ***</Text>

      {data.qrCodeDataUrl ? (
        <View style={styles.qrContainer}>
          <Image src={data.qrCodeDataUrl} style={styles.qrImage} />
        </View>
      ) : null}

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.label}>Ref:</Text>
        <Text style={styles.value}>{data.entryRef}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Date:</Text>
        <Text style={styles.value}>{data.date}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Origin State:</Text>
        <Text style={styles.value}>{data.hubName}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Agent:</Text>
        <Text style={styles.value}>{data.agentName}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.label}>PASSENGER:</Text>
        <Text style={styles.value}>{data.passengerName}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Flight:</Text>
        <Text style={styles.value}>{data.flightNumber}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Destination:</Text>
        <Text style={styles.value}>{data.destination}</Text>
      </View>

      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>BAGGAGE BREAKDOWN</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Total pieces:</Text>
        <Text style={styles.value}>{data.totalPieces || 1} PCS</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Total weight:</Text>
        <Text style={styles.value}>{Math.round(data.totalBaggage)} KG</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Free allow.:</Text>
        <Text style={styles.value}>{Math.round(data.freeAllowance)} KG</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Excess chrg:</Text>
        <Text style={styles.value}>{Math.round(data.excessKg)} KG</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Rate per KG:</Text>
        <Text style={styles.value}>
          NGN {data.ratePerKg.toLocaleString("en-NG")}
        </Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.amountContainer}>
        <View style={styles.row}>
          <Text style={styles.amountLabel}>AMOUNT:</Text>
          <Text style={styles.amountValue}>
            {formatNaira(data.amount)}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Payment:</Text>
          <Text style={styles.value}>{data.paymentMode}</Text>
        </View>
        {data.bankName ? (
          <View style={styles.row}>
            <Text style={styles.label}>Bank:</Text>
            <Text style={styles.value}>{data.bankName}</Text>
          </View>
        ) : null}
        {data.paymentMode === "Transfer" && data.paymentNarration ? (
          <View style={styles.row}>
            <Text style={styles.label}>Narration:</Text>
            <Text style={styles.value}>{data.paymentNarration}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.divider} />

      <View style={styles.footerRow}>
        <Text style={styles.footerText}>EHI Multisystems Nigeria Limited</Text>
      </View>
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>Track your cargo: app.ehimultisystems.com</Text>
      </View>
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>{data.entryRef} • {data.date}</Text>
      </View>
    </Page>
  );

  return (
    <Document>
      {renderPage('CUSTOMER COPY')}
      {renderPage('MERCHANT COPY')}
    </Document>
  );
};

export const downloadBaggageReceipt = async (data: BaggageReceiptData) => {
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
    data.airlineLogoUrl = await resolveAirlineLogoUrl(data.airlineName);
  }
  const blob = await pdf(<BaggageReceiptPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Receipt_${data.entryRef}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};

export const printBaggageReceipt = async (data: BaggageReceiptData): Promise<void> => {
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
    data.airlineLogoUrl = await resolveAirlineLogoUrl(data.airlineName);
  }
  const blob = await pdf(<BaggageReceiptPDF data={data} />).toBlob();
  const win = await printPdfSmart(blob, `Receipt_${data.entryRef}.pdf`, 'receipt');
  if (win) win.print();
};
