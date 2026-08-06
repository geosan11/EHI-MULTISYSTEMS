import React from 'react';
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { Transaction } from '../../lib/types';
import { EHILogoPDF } from '../EHILogoPDF';
import { AirlineLogoPDF } from '../AirlineLogoPDF';
import { resolveAirlineLogoUrl } from '../../lib/airlineLogos';
import { formatPaymentModeDisplay } from '../../lib/helpers';

export interface BaggageLedgerReportData {
  airlineName: string;
  date: string;
  hubName: string;
  transactions: Transaction[];
  filters: {
    flight: string;
    destination: string;
  };
  // Pre-resolved via resolveAirlineLogoUrl (see downloadBaggageLedgerPDF) --
  // looked up from the same Supabase-backed logo store every other PDF/
  // receipt in the app uses (managed in Airline Logo Manager), never a
  // bundled/hardcoded image file. Pass explicitly only if you've already
  // resolved it elsewhere; otherwise leave undefined and let
  // downloadBaggageLedgerPDF resolve it.
  airlineLogoUrl?: string | null;
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

// One row per flight code present in the day's transactions -- lets the
// per-flight pages below show revenue/weight per flight without the caller
// having to pre-group anything.
function groupByFlight(transactions: Transaction[]): Array<{ flight: string; rows: Transaction[] }> {
  const groups: Record<string, Transaction[]> = {};
  transactions.forEach((t) => {
    const key = t.flight || 'Unknown';
    (groups[key] ||= []).push(t);
  });
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([flight, rows]) => ({ flight, rows }));
}

const LedgerHeader = ({ data }: { data: BaggageLedgerReportData }) => (
  <View style={styles.header}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 15 }}>
      <EHILogoPDF width={110} />
      <AirlineLogoPDF airline={data.airlineName} logoUrl={data.airlineLogoUrl} width={90} />
    </View>
    <Text style={styles.title}>{data.airlineName.toUpperCase()} LEDGER</Text>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
      <Text style={{ fontSize: 9 }}>Date: {data.date}</Text>
      <Text style={{ fontSize: 9 }}>Hub: {data.hubName}</Text>
    </View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
      <Text style={{ fontSize: 9 }}>Flight: {data.filters.flight || 'All'}</Text>
      <Text style={{ fontSize: 9 }}>Destination: {data.filters.destination || 'All'}</Text>
    </View>
  </View>
);

const LedgerTable = ({ rows }: { rows: Transaction[] }) => (
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
      <View style={styles.tableColHeaderWide}><Text style={styles.tableCellHeader}>MODE</Text></View>
    </View>

    {rows.map((t, i) => (
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
        <View style={styles.tableCol}><Text style={styles.tableCell}>{t.amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
        <View style={styles.tableColWide}><Text style={styles.tableCell}>{formatPaymentModeDisplay(t.mode, (t as any).wallet_deduction_amount, t.amount)}</Text></View>
      </View>
    ))}
  </View>
);

const BaggageLedgerPDF = ({ data }: { data: BaggageLedgerReportData }) => {
  const totalAmount = data.transactions.reduce((acc, t) => acc + t.amount, 0);
  const flightGroups = groupByFlight(data.transactions);

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <LedgerHeader data={data} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ fontSize: 9, fontWeight: 'bold' }}>Total Entries: {data.transactions.length}</Text>
          <Text style={{ fontSize: 9, fontWeight: 'bold' }}>Total Amount: NGN {totalAmount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
        </View>

        <LedgerTable rows={data.transactions} />

        <Text style={styles.footer}>EHI Logistics • {data.airlineName} Ledger • {new Date().toLocaleString()}</Text>
      </Page>

      {/* One page per flight, breaking down what that specific flight
          generated -- lets a hub reconcile revenue against the airline's
          own per-flight manifest instead of only having the combined day total. */}
      {flightGroups.map(({ flight, rows }) => {
        const flightTotal = rows.reduce((acc, t) => acc + t.amount, 0);
        const destinations = [...new Set(rows.map((t) => t.destination).filter(Boolean))].join(', ') || '-';
        return (
          <Page size="A4" orientation="landscape" style={styles.page} key={flight}>
            <LedgerHeader data={data} />

            <View style={{ backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 4, padding: 10, marginBottom: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: 'bold', marginBottom: 6 }}>Flight {flight} — {destinations}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 9 }}>Passengers: {rows.length}</Text>
                <Text style={{ fontSize: 9 }}>Pieces: {rows.reduce((a, t) => a + (t.pieces || 0), 0)}</Text>
                <Text style={{ fontSize: 9 }}>Excess KG: {rows.reduce((a, t) => a + (t.excessKg || 0), 0)}</Text>
                <Text style={{ fontSize: 10, fontWeight: 'bold' }}>Revenue: NGN {flightTotal.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
              </View>
            </View>

            <LedgerTable rows={rows} />

            <Text style={styles.footer}>EHI Logistics • {data.airlineName} Ledger • Flight {flight} • {new Date().toLocaleString()}</Text>
          </Page>
        );
      })}
    </Document>
  );
};

export const downloadBaggageLedgerPDF = async (data: BaggageLedgerReportData) => {
  // Resolved from the same Supabase-backed logo store every other PDF in the
  // app uses (see AirlineLogoManager) -- never a bundled/hardcoded image, so
  // whichever airline these transactions carry always prints correctly.
  const withLogo: BaggageLedgerReportData = data.airlineLogoUrl !== undefined
    ? data
    : { ...data, airlineLogoUrl: await resolveAirlineLogoUrl(data.airlineName) };

  const blob = await pdf(<BaggageLedgerPDF data={withLogo} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  const dateStr = data.date.replace(/\//g, '-');
  const flightPart = data.filters.flight ? `_${data.filters.flight}` : '';
  const airlineSlug = data.airlineName.replace(/\s+/g, '_');
  link.download = `${airlineSlug}_Ledger_${dateStr}${flightPart}.pdf`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
