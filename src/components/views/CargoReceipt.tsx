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
  return '₦' + (num || 0).toLocaleString('en-NG', {
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
  title: {
    fontSize: 10,
    color: "#000000",
    textTransform: "uppercase",
    marginBottom: 4,
    alignSelf: "center",
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
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
  qrContainer: { alignItems: "center", marginVertical: 2 },
  qrImage: { width: 55, height: 55 },
  pinContainer: {
    marginTop: 2,
    padding: 4,
    borderWidth: 1,
    borderColor: "#000000",
    alignItems: "center",
  },
  pinLabel: {
    fontSize: 9,
    color: "#000000",
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  pinValue: {
    fontSize: 16,
    fontFamily: "Courier",
    fontWeight: "bold",
    color: "#000000",
    letterSpacing: 2,
    marginVertical: 2,
  },
  pinHelper: { fontSize: 7, color: "#000000", textAlign: "center" },
  tagContainer: { marginTop: 0, paddingTop: 0 },
  tagTitle: {
    fontSize: 12,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginBottom: 4,
  },
  tagRoute: {
    fontSize: 16,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginVertical: 2,
  },
  tagAwb: {
    fontSize: 14,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginVertical: 2,
  },
  tagDetailsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 4,
  },
  tagDetailBox: {
    alignItems: "center",
    padding: 2,
    borderWidth: 1,
    borderColor: "#000",
    flex: 1,
    marginHorizontal: 1,
  },
  tagDetailLabel: { fontSize: 7, textTransform: "uppercase" },
  tagDetailValue: { fontSize: 12, fontWeight: "bold", fontFamily: "Helvetica-Bold" },
});

// Note: The entire receipt must render within 297mm height (A4) or 200mm (thermal)
const CargoReceiptOnlyPDF = ({ data }: { data: CargoReceiptData }) => (
  <Document>
    <Page size={[226, 800]} style={styles.page}>
      {/* Logos Header */}
      <View style={styles.headerRow}>
        <EHILogoPDF width={50} />
        <AirlineLogoPDF airline={data.airline} width={50} />
      </View>
      <Text style={styles.title}>CARGO ENTRY RECEIPT</Text>
      <Text style={{ fontSize: 10, textAlign: 'center', marginBottom: 6 }}>Origin: {data.hubName}</Text>

      {data.qrCodeDataUrl ? (
        <View style={styles.qrContainer}>
          <Image src={data.qrCodeDataUrl} style={styles.qrImage} />
        </View>
      ) : null}

      {data.pickupPin ? (
        <View style={styles.pinContainer}>
          <Text style={styles.pinLabel}>PICKUP PIN</Text>
          <Text style={styles.pinValue}>{data.pickupPin}</Text>
          <Text style={styles.pinHelper}>
            Share this PIN with the consignee.
          </Text>
          <Text style={styles.pinHelper}>
            They must present it to collect cargo.
          </Text>
        </View>
      ) : null}

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.label}>Entry Ref:</Text>
        <Text style={styles.value}>{data.entryRef}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>S/N:</Text>
        <Text style={styles.value}>Entry #{data.serialNumber}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Date:</Text>
        <Text style={styles.value}>{data.date}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.label}>Airline:</Text>
        <Text style={styles.value}>{data.airline}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>AWB/Tag:</Text>
        <Text style={styles.value}>{data.awbTagNumber}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Consignee:</Text>
        <Text style={styles.value}>{data.consignee}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Route:</Text>
        <Text style={styles.value}>{data.route}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Content:</Text>
        <Text style={styles.value}>{data.contentType}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Pieces:</Text>
        <Text style={styles.value}>{data.pieces}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Weight:</Text>
        <Text style={styles.value}>{Math.round(data.kg)} KG</Text>
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
            <Text style={styles.label}>Bank Transfer Narration:</Text>
            <Text style={styles.value}>{data.paymentNarration}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.divider} />

      {data.remark ? (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Remark:</Text>
            <Text style={styles.value}>{data.remark}</Text>
          </View>
          <View style={styles.divider} />
        </>
      ) : null}

      <View style={styles.footerRow}>
        <Text style={styles.footerText}>EHI Multisystems Nigeria Limited</Text>
      </View>
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>Track your cargo: ehimultisystems.com</Text>
      </View>
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>{data.entryRef} • {data.date}</Text>
      </View>
    </Page>
  </Document>
);

const CargoWaybillTagPage = ({
  data,
  pieceIndex,
  totalPieces,
}: {
  data: CargoReceiptData;
  pieceIndex: number;
  totalPieces: number;
}) => {
  // Extract hub code from hub name for origin (first 3 chars or predefined logic)
  const originCode = (data.hubName || "LOS").substring(0, 3).toUpperCase();
  const destName = data.route || "DESTINATION";

  return (
    <Page size="A6" style={styles.page}>
      {/* --- TAG SECTION --- */}
      <View style={styles.tagContainer}>
        <View style={styles.headerRow}>
          <EHILogoPDF width={40} />
          <AirlineLogoPDF airline={data.airline} width={40} />
        </View>

        <Text style={styles.tagTitle}>CARGO ROUTING TAG</Text>
        <Text style={styles.tagRoute}>{originCode} → {destName}</Text>

        {data.qrCodeDataUrl ? (
          <View style={styles.qrContainer}>
            <Image src={data.qrCodeDataUrl} style={styles.qrImage} />
          </View>
        ) : null}

        <Text style={{ fontSize: 8, textAlign: 'center', marginBottom: 2, fontFamily: 'Courier' }}>REF: {data.entryRef}</Text>

        <Text style={styles.tagAwb}>AWB: {data.awbTagNumber}</Text>

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

        <View style={styles.row}>
          <Text style={styles.label}>Consignee:</Text>
          <Text style={styles.value}>{data.consignee}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Date:</Text>
          <Text style={styles.value}>{data.date}</Text>
        </View>

        {data.pickupPin ? (
          <View style={styles.pinContainer}>
            <Text style={styles.pinLabel}>PICKUP PIN: <Text style={styles.pinValue}>{data.pickupPin.split('').join('  ')}</Text></Text>
            <Text style={styles.pinHelper}>Consignee must present PIN</Text>
          </View>
        ) : null}
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
