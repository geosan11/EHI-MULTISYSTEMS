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

const VJReceiptPDF = ({ data }: { data: VJReceiptData }) => {
  let h = 190;
  if (data.qrCodeDataUrl) h += 60;
  if (data.bankName) h += 15;
  if (data.paymentMode === "Transfer" && data.paymentNarration) h += 15;

  return (
  <Document>
    <Page size={[226, h]} style={styles.page}>
      <View style={styles.headerRow}>
        <EHILogoPDF width={50} />
        <AirlineLogoPDF airline="ValueJet" width={50} />
      </View>
      <Text style={styles.title}>EXCESS BAGGAGE RECEIPT</Text>
      <Text style={{ fontSize: 10, textAlign: 'center', marginBottom: 6 }}>Origin: {data.hubName}</Text>

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
            <Text style={styles.label}>Bank Transfer Narration:</Text>
            <Text style={styles.value}>{data.paymentNarration}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.divider} />

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
};

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
