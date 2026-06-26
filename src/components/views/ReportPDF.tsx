import { Document, Page, Text, View, StyleSheet, pdf, Font } from '@react-pdf/renderer';
import { EHILogoPDF } from '../EHILogoPDF';

Font.register({
  family: 'Roboto',
  fonts: [
    {
      src: "https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf",
      fontWeight: 400,
    },
    {
      src: "https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Medium.ttf",
      fontWeight: 700,
    },
  ],
});

const styles = StyleSheet.create({
  page: { padding: 30, fontFamily: 'Roboto', fontSize: 10 },
  header: { marginBottom: 20 },
  companyName: { fontSize: 16, fontWeight: 'bold', color: '#F59E0B', marginBottom: 4 },
  title: { fontSize: 13, color: '#111827', textTransform: 'uppercase', marginBottom: 15, fontWeight: 'bold' },
  subtitleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  subtitleText: { fontSize: 9, color: '#6b7280' },
  
  sectionTitle: { fontSize: 10, fontWeight: 'bold', marginTop: 15, marginBottom: 5, backgroundColor: '#f3f4f6', padding: 4 },
  
  table: { display: 'flex', width: 'auto', borderStyle: 'solid', borderWidth: 1, borderRightWidth: 0, borderBottomWidth: 0, borderColor: '#e5e7eb', marginTop: 10 },
  tableRow: { flexDirection: 'row' },
  tableColHeader: { flex: 1, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableCol: { flex: 1, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  
  tableCellHeader: { fontSize: 8, fontWeight: 'bold' },
  tableCell: { fontSize: 8 },
  
  textRight: { textAlign: 'right' },
  textCenter: { textAlign: 'center' },
  fontBold: { fontWeight: 'bold' },
  
  footer: { position: 'absolute', bottom: 30, left: 30, right: 30, fontSize: 8, color: '#9ca3af', textAlign: 'center' }
});

export interface ReportDataPayload {
  reportType: string;
  reportLabel: string;
  hubName: string;
  generatedBy: string;
  dateRange: { from: Date; to: Date };
  revenue: any;
  routes: any;
  customers: any;
  debtors: any;
  staff: any;
  hubs: any;
}

const fmt = (num: number) => `N${num.toLocaleString('en-NG')}`;

const RevenueTable = ({ data }: { data: any }) => (
  <View>
    <Text style={styles.sectionTitle}>BY STREAM</Text>
    <View style={styles.table}>
      <View style={styles.tableRow}>
        <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>Stream Name</Text></View>
        <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textCenter]}>Entries</Text></View>
        <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textRight]}>Amount</Text></View>
      </View>
      {data.streams.map((s: any, i: number) => (
        <View style={styles.tableRow} key={i}>
          <View style={styles.tableCol}><Text style={styles.tableCell}>{s.name}</Text></View>
          <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textCenter]}>{s.count}</Text></View>
          <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textRight]}>{fmt(s.amount)}</Text></View>
        </View>
      ))}
    </View>

    <Text style={styles.sectionTitle}>BY PAYMENT MODE</Text>
    <View style={styles.table}>
      <View style={styles.tableRow}>
        <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>Payment Mode</Text></View>
        <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textRight]}>Amount</Text></View>
      </View>
      {data.modes.map((m: any, i: number) => (
        <View style={styles.tableRow} key={i}>
          <View style={styles.tableCol}><Text style={styles.tableCell}>{m.name}</Text></View>
          <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textRight]}>{fmt(m.amount)}</Text></View>
        </View>
      ))}
    </View>

    <View style={{ marginTop: 20, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#F59E0B', paddingTop: 10 }}>
      <Text style={{ fontSize: 12, fontWeight: 'bold' }}>TOTAL REVENUE</Text>
      <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#F59E0B' }}>{fmt(data.total)}</Text>
    </View>
  </View>
);

const RoutesTable = ({ data }: { data: any[] }) => (
  <View style={styles.table}>
    <View style={styles.tableRow}>
      <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>Route</Text></View>
      <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textCenter]}>Entries</Text></View>
      <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textRight]}>Cargo (N)</Text></View>
      <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textRight]}>Marketing (N)</Text></View>
      <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textRight]}>Total Revenue</Text></View>
    </View>
    {data.map((r, i) => (
      <View style={styles.tableRow} key={i}>
        <View style={styles.tableCol}><Text style={styles.tableCell}>{r.route}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textCenter]}>{r.count}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textRight]}>{r.cargo.toLocaleString('en-NG')}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textRight]}>{r.mktg.toLocaleString('en-NG')}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textRight, styles.fontBold]}>{fmt(r.revenue)}</Text></View>
      </View>
    ))}
  </View>
);

const CustomersTable = ({ data }: { data: any[] }) => (
  <View style={styles.table}>
    <View style={styles.tableRow}>
      <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>Consignee / Customer</Text></View>
      <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textCenter]}>Transactions</Text></View>
      <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textCenter]}>Last Seen</Text></View>
      <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textRight]}>Total Revenue</Text></View>
    </View>
    {data.map((c, i) => (
      <View style={styles.tableRow} key={i}>
        <View style={styles.tableCol}><Text style={styles.tableCell}>{c.name}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textCenter]}>{c.transactions}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textCenter]}>{c.lastSeen}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textRight, styles.fontBold]}>{fmt(c.revenue)}</Text></View>
      </View>
    ))}
  </View>
);

