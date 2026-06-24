import { Document, Page, Text, View, StyleSheet, pdf, Font } from '@react-pdf/renderer';
import { Transaction, Expense } from '../../lib/types';

Font.register({
  family: 'Courier',
  src: 'https://fonts.gstatic.com/s/courierprime/v2/u-450q2lgwslOquVD4MwZwe8w_y2-Q.ttf',
});

export interface EODReportData {
  date: string;
  hubName: string;
  lockedBy: string;
  lockedAt: string;
  cargoTotal: number;
  mktgTotal: number;
  vjTotal: number;
  grossTotal: number;
  cashTotal: number;
  transferTotal: number;
  posTotal: number; // added
  debtTotal: number;
  totalExpenses: number;
  netCashToRemit: number; // this is expected net cash
  countedCash?: number;
  countedTransfer?: number;
  countedPOS?: number;
  varianceReason?: string;
  managerName?: string;
  denoms?: {
    n1000: string; n500: string; n200: string; n100: string; n50: string; n20: string; n10: string;
  };
  cargoCount: number;
  mktgCount: number;
  vjCount: number;
  transactions: Transaction[];
  expenses: Expense[];
}

const styles = StyleSheet.create({
  page: { padding: 30, fontFamily: 'Helvetica', fontSize: 10 },
  header: { marginBottom: 20 },
  companyName: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  title: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase', marginBottom: 20 },
  sectionTitle: { fontSize: 10, fontWeight: 'bold', marginTop: 15, marginBottom: 5, backgroundColor: '#f3f4f6', padding: 4 },
  
  // Grid layout for summaries
  summaryGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  summaryBox: { width: '48%', borderStyle: 'solid', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 4, padding: 10 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  summaryLabel: { color: '#4b5563', fontSize: 9 },
  summaryValue: { fontWeight: 'bold', fontSize: 9 },
  
  // Highlighted net
  netBox: { marginTop: 10, padding: 10, backgroundColor: '#FEF3C7', borderRadius: 4, borderWidth: 1, borderColor: '#F59E0B' },
  netText: { fontSize: 14, fontWeight: 'bold', color: '#B45309' },
  
  // Table
  table: { display: 'flex', width: 'auto', borderStyle: 'solid', borderWidth: 1, borderRightWidth: 0, borderBottomWidth: 0, borderColor: '#e5e7eb', marginTop: 10 },
  tableRow: { flexDirection: 'row' },
  tableColHeader: { flex: 1, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableColHeaderNarrow: { width: '10%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableColHeaderWide: { flex: 2, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  
  tableCol: { flex: 1, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableColNarrow: { width: '10%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableColWide: { flex: 2, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  
  tableCellHeader: { fontSize: 8, fontWeight: 'bold' },
  tableCell: { fontSize: 8 },
  
  footer: { marginTop: 30, fontSize: 8, color: '#9ca3af', textAlign: 'center' }
});

const EODReportPDF = ({ data }: { data: EODReportData }) => (
  <Document>
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.companyName}>EHI MULTISYSTEMS NIGERIA LIMITED</Text>
        <Text style={styles.title}>DAILY OPERATIONS REPORT</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
          <Text style={{ fontSize: 9 }}>Date: {data.date}</Text>
          <Text style={{ fontSize: 9 }}>Hub: {data.hubName}</Text>
        </View>
      </View>

      <View style={styles.summaryGrid}>
        <View style={styles.summaryBox}>
          <Text style={styles.sectionTitle}>REVENUE BREAKDOWN</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Cargo Station ({data.cargoCount})</Text>
            <Text style={styles.summaryValue}>₦{data.cargoTotal.toLocaleString('en-NG')}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Field Marketing ({data.mktgCount})</Text>
            <Text style={styles.summaryValue}>₦{data.mktgTotal.toLocaleString('en-NG')}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>ValueJet Baggage ({data.vjCount})</Text>
            <Text style={styles.summaryValue}>₦{data.vjTotal.toLocaleString('en-NG')}</Text>
          </View>
          <View style={[styles.summaryRow, { marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#e5e7eb' }]}>
            <Text style={[styles.summaryLabel, { fontWeight: 'bold' }]}>GROSS TOTAL</Text>
            <Text style={styles.summaryValue}>₦{data.grossTotal.toLocaleString('en-NG')}</Text>
          </View>
        </View>

        <View style={styles.summaryBox}>
          <Text style={styles.sectionTitle}>PAYMENT ANALYSIS (SYSTEM EXPECTED)</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Cash Received</Text>
            <Text style={styles.summaryValue}>₦{data.cashTotal.toLocaleString('en-NG')}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Bank Transfer</Text>
            <Text style={styles.summaryValue}>₦{data.transferTotal.toLocaleString('en-NG')}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>POS Terminal</Text>
            <Text style={styles.summaryValue}>₦{data.posTotal.toLocaleString('en-NG')}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Outstanding Debt</Text>
            <Text style={[styles.summaryValue, { color: '#EF4444' }]}>₦{data.debtTotal.toLocaleString('en-NG')}</Text>
          </View>
          <View style={[styles.summaryRow, { marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#e5e7eb' }]}>
            <Text style={[styles.summaryLabel, { fontWeight: 'bold' }]}>TOTAL SETTLED</Text>
            <Text style={styles.summaryValue}>₦{(data.cashTotal + data.transferTotal + data.posTotal).toLocaleString('en-NG')}</Text>
          </View>
        </View>
      </View>

      <View style={styles.summaryGrid}>
        <View style={[styles.summaryBox, { width: '100%' }]}>
          <Text style={styles.sectionTitle}>CASH RECONCILIATION</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}>
             <View style={{ width: '48%' }}>
                <Text style={[styles.summaryLabel, { fontWeight: 'bold', marginBottom: 4 }]}>EXPENSES (PAID IN CASH)</Text>
                {data.expenses.filter(e => !e.mode || e.mode === 'Cash').map((e, i) => (
                  <View style={styles.summaryRow} key={`exp-${i}`}>
                    <Text style={styles.summaryLabel}>- {e.type} {e.description ? `(${e.description})` : ''}</Text>
                    <Text style={[styles.summaryValue, { color: '#EF4444' }]}>-₦{e.amount.toLocaleString('en-NG')}</Text>
                  </View>
                ))}
                {data.expenses.filter(e => !e.mode || e.mode === 'Cash').length === 0 && (
                  <Text style={[styles.summaryLabel, { fontStyle: 'italic' }]}>No cash expenses logged today.</Text>
                )}
             </View>
             <View style={{ width: '48%' }}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Expected Net Cash:</Text>
                  <Text style={styles.summaryValue}>₦{data.netCashToRemit.toLocaleString('en-NG')}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Expected Transfer:</Text>
                  <Text style={styles.summaryValue}>₦{data.transferTotal.toLocaleString('en-NG')}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Expected POS:</Text>
                  <Text style={styles.summaryValue}>₦{data.posTotal.toLocaleString('en-NG')}</Text>
                </View>
             </View>
          </View>

          <View style={{ borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 10, paddingBottom: 5 }}>
            <View style={{ flexDirection: 'row', backgroundColor: '#f9fafb', padding: 4 }}>
              <Text style={{ flex: 1, fontSize: 8, fontWeight: 'bold' }}>CHANNEL</Text>
              <Text style={{ flex: 1, fontSize: 8, fontWeight: 'bold', textAlign: 'right' }}>EXPECTED</Text>
              <Text style={{ flex: 1, fontSize: 8, fontWeight: 'bold', textAlign: 'right' }}>COUNTED (ACTUAL)</Text>
              <Text style={{ flex: 1, fontSize: 8, fontWeight: 'bold', textAlign: 'right' }}>VARIANCE</Text>
            </View>
            {[
              { label: 'Physical Cash', expected: data.netCashToRemit, actual: data.countedCash || 0 },
              { label: 'Bank Transfer', expected: data.transferTotal, actual: data.countedTransfer || 0 },
              { label: 'POS Terminal', expected: data.posTotal, actual: data.countedPOS || 0 },
            ].map((row, i) => {
              const variance = row.actual - row.expected;
              return (
                <View key={`var-${i}`} style={{ flexDirection: 'row', padding: 4, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
                  <Text style={{ flex: 1, fontSize: 8 }}>{row.label}</Text>
                  <Text style={{ flex: 1, fontSize: 8, textAlign: 'right' }}>₦{row.expected.toLocaleString('en-NG')}</Text>
                  <Text style={{ flex: 1, fontSize: 8, textAlign: 'right', fontWeight: 'bold' }}>₦{row.actual.toLocaleString('en-NG')}</Text>
                  <Text style={{ flex: 1, fontSize: 8, textAlign: 'right', color: variance === 0 ? '#10B981' : (variance < 0 ? '#EF4444' : '#F59E0B') }}>
                    {variance === 0 ? 'BALANCED' : (variance > 0 ? `+₦${variance.toLocaleString('en-NG')}` : `-₦${Math.abs(variance).toLocaleString('en-NG')}`)}
                  </Text>
                </View>
              );
            })}
          </View>
          
          {data.varianceReason && (
             <View style={{ marginTop: 10, padding: 8, backgroundColor: '#FEF2F2', borderRadius: 4 }}>
                <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#991B1B', marginBottom: 2 }}>VARIANCE REASON:</Text>
                <Text style={{ fontSize: 9, color: '#991B1B' }}>{data.varianceReason}</Text>
             </View>
          )}

          {data.denoms && (
             <View style={{ marginTop: 10 }}>
                <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#4B5563', marginBottom: 4 }}>CASH DENOMINATIONS:</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {Object.entries(data.denoms).map(([k, v]) => {
                    if (!v || Number(v) === 0) return null;
                    const val = k.replace('n', '');
                    return (
                      <Text key={k} style={{ fontSize: 8, color: '#6B7280', marginRight: 10, marginBottom: 2 }}>
                        ₦{val} x {v}
                      </Text>
                    );
                  })}
                </View>
             </View>
          )}

          <View style={styles.netBox}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.netText}>PHYSICAL CASH REMITTED:</Text>
              <Text style={styles.netText}>₦{(data.countedCash || 0).toLocaleString('en-NG')}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <Text style={{ fontSize: 9, color: '#92400E' }}>Remitted By: {data.lockedBy}</Text>
              <Text style={{ fontSize: 9, color: '#92400E' }}>Received By: {data.managerName || '________________________'}</Text>
            </View>
          </View>
        </View>
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 10 }]}>TRANSACTION LOG ({data.transactions.length})</Text>
      <View style={styles.table}>
        <View style={styles.tableRow}>
          <View style={styles.tableColNarrow}><Text style={styles.tableCellHeader}>S/N</Text></View>
          <View style={styles.tableColNarrow}><Text style={styles.tableCellHeader}>Time</Text></View>
          <View style={styles.tableColNarrow}><Text style={styles.tableCellHeader}>Type</Text></View>
          <View style={styles.tableColWide}><Text style={styles.tableCellHeader}>Name / Consignee</Text></View>
          <View style={styles.tableColWide}><Text style={styles.tableCellHeader}>Details</Text></View>
          <View style={styles.tableCol}><Text style={styles.tableCellHeader}>Amount</Text></View>
          <View style={styles.tableCol}><Text style={styles.tableCellHeader}>Mode</Text></View>
        </View>
        {data.transactions.map((t, i) => (
          <View style={styles.tableRow} key={t.id}>
            <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{i + 1}</Text></View>
            <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{t.time}</Text></View>
            <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{t.type}</Text></View>
            <View style={styles.tableColWide}><Text style={styles.tableCell}>{t.name}</Text></View>
            <View style={styles.tableColWide}><Text style={styles.tableCell}>{t.detail}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>₦{t.amount.toLocaleString('en-NG')}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{t.mode}</Text></View>
          </View>
        ))}
      </View>

      <Text style={styles.footer}>
        Locked by {data.lockedBy} at {data.lockedAt} | Generated by EHI Logistics Platform
      </Text>
    </Page>
  </Document>
);

export const downloadEODReport = async (data: EODReportData) => {
  const blob = await pdf(<EODReportPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EOD_Report_${data.date.replace(/[/ ]/g, '_')}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};

export const printEODReport = async (data: EODReportData) => {
  const blob = await pdf(<EODReportPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
};
