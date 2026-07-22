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
import { openPdfOrDownload, getHubCode, cleanRoute } from "../../lib/helpers";
import { printPdfSmart } from "../../lib/qzPrint";
import { notifySilentError } from "../../lib/ToastContext";

// Fixed 100mm x 80mm label -- same discrete, fixed-size tag format as
// CargoTagPDF, for the XP-402B and similar gap/die-cut label printers.
// 100mm = 283.46pt, 80mm = 226.77pt at 72pt/inch.
// Sized slightly wider for improved layout: 312pt.
const PAGE_WIDTH = 312;
const PAGE_HEIGHT = 227;

export interface PackageTagPDFData {
  id: string; // Tracking ref
  name: string; // Customer name
  destination: string;
  contentType: string; // 'Package' | 'Parcel'
  pieces?: number;
  kg?: number;
  contents?: string;
  hubName?: string;
  date?: string;
  qrCodeDataUrl?: string;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 10,
    paddingRight: 10,
    paddingBottom: 10,
    paddingLeft: 16,
    fontFamily: "Helvetica",
    backgroundColor: "#FFFFFF",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    marginBottom: 2,
  },
  divider: {
    height: 1,
    backgroundColor: "#000000",
    marginBottom: 4,
  },
  dateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 2,
  },
  dateText: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    fontWeight: "bold",
    color: "#000000",
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
    width: 96,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  destLabel: {
    fontSize: 6,
    color: "#6E7B8D",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  destValue: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    marginBottom: 6,
  },
  refBand: {
    backgroundColor: "#000000",
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 6,
    borderRadius: 2,
  },
  refLabel: {
    fontSize: 6,
    color: "#FFFFFF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  refValue: {
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
  hubValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    fontWeight: "bold",
    color: "#000000",
  },
  fieldValueLarge: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  nameValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    fontWeight: "bold",
    color: "#000000",
    marginTop: 2,
  },
  typeBadge: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#000000",
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 6,
    alignSelf: "flex-start",
    marginBottom: 4,
  },
  typeBadgeText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
  },
  qrImage: {
    width: 82,
    height: 82,
    marginBottom: 2,
  },
  qrCaption: {
    fontSize: 5.5,
    color: "#6E7B8D",
    textAlign: "center",
    marginBottom: 4,
  },
  contentUnderQr: {
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 3,
    width: "100%",
  },
  contentLabelUnderQr: {
    fontSize: 5.5,
    color: "#4B5563",
    textTransform: "uppercase",
    fontFamily: "Helvetica",
    marginBottom: 1.5,
  },
  contentValueUnderQr: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    fontWeight: "bold",
    color: "#000000",
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

// Same fixed-page/wrap={false} clipping risk as CargoTagPDF.tsx (see its
// truncateForTag comment) -- `contents` is free text with no length limit
// from the form, and unlike `contentType` (a bounded Package/Parcel select
// value) it can easily run long enough to wrap within the typeBadge and
// push the footer (company name/date) off the bottom of this fixed
// 100x80mm label. truncateForTag isn't exported from CargoTagPDF.tsx, so
// this is the same clamping logic duplicated locally.
const truncateForTag = (str: string, max: number) =>
  str.length > max ? str.slice(0, max - 1).trimEnd() + "…" : str;

// No pieces/multi-page concept here -- unlike Cargo (which can have several
// physical pieces) a Package/Parcel entry is always exactly one item, so
// this is a single Page, not a Document loop.
const PackageTagOnlyPDF = ({ data }: { data: PackageTagPDFData }) => (
  <Document>
    <Page size={[PAGE_WIDTH, PAGE_HEIGHT]} style={styles.page} wrap={false}>
      <View style={styles.headerRow}>
        <EHILogoPDF width={54} variant="cargo" />
      </View>
      <View style={styles.divider} />

      <View style={styles.dateRow}>
        <Text style={styles.dateText}>DATE: {data.date || "—"}</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.leftCol}>
          <Text style={styles.destLabel}>Destination</Text>
          <Text style={styles.destValue}>{cleanRoute(data.destination)}</Text>

          <View style={styles.refBand}>
            <Text style={styles.refLabel}>Tracking Ref</Text>
            <Text style={styles.refValue}>{data.id}</Text>
          </View>

          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>
              {data.contentType?.toUpperCase() || "PACKAGE"}
            </Text>
            {data.contents && (
              <Text style={styles.typeBadgeText}>
                {truncateForTag(data.contents.toUpperCase(), 30)}
              </Text>
            )}
          </View>

          <View style={styles.fieldRow}>
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Pcs</Text>
              <Text style={styles.fieldValue}>{data.pieces || "—"}</Text>
            </View>
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>KG</Text>
              <Text style={styles.fieldValue}>{data.kg || "—"}</Text>
            </View>
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Hub</Text>
              <Text style={styles.hubValue}>{getHubCode(data.hubName) || "—"}</Text>
            </View>
          </View>

          <View style={styles.fieldRow}>
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Consignee</Text>
              <Text style={styles.nameValue}>{truncateForTag(data.name || "—", 30)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.rightCol}>
          {data.qrCodeDataUrl ? (
            <Image src={data.qrCodeDataUrl} style={styles.qrImage} />
          ) : null}
          <Text style={styles.qrCaption}>Scan to track</Text>

          <View style={styles.contentUnderQr}>
            <Text style={styles.contentLabelUnderQr}>Content</Text>
            <Text style={styles.contentValueUnderQr}>{truncateForTag(data.contentType || "—", 12)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>EHI MULTISYSTEMS NIGERIA LIMITED</Text>
      </View>
    </Page>
  </Document>
);

async function buildTagData(data: PackageTagPDFData): Promise<PackageTagPDFData> {
  if (data.qrCodeDataUrl) return data;
  const trackingUrl = `https://app.ehimultisystems.com/track/${encodeURIComponent(data.id)}`;
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(trackingUrl, { margin: 1, width: 240, errorCorrectionLevel: 'L' });
    return { ...data, qrCodeDataUrl };
  } catch (e) {
    console.warn("Failed to generate QR code for package tag PDF", e);
    notifySilentError('This tag printed without a scannable QR code -- hub scanning for it will need the tracking ref typed in manually.');
    return data;
  }
}

export const printPackageTagPDF = async (data: PackageTagPDFData, preOpenedWindow?: Window | null) => {
  const withQr = await buildTagData(data);
  const blob = await pdf(<PackageTagOnlyPDF data={withQr} />).toBlob();
  await printPdfSmart(blob, `EHI-Tag-${data.id}.pdf`, 'tag', preOpenedWindow);
};

export const downloadPackageTagPDF = async (data: PackageTagPDFData) => {
  const withQr = await buildTagData(data);
  const blob = await pdf(<PackageTagOnlyPDF data={withQr} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `EHI-Tag-${data.id}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