const DebtorsTable = ({ data }: { data: any }) => (
  <View>
    <Text style={styles.sectionTitle}>AGING BUCKETS</Text>
    <View style={styles.table}>
      <View style={styles.tableRow}>
        <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textCenter]}>0-30 Days</Text></View>
        <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textCenter]}>31-60 Days</Text></View>
        <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textCenter]}>61-90 Days</Text></View>
        <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textCenter, { color: '#EF4444' }]}>90+ Days</Text></View>
      </View>
      <View style={styles.tableRow}>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textCenter]}>{fmt(data.buckets['0-30'])}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textCenter]}>{fmt(data.buckets['31-60'])}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textCenter]}>{fmt(data.buckets['61-90'])}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textCenter, styles.fontBold, { color: '#EF4444' }]}>{fmt(data.buckets['90+'])}</Text></View>
      </View>
    </View>

    <Text style={styles.sectionTitle}>DEBTOR LIST</Text>
    <View style={styles.table}>
      <View style={styles.tableRow}>
        <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>Debtor Name</Text></View>
        <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textCenter]}>Age (Days)</Text></View>
        <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textCenter]}>Bucket</Text></View>
        <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textRight]}>Amount Owed</Text></View>
      </View>
      {data.items.slice(0, 30).map((d: any, i: number) => (
        <View style={styles.tableRow} key={i}>
          <View style={styles.tableCol}><Text style={styles.tableCell}>{d.name}</Text></View>
          <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textCenter]}>{d.age}</Text></View>
          <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textCenter]}>{d.bucket}</Text></View>
          <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textRight, { color: '#EF4444' }]}>{fmt(d.amount)}</Text></View>
        </View>
      ))}
    </View>
    <View style={{ marginTop: 20, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#EF4444', paddingTop: 10 }}>
      <Text style={{ fontSize: 12, fontWeight: 'bold' }}>TOTAL OUTSTANDING DEBT</Text>
      <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#EF4444' }}>{fmt(data.total)}</Text>
    </View>
  </View>
);

const StaffTable = ({ data }: { data: any[] }) => (
  <View style={styles.table}>
    <View style={styles.tableRow}>
      <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>Role / Agent Type</Text></View>
      <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textCenter]}>Entries</Text></View>
      <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textRight]}>Generated Revenue</Text></View>
    </View>
    {data.map((s, i) => (
      <View style={styles.tableRow} key={i}>
        <View style={styles.tableCol}><Text style={styles.tableCell}>{s.role}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textCenter]}>{s.entries}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textRight, styles.fontBold]}>{fmt(s.revenue)}</Text></View>
      </View>
    ))}
  </View>
);

const HubsTable = ({ data }: { data: any[] }) => (
  <View style={styles.table}>
    <View style={styles.tableRow}>
      <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>Hub</Text></View>
      <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textCenter]}>Entries</Text></View>
      <View style={styles.tableColHeader}><Text style={[styles.tableCellHeader, styles.textRight]}>Revenue</Text></View>
    </View>
    {data.map((h, i) => (
      <View style={styles.tableRow} key={i}>
        <View style={styles.tableCol}><Text style={styles.tableCell}>{h.hub}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textCenter]}>{h.entries}</Text></View>
        <View style={styles.tableCol}><Text style={[styles.tableCell, styles.textRight, styles.fontBold]}>{fmt(h.revenue)}</Text></View>
      </View>
    ))}
  </View>
);

const PDFDocument = ({ payload }: { payload: ReportDataPayload }) => {
  const { dateRange, reportType } = payload;
  const fromStr = dateRange.from.toISOString().split('T')[0];
  const toStr   = dateRange.to.toISOString().split('T')[0];
  const rangeStr = fromStr === toStr ? fromStr : `${fromStr} to ${toStr}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={{ alignItems: 'flex-start', marginBottom: 15 }}>
            <EHILogoPDF width={120} />
          </View>
          <Text style={styles.title}>{payload.reportLabel}</Text>
          <View style={styles.subtitleRow}>
            <Text style={styles.subtitleText}>Date Range: {rangeStr}</Text>
            <Text style={styles.subtitleText}>Hub: {payload.hubName}</Text>
          </View>
        </View>

        <View>
          {reportType === 'revenue' && <RevenueTable data={payload.revenue} />}
          {reportType === 'routes' && <RoutesTable data={payload.routes} />}
          {reportType === 'customers' && <CustomersTable data={payload.customers} />}
          {reportType === 'debtors' && <DebtorsTable data={payload.debtors} />}
          {reportType === 'staff' && <StaffTable data={payload.staff} />}
          {reportType === 'hubs' && <HubsTable data={payload.hubs} />}
        </View>

        <Text style={styles.footer}>
          Generated by {payload.generatedBy} | Powered by EHI Logistics Platform
        </Text>
      </Page>
    </Document>
  );
};

export const downloadReportPDF = async (payload: ReportDataPayload) => {
  const blob = await pdf(<PDFDocument payload={payload} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  
  const fromStr = payload.dateRange.from.toISOString().split('T')[0];
  const toStr   = payload.dateRange.to.toISOString().split('T')[0];
  a.download = `EHI_${payload.reportType}_${fromStr}_to_${toStr}.pdf`;
  
  a.click();
  URL.revokeObjectURL(url);
};
