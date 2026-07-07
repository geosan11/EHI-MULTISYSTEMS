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
import { getHubCode, getCityName } from "../../lib/helpers";

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
  page: { padding: 6, fontFamily: "Helvetica", backgroundColor: "#FFFFFF" },
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
  tagContainer: { marginTop: 0, paddingTop: 0 },
  tagBar: {
    backgroundColor: "#000000",
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  tagBarText: {
    fontSize: 9,
    color: "#FFFFFF",
    textAlign: "center",
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  tagRoute: {
    fontSize: 20,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginVertical: 6,
  },
  tagAwb: {
    fontSize: 11,
    fontWeight: "bold",
    fontFamily: "Courier-Bold",
    textAlign: "center",
    borderWidth: 1,
    borderColor: "#000000",
    padding: 4,
    marginVertical: 4,
  },
  tagRef: {
    fontSize: 7,
    fontFamily: "Courier",
    textAlign: "center",
    color: "#666666",
  },
  tagDetailsRow: {
    flexDirection: "row",
    marginVertical: 4,
  },
  tagDetailBox: {
    alignItems: "center",
    padding: 4,
    borderWidth: 2,
    borderColor: "#000000",
    flex: 1,
    margin: 2,
  },
  tagDetailLabel: {
    fontSize: 7,
    textTransform: "uppercase",
    color: "#777777",
  },
  tagDetailValue: {
    fontSize: 18,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
  },
  tagInfoRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  tagInfoLabel: {
    fontSize: 8,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    width: 55,
  },
  tagInfoValue: {
    fontSize: 8,
    fontFamily: "Helvetica",
    flex: 1,
  },
  tagBottomBar: {
    backgroundColor: "#000000",
    paddingVertical: 4,
    marginTop: 6,
  },
  tagBottomBarText: {
    fontSize: 7,
    color: "#FFFFFF",
    textAlign: "center",
    fontFamily: "Helvetica",
  },
});

const CargoReceiptOnlyPDF = ({ data }: { data: CargoReceiptData }) => {
  // +45 to accommodate the larger header logos (now sized to fill each
  // half of the page width instead of a small centered logo).
  let h = 355;
  if (data.qrCodeDataUrl) h += 70;
  if (data.pickupPin) h += 70;
  if (data.bankName) h += 20;
  if (data.paymentMode === "Transfer" && data.paymentNarration) h += 25;
  if (data.remark) h += 35;

  return (
  <Document>
    <Page size={[226, h]} style={styles.page}>
      <View style={[styles.headerRow, styles.headerBorder]}>
        <EHILogoPDF width={105} />
        <AirlineLogoPDF airline={data.airline} width={105} />
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

      <Text style={styles.footerText}>ehimultisystems.com</Text>
      <Text style={styles.footerText}>{data.entryRef} • {data.date}</Text>
    </Page>
  </Document>
  );
};

const CargoWaybillTagPage = ({
  data,
  pieceIndex,
  totalPieces,
}: {
  data: CargoReceiptData;
  pieceIndex: number;
  totalPieces: number;
}) => {
  const originCode = getHubCode(data.hubName);
  const destName = getCityName(data.route);

  // +45 to accommodate the larger header logos (see note above).
  let h = 275;
  if (data.qrCodeDataUrl) h += 80;

  return (
    <Page size={[226, h]} style={styles.page}>
      <View style={styles.tagContainer}>
        <View style={styles.headerRow}>
          <EHILogoPDF width={105} />
          <AirlineLogoPDF airline={data.airline} width={105} />
        </View>

        <View style={styles.tagBar}>
          <Text style={styles.tagBarText}>CARGO ROUTING TAG</Text>
        </View>

        <Text style={styles.tagRoute}>{originCode} → {destName}</Text>

        <Text style={styles.tagAwb}>{data.awbTagNumber}</Text>

        {data.qrCodeDataUrl ? (
          <View style={styles.qrContainer}>
            <Image src={data.qrCodeDataUrl} style={{ width: 70, height: 70 }} />
          </View>
        ) : null}

        <Text style={styles.tagRef}>REF: {data.entryRef}</Text>

        <View style={styles.tagDetailsRow}>
          <View style={styles.tagDetailBox}>
            <Text style={styles.tagDetailLabel}>PIECE</Text>
            <Text style={styles.tagDetailValue}>{pieceIndex}/{totalPieces}</Text>
          </View>
          <View style={styles.tagDetailBox}>
            <Text style={styles.tagDetailLabel}>WEIGHT (KG)</Text>
            <Text style={styles.tagDetailValue}>{Math.round(data.kg)}</Text>
          </View>
        </View>

        <View style={styles.tagInfoRow}>
          <Text style={styles.tagInfoLabel}>Consignee:</Text>
          <Text style={styles.tagInfoValue}>{data.consignee}</Text>
        </View>
        <View style={styles.tagInfoRow}>
          <Text style={styles.tagInfoLabel}>Date:</Text>
          <Text style={styles.tagInfoValue}>{data.date}</Text>
        </View>

        <View style={styles.tagBottomBar}>
          <Text style={styles.tagBottomBarText}>EHI MULTISYSTEMS NIGERIA LIMITED</Text>
        </View>
      </View>
    </Page>
  );
};

const CargoWaybillOnlyPDF = ({ data }: { data: CargoReceiptData }) => {
  const totalPieces = Math.max(1, Number(data.pieces) || 1);
  return (
    <Document>
      {Array.from({ length: totalPieces }, (_, i) => (
        <CargoWaybillTagPage key={i} data={data} pieceIndex={i + 1} totalPieces={totalPieces} />
      ))}
    </Document>
  );
};

export const printCargoReceipt = async (data: CargoReceiptData) => {
  if (!data.qrCodeDataUrl) {
    try {
      data.qrCodeDataUrl = await QRCode.toDataURL(data.entryRef, {
        margin: 1,
        width: 200,
      });
    } catch (e) {
      console.warn("Failed to generate QR code", e);
    }
  }
  const blob = await pdf(<CargoReceiptOnlyPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url);
  if (printWindow) {
    printWindow.onload = () => {};
  }
};

export const downloadCargoReceipt = async (data: CargoReceiptData) => {
  if (!data.qrCodeDataUrl) {
    try {
      data.qrCodeDataUrl = await QRCode.toDataURL(data.entryRef, {
        margin: 1,
        width: 200,
      });
    } catch (e) {
      console.warn("Failed to generate QR code", e);
    }
  }
  const blob = await pdf(<CargoReceiptOnlyPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Receipt_${data.entryRef}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};

export const downloadCargoWaybill = async (data: CargoReceiptData) => {
  if (!data.qrCodeDataUrl) {
    try {
      data.qrCodeDataUrl = await QRCode.toDataURL(data.entryRef, {
        margin: 1,
        width: 200,
      });
    } catch (e) {
      console.warn("Failed to generate QR code", e);
    }
  }
  const blob = await pdf(<CargoWaybillOnlyPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Waybill_${data.entryRef}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
