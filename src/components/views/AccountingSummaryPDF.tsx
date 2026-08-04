import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { EHILogoPDF } from '../EHILogoPDF';

export interface AccountingSummaryPDFData {
  hubName: string;
  generatedBy: string;
  generatedAt: string;
  periodLabel: string;
  streams: Array<{ name: string; amount: number; count: number }>;
  grandRevenue: number;
  totalExpenses: number;
  pendingExpTotal: number;
  netRevenue: number;
  modes: { cash: number; transfer: number; pos: number; debt: number; wallet: number };
  collectionEff: number;
  vatEstimate: number;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica' },
  header: { marginBottom: 20 },
  title: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase', marginBottom: 20 },
  summaryBox: {
    marginTop: 15,
    padding: 15,
    backgroundColor: '#f9fafb',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sectionTitle: { fontSize: 10, fontWeight: 'bold', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: 9, color: '#4b5563' },
  value: { fontSize: 9, fontWeight: 'bold' },
  netBox: {
    marginTop: 15,
    padding: 15,
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  netText: { fontSize: 14, fontWeight: 'bold', color: '#92400E' },
  footer: { fontSize: 8, color: '#9ca3af', textAlign: 'center', marginTop: 30 },
});

const AccountingSummaryPDFDoc = ({ data }: { data: AccountingSummaryPDFData }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <View style={{ alignItems: 'center', marginBottom: 15 }}>
          <EHILogoPDF width={120} />
        </View>
        <Text style={styles.title}>CENTRAL ACCOUNTING — PERIOD SUMMARY</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 10 }}>Period: {data.periodLabel}</Text>
          <Text style={{ fontSize: 10 }}>Hub: {data.hubName}</Text>
        </View>
        <Text style={{ fontSize: 10, marginTop: 5 }}>Generated: {data.generatedAt} by {data.generatedBy}</Text>
      </View>

      <View style={styles.summaryBox}>
        <Text style={styles.sectionTitle}>REVENUE BY STREAM</Text>
        {data.streams.map((s, i) => (
          <View style={styles.row} key={i}>
            <Text style={styles.label}>{s.name} ({s.count})</Text>
            <Text style={styles.value}>NGN {s.amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
          </View>
        ))}
        <View style={[styles.row, { marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#e5e7eb' }]}>
          <Text style={[styles.label, { fontWeight: 'bold' }]}>GROSS REVENUE</Text>
          <Text style={styles.value}>NGN {data.grandRevenue.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
        </View>
      </View>

      <View style={styles.summaryBox}>
        <Text style={styles.sectionTitle}>EXPENSES</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Approved Expenses</Text>
          <Text style={styles.value}>NGN {data.totalExpenses.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
        </View>
        {data.pendingExpTotal > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>Pending Approval (not included above)</Text>
            <Text style={styles.value}>NGN {data.pendingExpTotal.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
          </View>
        )}
        <View style={[styles.row, { marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#e5e7eb' }]}>
          <Text style={[styles.label, { fontWeight: 'bold' }]}>NET REVENUE</Text>
          <Text style={styles.value}>NGN {data.netRevenue.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
        </View>
      </View>

      <View style={styles.summaryBox}>
        <Text style={styles.sectionTitle}>PAYMENT MODE BREAKDOWN</Text>
        <View style={styles.row}><Text style={styles.label}>Cash</Text><Text style={styles.value}>NGN {data.modes.cash.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Bank Transfer</Text><Text style={styles.value}>NGN {data.modes.transfer.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
        <View style={styles.row}><Text style={styles.label}>POS</Text><Text style={styles.value}>NGN {data.modes.pos.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Debt / Credit</Text><Text style={styles.value}>NGN {data.modes.debt.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Customer Wallet</Text><Text style={styles.value}>NGN {data.modes.wallet.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
        <View style={[styles.row, { marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#e5e7eb' }]}>
          <Text style={[styles.label, { fontWeight: 'bold' }]}>Collection Efficiency</Text>
          <Text style={styles.value}>{data.collectionEff.toFixed(0)}%</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Estimated Output VAT (7.5% of gross revenue)</Text>
          <Text style={styles.value}>NGN {data.vatEstimate.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
        </View>
      </View>

      <View style={styles.netBox}>
        <Text style={styles.netText}>NET REVENUE: NGN {data.netRevenue.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
      </View>

      <Text style={styles.footer}>Generated by EHI Logistics Platform</Text>
    </Page>
  </Document>
);

export const downloadAccountingSummaryPDF = async (data: AccountingSummaryPDFData) => {
  const blob = await pdf(<AccountingSummaryPDFDoc data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AccountingSummary_${new Date().toISOString().split('T')[0]}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
