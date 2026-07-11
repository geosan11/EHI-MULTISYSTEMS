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
import { openPdfOrDownload } from "../../lib/helpers";

// Fixed 100mm x 80mm label -- this is a discrete, fixed-size tag (like the
// XP-402B gap/die-cut label printer this was built for), not an
// open-ended continuous roll like the receipt PDFs. Both dimensions are
// therefore fixed, not just the width.
// 100mm = 283.46pt, 80mm = 226.77pt at 72pt/inch.
const PAGE_WIDTH = 283;
const PAGE_HEIGHT = 227;

export interface CargoTagPDFData {
  id: string; // AWB Tag number / Ref
  name: string; // Consignee / Passenger name
  route: string;
  pieces: number; // total piece count for this shipment -- one page is rendered per piece
  weight: number | string;
  airline?: string;
  hubName?: string;
  date?: string;
  qrCodeDataUrl?: string;
  airlineLogoUrl?: string | null;
}

const styles = StyleSheet.create({
  page: {
    padding: 10,
    fontFamily: "Helvetica",
    backgroundColor: "#FFFFFF",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  goldDivider: {
    height: 2,
    backgroundColor: "#000000",
    marginBottom: 6,
  },
  body: {
    flexDirection: "row",
    flex: 1,
  },
  leftCol: {
    flex: 1,
    paddingRight: 8,
  },
  rightCol: {
    width: 92,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  routeLabel: {
    fontSize: 6,
    color: "#6E7B8D",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  routeValue: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    marginBottom: 6,
  },
  awbBand: {
    backgroundColor: "#000000",
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 6,
    borderRadius: 2,
  },
  awbLabel: {
    fontSize: 6,
    color: "#FFFFFF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  awbValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  fieldBlock: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 6,
    color: "#6E7B8D",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  fieldValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  // Consignee and Weight are the two fields a handler needs at a glance
  // besides the route -- sized close to routeValue (15) instead of the
  // regular fieldValue (9) used for secondary fields like Hub.
  fieldValueLarge: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  pieceBadge: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#000000",
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 6,
    alignSelf: "flex-start",
    marginBottom: 4,
  },
  pieceBadgeText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
  },
  qrImage: {
    width: 82,
    height: 82,
    marginBottom: 4,
  },
  qrCaption: {
    fontSize: 5.5,
    color: "#6E7B8D",
    textAlign: "center",
  },
  footer: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingTop: 3,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 5.5,
    color: "#94A3B8",
  },
});

// wrap={false} on the Page keeps this label capped at exactly one physical
// page per piece -- react-pdf's default (wrap=true) would otherwise silently
// spill overflowing content onto an extra, unlabeled page for a single fixed-
// size 100x80mm label, which makes no sense on a die-cut label printer.
// Because wrap is off, nothing reflows to a second page if content runs
// long -- it just gets clipped. Consignee is the one field here with
// unbounded length, so it's truncated to a width that's guaranteed to fit
// fieldValueLarge (13pt bold) on a single line within leftCol, rather than
// risking a wrapped second line pushing the footer off the fixed page.
const truncateForTag = (str: string, max: number) =>
  str.length > max ? str.slice(0, max - 1).trimEnd() + "…" : str;

