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
      src: "https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf",
      fontWeight: 400,
    },
    {
      src: "https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Medium.ttf",
      fontWeight: 700,
    },
  ],
});

export interface VJReceiptData {
  entryRef: string;
  date: string;
  hubName: string;
  agentName: string;
  passengerName: string;
  flightNumber: string;
  destination: string;
  totalBaggage: number;
  freeAllowance: number;
  excessKg: number;
  ratePerKg: number;
  amount: number;
  paymentMode: string;
  paymentNarration?: string;
  bankName?: string;
  qrCodeDataUrl?: string;
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
    fontSize: 11,
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
  sectionTitle: {
    fontSize: 10,
    color: "#000000",
    fontWeight: "bold",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  qrContainer: { alignItems: "center", marginVertical: 10 },
  qrImage: { width: 90, height: 90 },
});

const VJReceiptPDF = ({ data }: { data: VJReceiptData }) => (
  <Document>
    <Page size="A6" style={styles.page}>
      <View style={styles.headerRow}>
        <EHILogoPDF width={70} />
        <AirlineLogoPDF airline="ValueJet" width={70} />
      </View>
      <Text style={styles.title}>EXCESS BAGGAGE RECEIPT</Text>

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
        <Text style={styles.label}>Total weight:</Text>
        <Text style={styles.value}>{data.totalBaggage} KG</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Free allow.:</Text>
        <Text style={styles.value}>{data.freeAllowance} KG</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Excess chrg:</Text>
        <Text style={styles.value}>{data.excessKg} KG</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Rate per KG:</Text>
        <Text style={styles.value}>
          ₦{data.ratePerKg.toLocaleString("en-NG")}
        </Text>
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

      <View style={styles.footerRow}>
        <Text style={styles.footerText}>Powered by EHI Logistics Platform</Text>
      </View>
    </Page>
  </Document>
);

export const downloadVJReceipt = async (data: VJReceiptData) => {
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
  const blob = await pdf(<VJReceiptPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Receipt_${data.entryRef}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};

export const printVJReceipt = async (data: VJReceiptData): Promise<void> => {
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
  const blob = await pdf(<VJReceiptPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) win.print();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};
