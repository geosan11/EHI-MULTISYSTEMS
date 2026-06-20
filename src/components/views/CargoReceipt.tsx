import { Document, Page, Text, View, StyleSheet, pdf, Font } from '@react-pdf/renderer';
import { Transaction } from '../../lib/types';
import { fmt } from '../../lib/helpers';

// Provide standard fonts
Font.register({
  family: 'Courier',
  src: 'https://fonts.gstatic.com/s/courierprime/v2/u-450q2lgwslOquVD4MwZwe8w_y2-Q.ttf',
});

const styles = StyleSheet.create({
  page: { padding: 30, fontFamily: 'Helvetica' },
  header: { marginBottom: 20, textAlign: 'center' },
  companyName: { fontSize: 16, fontWeight: 'bold', color: '#F59E0B', marginBottom: 4 },
  title: { fontSize: 14, fontWeight: 'bold', marginBottom: 10, alignSelf: 'center' },
  divider: { marginVertical: 10, borderBottomWidth: 1, borderBottomColor: '#d1d5db', borderBottomStyle: 'solid' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: 10, color: '#4b5563', width: 90 },
  value: { fontSize: 10, fontWeight: 'bold', color: '#111827', flex: 1 },
  amountContainer: { marginTop: 10, padding: 10, backgroundColor: '#FEF3C7', borderRadius: 4 },
  amountLabel: { fontSize: 12, color: '#92400E' },
  amountValue: { fontSize: 16, fontWeight: 'bold', color: '#B45309' },
});

const CargoReceiptPDF = ({ tx, serialNumber }: { tx: Transaction; serialNumber: number }) => (
  <Document>
    <Page size="A6" style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.companyName}>EHI MULTISYSTEMS NIGERIA LIMITED</Text>
        <Text style={styles.title}>CARGO ENTRY RECEIPT</Text>
      </View>

      <View style={styles.divider} />
      
      <View style={styles.row}>
        <Text style={styles.label}>Entry Ref:</Text>
        <Text style={styles.value}>{tx.id}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>S/N:</Text>
        <Text style={styles.value}>Entry #{serialNumber - 1}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Date:</Text>
        <Text style={styles.value}>{new Date().toLocaleDateString('en-GB')}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Airline:</Text>
        <Text style={styles.value}>{tx.detail.split('·')[0].trim() || 'Airline Default'}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.label}>Consignee:</Text>
        <Text style={styles.value}>{tx.name}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>AWB/Tag No:</Text>
        <Text style={styles.value}>{tx.awb_tag_number}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Pieces:</Text>
        <Text style={styles.value}>{tx.pieces}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Weight:</Text>
        <Text style={styles.value}>{tx.kg} KG</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Route:</Text>
        <Text style={styles.value}>{tx.detail.split('·')[3]?.trim()}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Content:</Text>
        <Text style={styles.value}>{tx.detail.split('·')[4]?.trim()}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.amountContainer}>
        <View style={styles.row}>
          <Text style={styles.amountLabel}>Amount:</Text>
          <Text style={styles.amountValue}>{fmt(tx.amount)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Payment:</Text>
          <Text style={styles.value}>{tx.mode} {tx.bank ? `(${tx.bank})` : ''}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {(tx.remarks) && (
        <View style={styles.row}>
          <Text style={styles.label}>Remark:</Text>
          <Text style={styles.value}>{tx.remarks}</Text>
        </View>
      )}

      <View style={styles.divider} />
      
      <View style={styles.row}>
        <Text style={{ fontSize: 9, color: '#6b7280', textAlign: 'center', width: '100%' }}>
          Logged by EHI Admin | Hub
        </Text>
      </View>
    </Page>
  </Document>
);

export const downloadCargoReceipt = async (tx: Transaction, serialNumber: number) => {
  const blob = await pdf(<CargoReceiptPDF tx={tx} serialNumber={serialNumber} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Receipt_${tx.id}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
