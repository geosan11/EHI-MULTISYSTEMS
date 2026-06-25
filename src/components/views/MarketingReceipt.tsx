import { Document, Page, Text, View, StyleSheet, pdf, Font } from '@react-pdf/renderer';
import { EHILogoPDF } from '../EHILogoPDF';

Font.register({
  family: 'Courier',
  src: 'https://fonts.gstatic.com/s/courierprime/v2/u-450q2lgwslOquVD4MwZwe8w_y2-Q.ttf',
});

export interface MarketingReceiptData {
  entryRef: string;
  date: string;
  agentName: string;
  customerName: string;
  phone?: string;
  route: string;
  bigBags: number;
  medBags: number;
  smallBags: number;
  amount: number;
  paymentMode: string;
  paymentNarration?: string;
  bankName?: string;
}

export interface MarketingDailySummaryData {
  date: string;
  agentName: string;
  hubName: string;
  entries: Array<{
    customerName: string;
    route: string;
    bags: string;         // e.g. "2BB 1MB"
    amount: number;
    paymentMode: string;
    bank?: string;
  }>;
  totalSales: number;
  cashSales: number;
  transferSales: number;
  expenses: Array<{ type: string; amount: number; description: string }>;
  totalExpenses: number;
  balanceToRemit: number;
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
  amountContainer: { marginTop: 8, padding: 8, backgroundColor: '#D1FAE5', borderRadius: 4, borderWidth: 1, borderColor: '#10B981' },
  amountLabel: { fontSize: 10, color: '#6b7280', textTransform: 'uppercase', width: 60 },
  amountValue: { fontSize: 18, fontWeight: 'bold', color: '#065F46' },
  footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
  footerText: { fontSize: 8, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center' },
  sectionTitle: { fontSize: 8, color: '#111827', fontWeight: 'bold', marginBottom: 4 }
});

const MarketingReceiptPDF = ({ data }: { data: MarketingReceiptData }) => (
  <Document>
    <Page size="A6" style={styles.page}>
      <View style={styles.header}>
        <View style={{ alignItems: 'center', marginBottom: 10 }}>
          <EHILogoPDF width={100} />
        </View>
        <Text style={styles.title}>FIELD MARKETING RECEIPT</Text>
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
        <Text style={styles.label}>CUSTOMER:</Text>
        <Text style={styles.value}>{data.customerName}</Text>
      </View>
      {data.phone && (
        <View style={styles.row}>
          <Text style={styles.label}>Phone:</Text>
          <Text style={styles.value}>{data.phone}</Text>
        </View>
      )}
      <View style={styles.row}>
        <Text style={styles.label}>Route:</Text>
        <Text style={styles.value}>{data.route}</Text>
      </View>

      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>BAG BREAKDOWN</Text>
      
      <View style={styles.row}>
        <Text style={styles.label}>BB (Big):</Text>
        <Text style={styles.value}>{data.bigBags}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>MB (Med):</Text>
        <Text style={styles.value}>{data.medBags}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>SB (Small):</Text>
        <Text style={styles.value}>{data.smallBags}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.amountContainer}>
        <View style={styles.row}>
          <Text style={styles.amountLabel}>TOTAL:</Text>
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

      <View style={styles.footerRow}>
        <Text style={styles.footerText}>Powered by EHI Logistics Platform</Text>
      </View>
    </Page>
  </Document>
);

