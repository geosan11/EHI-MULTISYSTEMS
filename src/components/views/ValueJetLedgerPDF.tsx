import React from 'react';
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { Transaction } from '../../lib/types';
import { EHILogoPDF } from '../EHILogoPDF';

export interface VJLedgerReportData {
  date: string;
  hubName: string;
  transactions: Transaction[];
  filters: {
    flight: string;
    destination: string;
  };
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

const VJLedgerPDF = ({ data }: { data: VJLedgerReportData }) => {
  const totalAmount = data.transactions.reduce((acc, t) => acc + t.amount, 0);

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <View style={{ alignItems: 'flex-start', marginBottom: 15 }}>
            <EHILogoPDF width={110} />
          </View>
          <Text style={styles.title}>VALUEJET LEDGER</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={{ fontSize: 9 }}>Date: {data.date}</Text>
            <Text style={{ fontSize: 9 }}>Hub: {data.hubName}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
            <Text style={{ fontSize: 9 }}>Flight: {data.filters.flight || 'All'}</Text>
            <Text style={{ fontSize: 9 }}>Destination: {data.filters.destination || 'All'}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
            <Text style={{ fontSize: 9, fontWeight: 'bold' }}>Total Entries: {data.transactions.length}</Text>
            <Text style={{ fontSize: 9, fontWeight: 'bold' }}>Total Amount: NGN {totalAmount.toLocaleString('en-NG')}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableRow}>
            <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>TIME</Text></View>
            <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>REF</Text></View>
            <View style={styles.tableColHeaderWide}><Text style={styles.tableCellHeader}>PASSENGER</Text></View>
            <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>FLIGHT</Text></View>
            <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>DESTINATION</Text></View>
            <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>PNR</Text></View>
            <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>PCS</Text></View>
            <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>TOTAL KG</Text></View>
            <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>EXCESS</Text></View>
            <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>AMOUNT (NGN)</Text></View>
            <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>MODE</Text></View>
          </View>
          
          {data.transactions.map((t, i) => (
            <View style={styles.tableRow} key={i}>
              <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{t.time}</Text></View>
              <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{t.id}</Text></View>
              <View style={styles.tableColWide}><Text style={styles.tableCell}>{t.name}</Text></View>
              <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{t.flight || '-'}</Text></View>
              <View style={styles.tableCol}><Text style={styles.tableCell}>{t.destination || '-'}</Text></View>
              <View style={styles.tableCol}><Text style={styles.tableCell}>{t.pnr || '-'}</Text></View>
              <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{t.pieces || '-'}</Text></View>
              <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{t.totalKg || '-'}</Text></View>
              <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{t.excessKg || '-'}</Text></View>
              <View style={styles.tableCol}><Text style={styles.tableCell}>{t.amount.toLocaleString('en-NG')}</Text></View>
              <View style={styles.tableCol}><Text style={styles.tableCell}>{t.mode}</Text></View>
            </View>
          ))}
        </View>

        <Text style={styles.footer}>EHI Logistics • ValueJet Ledger • {new Date().toLocaleString()}</Text>
      </Page>
    </Document>
  );
};

export const downloadVJLedgerPDF = async (data: VJLedgerReportData) => {
  const blob = await pdf(<VJLedgerPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  const dateStr = data.date.replace(/\//g, '-');
  const flightPart = data.filters.flight ? `_${data.filters.flight}` : '';
  link.download = `VJ_Ledger_${dateStr}${flightPart}.pdf`;
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
