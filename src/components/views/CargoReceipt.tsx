import { Document, Page, Text, View, StyleSheet, pdf, Font, Image } from '@react-pdf/renderer';
import QRCode from 'qrcode';

Font.register({
  family: 'Courier',
  src: 'https://fonts.gstatic.com/s/courierprime/v2/u-450q2lgwslOquVD4MwZwe8w_y2-Q.ttf',
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
  page: { padding: 20, fontFamily: 'Helvetica' },
  header: { marginBottom: 15, textAlign: 'center' },
  companyName: { fontSize: 14, fontWeight: 'bold', color: '#F59E0B', marginBottom: 4 },
  title: { fontSize: 8, color: '#6b7280', textTransform: 'uppercase', marginBottom: 10, alignSelf: 'center' },
  divider: { marginVertical: 8, borderBottomWidth: 1, borderBottomColor: '#d1d5db', borderBottomStyle: 'solid' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: 8, color: '#6b7280', textTransform: 'uppercase', width: 60 },
  value: { fontSize: 10, fontWeight: 'bold', color: '#111827', flex: 1 },
  amountContainer: { marginTop: 8, padding: 8, backgroundColor: '#FEF3C7', borderRadius: 4, borderWidth: 1, borderColor: '#F59E0B' },
  amountLabel: { fontSize: 10, color: '#6b7280', textTransform: 'uppercase', width: 60 },
  amountValue: { fontSize: 18, fontWeight: 'bold', color: '#B45309' },
  footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
  footerText: { fontSize: 8, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center' },
  qrContainer: { alignItems: 'center', marginVertical: 10 },
  qrImage: { width: 80, height: 80 },
  pinContainer: { marginTop: 8, padding: 8, backgroundColor: '#FFFBEB', borderRadius: 4, borderWidth: 1, borderColor: '#F59E0B', alignItems: 'center' },
  pinLabel: { fontSize: 10, color: '#D97706', fontWeight: 'bold', textTransform: 'uppercase' },
  pinValue: { fontSize: 24, fontFamily: 'Courier', fontWeight: 'bold', color: '#111827', letterSpacing: 5, marginVertical: 4 },
  pinHelper: { fontSize: 7, color: '#6B7280', textAlign: 'center' }
});

const CargoReceiptPDF = ({ data }: { data: CargoReceiptData }) => (
  <Document>
    <Page size="A6" style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.companyName}>EHI MULTISYSTEMS NIGERIA LIMITED</Text>
        <Text style={styles.title}>CARGO ENTRY RECEIPT</Text>
      </View>

      {data.qrCodeDataUrl && (
        <View style={styles.qrContainer}>
          <Image src={data.qrCodeDataUrl} style={styles.qrImage} />
        </View>
      )}

      {data.pickupPin && (
        <View style={styles.pinContainer}>
          <Text style={styles.pinLabel}>PICKUP PIN</Text>
          <Text style={styles.pinValue}>{data.pickupPin}</Text>
          <Text style={styles.pinHelper}>Share this PIN with the consignee.</Text>
          <Text style={styles.pinHelper}>They must present it to collect cargo.</Text>
        </View>
      )}

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
        <Text style={styles.label}>Hub:</Text>
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
          <Text style={styles.amountValue}>₦{data.amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Payment:</Text>
          <Text style={styles.value}>{data.paymentMode}</Text>
        </View>
        {data.bankName && (
          <View style={styles.row}>
            <Text style={styles.label}>Bank:</Text>
            <Text style={styles.value}>{data.bankName}</Text>
          </View>
        )}
        {data.paymentMode === 'Transfer' && data.paymentNarration && (
          <View style={styles.row}>
            <Text style={styles.label}>Bank Transfer Narration:</Text>
            <Text style={styles.value}>{data.paymentNarration}</Text>
          </View>
        )}
      </View>

      <View style={styles.divider} />

      {data.remark && (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Remark:</Text>
            <Text style={styles.value}>{data.remark}</Text>
          </View>
          <View style={styles.divider} />
        </>
      )}
      
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>Logged by: {data.agentName}</Text>
      </View>
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>Powered by EHI Logistics Platform</Text>
      </View>
    </Page>
  </Document>
);

export const downloadCargoReceipt = async (data: CargoReceiptData) => {
  if (!data.qrCodeDataUrl) {
    try {
      data.qrCodeDataUrl = await QRCode.toDataURL(data.entryRef, { margin: 1, width: 200 });
    } catch (e) {
      console.warn("Failed to generate QR code", e);
    }
  }
  const blob = await pdf(<CargoReceiptPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Receipt_${data.entryRef}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};

export const printCargoReceipt = async (data: CargoReceiptData) => {
  if (!data.qrCodeDataUrl) {
    try {
      data.qrCodeDataUrl = await QRCode.toDataURL(data.entryRef, { margin: 1, width: 200 });
    } catch (e) {
      console.warn("Failed to generate QR code", e);
    }
  }
  const blob = await pdf(<CargoReceiptPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Optional: setTimeout(() => URL.revokeObjectURL(url), 10000); // Clean up
};
