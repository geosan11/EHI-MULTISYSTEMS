import { Document, Page, Text, View, StyleSheet, pdf, Font } from '@react-pdf/renderer';

Font.register({
  family: 'Courier',
  src: 'https://fonts.gstatic.com/s/courierprime/v2/u-450q2lgwslOquVD4MwZwe8w_y2-Q.ttf',
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
  bankName?: string;
}

const styles = StyleSheet.create({
  page: { padding: 20, fontFamily: 'Helvetica' },
  header: { marginBottom: 15, textAlign: 'center' },
  companyName: { fontSize: 14, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  title: { fontSize: 8, color: '#6b7280', textTransform: 'uppercase', marginBottom: 10, alignSelf: 'center' },
  divider: { marginVertical: 8, borderBottomWidth: 1, borderBottomColor: '#d1d5db', borderBottomStyle: 'solid' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: 8, color: '#6b7280', textTransform: 'uppercase', width: 60 },
  value: { fontSize: 10, fontWeight: 'bold', color: '#111827', flex: 1 },
  amountContainer: { marginTop: 8, padding: 8, backgroundColor: '#DBEAFE', borderRadius: 4, borderWidth: 1, borderColor: '#3B82F6' },
  amountLabel: { fontSize: 10, color: '#6b7280', textTransform: 'uppercase', width: 60 },
  amountValue: { fontSize: 18, fontWeight: 'bold', color: '#1D4ED8' },
  footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
  footerText: { fontSize: 8, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center' },
  sectionTitle: { fontSize: 8, color: '#111827', fontWeight: 'bold', marginBottom: 4 }
});

const VJReceiptPDF = ({ data }: { data: VJReceiptData }) => (
  <Document>
    <Page size="A6" style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.companyName}>EHI MULTISYSTEMS NIGERIA LIMITED</Text>
        <Text style={styles.title}>VALUEJET EXCESS BAGGAGE RECEIPT</Text>
      </View>

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
        <Text style={styles.value}>₦{data.ratePerKg.toLocaleString('en-NG')}</Text>
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
      </View>

      <View style={styles.divider} />

      <View style={styles.footerRow}>
        <Text style={styles.footerText}>Powered by EHI Logistics Platform</Text>
      </View>
    </Page>
  </Document>
);

export const downloadVJReceipt = async (data: VJReceiptData) => {
  const blob = await pdf(<VJReceiptPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Receipt_${data.entryRef}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
