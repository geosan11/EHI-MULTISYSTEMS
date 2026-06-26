import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
  Font,
  Image,
} from "@react-pdf/renderer";
import QRCode from "qrcode";
import { EHILogoPDF } from "../EHILogoPDF";
import { AirlineLogoPDF } from "../AirlineLogoPDF";

Font.register({
  family: "Roboto",
  fonts: [
    {
      src: "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-regular-webfont.ttf",
      fontWeight: 400,
    },
    {
      src: "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-bold-webfont.ttf",
      fontWeight: 700,
    },
  ],
});

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

const styles = StyleSheet.create({
  page: { padding: 15, fontFamily: "Roboto", backgroundColor: "#FFFFFF" },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  title: {
    fontSize: 12,
    color: "#000000",
    textTransform: "uppercase",
    marginBottom: 15,
    alignSelf: "center",
    fontWeight: "bold",
  },
  divider: {
    marginVertical: 6,
    borderBottomWidth: 1.5,
    borderBottomColor: "#000000",
    borderBottomStyle: "dashed",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  label: {
    fontSize: 9,
    color: "#000000",
    textTransform: "uppercase",
    width: 70,
    fontWeight: "bold",
  },
  value: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#000000",
    flex: 1,
    textAlign: "right",
  },
  amountContainer: {
    marginTop: 10,
    padding: 8,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: "#000000",
  },
  amountLabel: {
    fontSize: 12,
    color: "#000000",
    textTransform: "uppercase",
    fontWeight: "bold",
  },
  amountValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#000000",
    textAlign: "right",
  },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: 10 },
  footerText: {
    fontSize: 8,
    color: "#000000",
    textAlign: "center",
    marginTop: 10,
  },
  qrContainer: { alignItems: "center", marginVertical: 10 },
  qrImage: { width: 90, height: 90 },
  pinContainer: {
    marginTop: 8,
    padding: 8,
    borderWidth: 2,
    borderColor: "#000000",
    alignItems: "center",
  },
  pinLabel: {
    fontSize: 11,
    color: "#000000",
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  pinValue: {
    fontSize: 26,
    fontFamily: "Courier",
    fontWeight: "bold",
    color: "#000000",
    letterSpacing: 5,
    marginVertical: 4,
  },
  pinHelper: { fontSize: 8, color: "#000000", textAlign: "center" },
  tagContainer: { marginTop: 0, paddingTop: 0 },
  tagTitle: {
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
  },
  tagRoute: {
    fontSize: 36,
    fontWeight: "bold",
    textAlign: "center",
    marginVertical: 10,
  },
  tagAwb: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginVertical: 10,
  },
  tagDetailsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 10,
  },
  tagDetailBox: {
    alignItems: "center",
    padding: 5,
    borderWidth: 1,
    borderColor: "#000",
    flex: 1,
    marginHorizontal: 2,
  },
  tagDetailLabel: { fontSize: 8, textTransform: "uppercase" },
  tagDetailValue: { fontSize: 14, fontWeight: "bold" },
});

const CargoReceiptOnlyPDF = ({ data }: { data: CargoReceiptData }) => (
  <Document>
    <Page size={[226, 700]} style={styles.page}>
      {/* Logos Header */}
      <View style={styles.headerRow}>
        <EHILogoPDF width={50} />
        <AirlineLogoPDF airline={data.airline} width={50} />
      </View>
      <Text style={styles.title}>CARGO ENTRY RECEIPT</Text>

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
      <View style={styles.row}>
        <Text style={styles.label}>Origin State:</Text>
        <Text style={styles.value}>{data.hubName}</Text>
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
        <Text style={styles.value}>{data.kg} KG</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.amountContainer}>
        <View style={styles.row}>
          <Text style={styles.amountLabel}>AMOUNT:</Text>
          <Text style={styles.amountValue}>
            ₦ {data.amount.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
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
        <Text style={styles.footerText}>Logged by: {data.agentName}</Text>
      </View>
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>Powered by EHI Logistics Platform</Text>
      </View>
    </Page>
  </Document>
);

const CargoWaybillOnlyPDF = ({ data }: { data: CargoReceiptData }) => (
  <Document>
    <Page size="A6" style={styles.page}>
      {/* --- TAG SECTION --- */}
      <View style={styles.tagContainer}>
        <Text style={styles.tagTitle}>CARGO ROUTING TAG</Text>

        <View style={styles.headerRow}>
          <EHILogoPDF width={40} />
          <AirlineLogoPDF airline={data.airline} width={40} />
        </View>

        <Text style={styles.tagRoute}>{data.route || "ROUTING"}</Text>
        <Text style={styles.tagAwb}>{data.awbTagNumber}</Text>

        <View style={styles.tagDetailsRow}>
          <View style={styles.tagDetailBox}>
            <Text style={styles.tagDetailLabel}>PIECES</Text>
            <Text style={styles.tagDetailValue}>{data.pieces}</Text>
          </View>
          <View style={styles.tagDetailBox}>
            <Text style={styles.tagDetailLabel}>WEIGHT (KG)</Text>
            <Text style={styles.tagDetailValue}>{data.kg}</Text>
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
        <View style={styles.row}>
          <Text style={styles.label}>Ref:</Text>
          <Text style={styles.value}>{data.entryRef}</Text>
        </View>

        {data.qrCodeDataUrl ? (
          <View style={styles.qrContainer}>
            <Image src={data.qrCodeDataUrl} style={{ width: 60, height: 60 }} />
          </View>
        ) : null}
      </View>
    </Page>
  </Document>
);

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
