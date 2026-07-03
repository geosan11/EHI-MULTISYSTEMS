import React from 'react';
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { Transaction } from '../../lib/types';
import { EHILogoPDF } from '../EHILogoPDF';

export interface AnalyticsReportData {
  period: string;
  transactions: Transaction[];
}

const styles = StyleSheet.create({
  page: { padding: 30, fontFamily: 'Helvetica', fontSize: 10 },
  header: { marginBottom: 20 },
  companyName: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  title: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase', marginBottom: 20 },
  
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

const AnalyticsPDF = ({ data }: { data: AnalyticsReportData }) => {
  const totalAmount = data.transactions.reduce((acc, t) => acc + (t.amount || 0), 0);
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <View style={{ alignItems: 'flex-start', marginBottom: 15 }}>
            <EHILogoPDF width={110} />
          </View>
          <Text style={styles.title}>ANALYTICS TRANSACTIONS EXPORT</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={{ fontSize: 9 }}>Period: {data.period}</Text>
            <Text style={{ fontSize: 9 }}>Generated: {new Date().toLocaleDateString('en-GB')}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
            <Text style={{ fontSize: 9, fontWeight: 'bold' }}>Total Entries: {data.transactions.length}</Text>
            <Text style={{ fontSize: 9, fontWeight: 'bold' }}>Total Amount: NGN {totalAmount.toLocaleString('en-NG')}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableRow}>
            <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>DATE</Text></View>
            <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>ID</Text></View>
            <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>TYPE</Text></View>
            <View style={styles.tableColHeaderWide}><Text style={styles.tableCellHeader}>ROUTE / DETAIL</Text></View>
            <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>AWB / TAG</Text></View>
            <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>AMOUNT (NGN)</Text></View>
            <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>MODE</Text></View>
            <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>STATUS</Text></View>
          </View>
          
          {data.transactions.map((t, i) => {
            let route = t.route || '';
            let awb = t.awb_tag_number || '';
            if (!route && t.detail) {
              route = t.detail.split('·')[0]?.trim() || '';
            }

            return (
              <View style={styles.tableRow} key={i}>
                <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{new Date(t.created_at || Date.now()).toLocaleDateString()}</Text></View>
                <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{t.id}</Text></View>
                <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{t.type}</Text></View>
                <View style={styles.tableColWide}><Text style={styles.tableCell}>{route || '-'}</Text></View>
                <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{awb || '-'}</Text></View>
                <View style={styles.tableCol}><Text style={styles.tableCell}>{(t.amount || 0).toLocaleString('en-NG')}</Text></View>
                <View style={styles.tableCol}><Text style={styles.tableCell}>{t.mode || '-'}</Text></View>
                <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{t.status || '-'}</Text></View>
              </View>
            );
          })}
        </View>

        <Text style={styles.footer}>EHI Logistics • Analytics Export • {new Date().toLocaleString()}</Text>
      </Page>
    </Document>
  );
};

export const downloadAnalyticsPDF = async (data: AnalyticsReportData) => {
  const blob = await pdf(<AnalyticsPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  link.download = `ehi_analytics_${data.period}_${new Date().toISOString().split('T')[0]}.pdf`;
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