const CargoTagPage = ({
  data,
  pieceIndex,
  totalPieces,
}: {
  data: CargoTagPDFData;
  pieceIndex: number;
  totalPieces: number;
}) => (
  <Page size={[PAGE_WIDTH, PAGE_HEIGHT]} style={styles.page} wrap={false}>
    <View style={styles.headerRow}>
      <EHILogoPDF width={70} variant="cargo" />
      {data.airline ? <AirlineLogoPDF airline={data.airline} logoUrl={data.airlineLogoUrl} width={70} /> : null}
    </View>
    <View style={styles.goldDivider} />

    <View style={styles.body}>
      <View style={styles.leftCol}>
        <Text style={styles.routeLabel}>Route</Text>
        <Text style={styles.routeValue}>{data.route?.toUpperCase() || "—"}</Text>

        <View style={styles.awbBand}>
          <Text style={styles.awbLabel}>AWB / Tag</Text>
          {/* Each physical piece gets its own sequential tag number
              (base AWB + piece suffix) so two tags in the same shipment
              are never visually identical -- the QR code/tracking
              reference still points at the shared base AWB below. */}
          <Text style={styles.awbValue}>{data.id}-{pieceIndex}</Text>
        </View>

        <View style={styles.pieceBadge}>
          <Text style={styles.pieceBadgeText}>PIECE {pieceIndex} of {totalPieces}</Text>
        </View>

        <View style={styles.fieldRow}>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Weight</Text>
            <Text style={styles.fieldValueLarge}>{data.weight} KG</Text>
          </View>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Hub</Text>
            <Text style={styles.fieldValue}>{data.hubName || "—"}</Text>
          </View>
        </View>

        <View style={styles.fieldRow}>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Consignee</Text>
            <Text style={styles.fieldValueLarge}>{truncateForTag(data.name || "—", 20)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.rightCol}>
        {data.qrCodeDataUrl ? (
          <Image src={data.qrCodeDataUrl} style={styles.qrImage} />
        ) : null}
        <Text style={styles.qrCaption}>Scan to track</Text>
      </View>
    </View>

    <View style={styles.footer}>
      <Text style={styles.footerText}>EHI MULTISYSTEMS NIGERIA LIMITED</Text>
      <Text style={styles.footerText}>{data.date || ""}</Text>
    </View>
  </Page>
);

const CargoTagOnlyPDF = ({ data }: { data: CargoTagPDFData }) => {
  const totalPieces = Math.max(1, Number(data.pieces) || 1);
  return (
    <Document>
      {Array.from({ length: totalPieces }, (_, i) => (
        <CargoTagPage key={i} data={data} pieceIndex={i + 1} totalPieces={totalPieces} />
      ))}
    </Document>
  );
};

async function buildTagData(data: CargoTagPDFData): Promise<CargoTagPDFData> {
  let result = data;
  if (!result.qrCodeDataUrl) {
    const trackingUrl = `https://app.ehimultisystems.com/track?ref=${encodeURIComponent(result.id)}`;
    try {
      const qrCodeDataUrl = await QRCode.toDataURL(trackingUrl, { margin: 1, width: 240, errorCorrectionLevel: 'L' });
      result = { ...result, qrCodeDataUrl };
    } catch (e) {
      console.warn("Failed to generate QR code for tag PDF", e);
    }
  }
  if (result.airlineLogoUrl === undefined && result.airline) {
    result = { ...result, airlineLogoUrl: await resolveAirlineLogoUrl(result.airline) };
  }
  return result;
}

// Opens the tag in a new tab for printing via the browser's native print
// dialog -- this is the recommended path for the XP-402B and similar
// gap/die-cut label printers connected over USB, since it goes through
// the OS's own printer driver rather than raw Bluetooth GATT writes,
// sidestepping the chunking/speed/corruption issues that come with
// talking directly to a Bluetooth ESC/POS characteristic.
//
// Callers should open `preOpenedWindow` themselves via
// `window.open('', '_blank')` synchronously in their click handler, before
// awaiting this function -- see the comment on openPdfOrDownload for why.
export const printCargoTagPDF = async (data: CargoTagPDFData, preOpenedWindow?: Window | null) => {
  const withQr = await buildTagData(data);
  const blob = await pdf(<CargoTagOnlyPDF data={withQr} />).toBlob();
  const url = URL.createObjectURL(blob);
  openPdfOrDownload(url, `EHI-Tag-${data.id}.pdf`, preOpenedWindow);
};

export const downloadCargoTagPDF = async (data: CargoTagPDFData) => {
  const withQr = await buildTagData(data);
  const blob = await pdf(<CargoTagOnlyPDF data={withQr} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `EHI-Tag-${data.id}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
