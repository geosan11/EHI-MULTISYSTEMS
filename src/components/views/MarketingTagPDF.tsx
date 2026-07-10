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

// Fixed 100mm x 80mm label -- same discrete, fixed-size tag format as
// CargoTagPDF, for the XP-402B and similar gap/die-cut label printers.
// 100mm = 283.46pt, 80mm = 226.77pt at 72pt/inch.
const PAGE_WIDTH = 283;
const PAGE_HEIGHT = 227;

export interface MarketingTagPDFData {
  id: string; // AWB / Tag ref
  name: string; // Customer name
  route: string;
  airline?: string;
  hubName?: string;
  date?: string;
  bigBags: number;
  medBags: number;
  smallBags: number;
  qrCodeDataUrl?: string;
  airlineLogoUrl?: string | null;
}

interface BagPage {
  bagType: 'BB' | 'MB' | 'SB';
  bagTypeFull: string;
  pieceIndex: number;
  totalForType: number;
}

// Same ordering as escposTagPrinting.ts's compileMarketingTagStream (BB,
// then MB, then SB) so the PDF tag and the Bluetooth bag tag show the same
// content for the same physical bag.
function buildBagPages(data: MarketingTagPDFData): BagPage[] {
  const bags: Array<{ type: BagPage['bagType']; full: string; count: number }> = [
    { type: 'BB', full: 'BIG BAG', count: data.bigBags },
    { type: 'MB', full: 'MED BAG', count: data.medBags },
    { type: 'SB', full: 'SMALL BAG', count: data.smallBags },
  ];
  const pages: BagPage[] = [];
  for (const bag of bags) {
    for (let i = 1; i <= bag.count; i++) {
      pages.push({ bagType: bag.type, bagTypeFull: bag.full, pieceIndex: i, totalForType: bag.count });
    }
  }
  return pages.length > 0 ? pages : [{ bagType: 'BB', bagTypeFull: 'BIG BAG', pieceIndex: 1, totalForType: 1 }];
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
  divider: {
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
  bagBadge: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#000000",
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 6,
    alignSelf: "flex-start",
    marginBottom: 4,
  },
  bagBadgeText: {
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

const MarketingTagPage = ({
  data,
  bagPage,
}: {
  data: MarketingTagPDFData;
  bagPage: BagPage;
}) => (
  <Page size={[PAGE_WIDTH, PAGE_HEIGHT]} style={styles.page} wrap={false}>
    <View style={styles.headerRow}>
      <EHILogoPDF width={70} variant="cargo" />
      {data.airline ? <AirlineLogoPDF airline={data.airline} logoUrl={data.airlineLogoUrl} width={70} /> : null}
    </View>
    <View style={styles.divider} />

    <View style={styles.body}>
      <View style={styles.leftCol}>
        <Text style={styles.routeLabel}>Route</Text>
        <Text style={styles.routeValue}>{data.route?.toUpperCase() || "—"}</Text>

        <View style={styles.refBand}>
          <Text style={styles.refLabel}>AWB / Tag</Text>
          <Text style={styles.refValue}>{data.id}</Text>
        </View>

        <View style={styles.bagBadge}>
          <Text style={styles.bagBadgeText}>{bagPage.bagType} · {bagPage.pieceIndex} OF {bagPage.totalForType}</Text>
        </View>

        <View style={styles.fieldRow}>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Bag Type</Text>
            <Text style={styles.fieldValue}>{bagPage.bagTypeFull}</Text>
          </View>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Hub</Text>
            <Text style={styles.fieldValue}>{data.hubName || "—"}</Text>
          </View>
        </View>

        <View style={styles.fieldRow}>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Customer</Text>
            <Text style={styles.fieldValue}>{data.name || "—"}</Text>
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

// One PDF, one page per physical bag -- mirrors the existing Bluetooth
// bag-tag behavior (printMarketingTags) instead of a single combined
// summary tag, so each physical bag gets its own printable label.
const MarketingTagOnlyPDF = ({ data }: { data: MarketingTagPDFData }) => {
  const pages = buildBagPages(data);
  return (
    <Document>
      {pages.map((bagPage, i) => (
        <MarketingTagPage key={i} data={data} bagPage={bagPage} />
      ))}
    </Document>
  );
};

async function buildTagData(data: MarketingTagPDFData): Promise<MarketingTagPDFData> {
  let result = data;
  if (!result.qrCodeDataUrl) {
    const trackingUrl = `https://ehimultisystems.com/track?ref=${encodeURIComponent(result.id)}`;
    try {
      const qrCodeDataUrl = await QRCode.toDataURL(trackingUrl, { margin: 1, width: 240, errorCorrectionLevel: 'L' });
      result = { ...result, qrCodeDataUrl };
    } catch (e) {
      console.warn("Failed to generate QR code for marketing tag PDF", e);
    }
  }
  if (result.airlineLogoUrl === undefined && result.airline) {
    result = { ...result, airlineLogoUrl: await resolveAirlineLogoUrl(result.airline) };
  }
  return result;
}

export const printMarketingTagPDF = async (data: MarketingTagPDFData) => {
  const withQr = await buildTagData(data);
  const blob = await pdf(<MarketingTagOnlyPDF data={withQr} />).toBlob();
  const url = URL.createObjectURL(blob);
  openPdfOrDownload(url, `EHI-Tag-${data.id}.pdf`);
};

export const downloadMarketingTagPDF = async (data: MarketingTagPDFData) => {
  const withQr = await buildTagData(data);
  const blob = await pdf(<MarketingTagOnlyPDF data={withQr} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `EHI-Tag-${data.id}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