export const downloadMarketingReceipt = async (data: MarketingReceiptData) => {
  const blob = await pdf(<MarketingReceiptPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Receipt_${data.entryRef}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};

const summaryStyles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica' },
  header: { marginBottom: 20 },
  companyName: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  title: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase', marginBottom: 20 },
  tableTitle: { fontSize: 10, fontWeight: 'bold', marginTop: 15, marginBottom: 5 },
  table: { display: 'flex', width: 'auto', borderStyle: 'solid', borderWidth: 1, borderRightWidth: 0, borderBottomWidth: 0, borderColor: '#e5e7eb' },
  tableRow: { flexDirection: 'row' },
  tableColHeader: { width: '16.6%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableColHeaderSmall: { width: '8%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableColHeaderLarge: { width: '25%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableCol: { width: '16.6%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableColSmall: { width: '8%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableColLarge: { width: '25%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableCellHeader: { fontSize: 8, fontWeight: 'bold' },
  tableCell: { fontSize: 8 },
  summaryBox: { marginTop: 20, padding: 15, backgroundColor: '#f9fafb', borderRadius: 4, borderWidth: 1, borderColor: '#e5e7eb' },
  balanceBox: { marginTop: 15, padding: 15, backgroundColor: '#D1FAE5', borderRadius: 6, borderWidth: 1, borderColor: '#10B981' },
  balanceText: { fontSize: 14, fontWeight: 'bold', color: '#065F46' },
  signatures: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 50 },
  signatureLine: { borderTopWidth: 1, borderTopColor: '#000', paddingTop: 5, width: 200, fontSize: 10 }
});

const MarketingDailySummaryPDF = ({ data }: { data: MarketingDailySummaryData }) => (
  <Document>
    <Page size="A4" style={summaryStyles.page}>
      <View style={summaryStyles.header}>
        <View style={{ alignItems: 'center', marginBottom: 15 }}>
          <EHILogoPDF width={120} />
        </View>
        <Text style={summaryStyles.title}>FIELD MARKETING DAILY SUMMARY</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
          <Text style={{ fontSize: 10 }}>Date: {data.date}</Text>
          <Text style={{ fontSize: 10 }}>Agent: {data.agentName}</Text>
        </View>
        <Text style={{ fontSize: 10, marginTop: 5 }}>Hub: {data.hubName}</Text>
      </View>

      <Text style={summaryStyles.tableTitle}>ENTRIES</Text>
      <View style={summaryStyles.table}>
        <View style={summaryStyles.tableRow}>
          <View style={summaryStyles.tableColSmall}><Text style={summaryStyles.tableCellHeader}>#</Text></View>
          <View style={summaryStyles.tableColLarge}><Text style={summaryStyles.tableCellHeader}>Customer</Text></View>
          <View style={summaryStyles.tableColLarge}><Text style={summaryStyles.tableCellHeader}>Route</Text></View>
          <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCellHeader}>Bags</Text></View>
          <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCellHeader}>Amount (₦)</Text></View>
          <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCellHeader}>Mode</Text></View>
        </View>
        {data.entries.map((entry, i) => (
          <View style={summaryStyles.tableRow} key={i}>
            <View style={summaryStyles.tableColSmall}><Text style={summaryStyles.tableCell}>{i + 1}</Text></View>
            <View style={summaryStyles.tableColLarge}><Text style={summaryStyles.tableCell}>{entry.customerName}</Text></View>
            <View style={summaryStyles.tableColLarge}><Text style={summaryStyles.tableCell}>{entry.route}</Text></View>
            <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCell}>{entry.bags}</Text></View>
            <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCell}>{entry.amount.toLocaleString('en-NG')}</Text></View>
            <View style={summaryStyles.tableCol}><Text style={summaryStyles.tableCell}>{entry.paymentMode}</Text></View>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View style={{ width: '48%' }}>
          <View style={summaryStyles.summaryBox}>
            <Text style={{ fontSize: 10, fontWeight: 'bold', marginBottom: 5 }}>REVENUE</Text>
            <Text style={{ fontSize: 9, marginBottom: 3 }}>Total Sales: ₦{data.totalSales.toLocaleString('en-NG')}</Text>
            <Text style={{ fontSize: 9, marginBottom: 3 }}>Cash Sales: ₦{data.cashSales.toLocaleString('en-NG')}</Text>
            <Text style={{ fontSize: 9 }}>Transfer/POS: ₦{data.transferSales.toLocaleString('en-NG')}</Text>
          </View>
        </View>

        <View style={{ width: '48%' }}>
          <View style={summaryStyles.summaryBox}>
            <Text style={{ fontSize: 10, fontWeight: 'bold', marginBottom: 5 }}>EXPENSES ({data.expenses.length})</Text>
            {data.expenses.map((exp, i) => (
              <Text key={i} style={{ fontSize: 9, marginBottom: 3 }}>
                {exp.type} - {exp.description}: ₦{exp.amount.toLocaleString('en-NG')}
              </Text>
            ))}
            <Text style={{ fontSize: 9, fontWeight: 'bold', marginTop: 3 }}>
              Total Expenses: ₦{data.totalExpenses.toLocaleString('en-NG')}
            </Text>
          </View>
        </View>
      </View>

      <View style={summaryStyles.balanceBox}>
        <Text style={summaryStyles.balanceText}>BALANCE TO REMIT: ₦{data.balanceToRemit.toLocaleString('en-NG')}</Text>
        <Text style={{ fontSize: 8, color: '#065F46', marginTop: 2 }}>(Cash Sales minus Total Expenses)</Text>
      </View>

      <View style={summaryStyles.signatures}>
        <Text style={summaryStyles.signatureLine}>Agent Signature: __________________</Text>
        <Text style={summaryStyles.signatureLine}>Supervisor Signature: _______________</Text>
      </View>

      <Text style={{ fontSize: 8, color: '#9ca3af', textAlign: 'center', marginTop: 30 }}>
        Generated by EHI Logistics Platform
      </Text>
    </Page>
  </Document>
);

export const downloadMarketingDailySummary = async (data: MarketingDailySummaryData) => {
  const blob = await pdf(<MarketingDailySummaryPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MarketingDailySummary_${data.date.replace(/[/ ]/g, '_')}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
