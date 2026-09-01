import { useState, useEffect, useMemo } from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from '@react-pdf/renderer';
import { Building2, Calendar, FileDown, Loader, Receipt } from 'lucide-react';
import { User } from '../../lib/types';
import { supabase, fetchAllRows } from '../../lib/supabase';
import { BackButton } from '../BackButton';
import { EHILogoPDF } from '../EHILogoPDF';
import { useToast } from '../../lib/ToastContext';

interface CorporateClient {
  id: string;
  company_name: string;
  contact_phone: string | null;
  accumulated_monthly_debt: number;
}

type BillEntryType = 'cargo' | 'package' | 'baggage' | 'marketing';

interface BillEntry {
  type: BillEntryType;
  entry_ref: string;
  created_at: string;
  awb_tag_number: string | null;
  route: string | null;
  content_type: string | null;
  total_pcs: number;
  total_kg: number;
  amount: number;
}

function fmtNaira(n: number): string {
  return 'NGN ' + (n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Cargo entries stay unprefixed (the historical/majority case, and the only
// type with a real AWB/tag number); the other 3 departments get a bracketed
// tag so a statement mixing departments doesn't read as cargo-only.
const DEPT_LABEL: Record<BillEntryType, string> = { cargo: '', package: 'PKG', baggage: 'BAG', marketing: 'MKT' };
function billEntryRef(e: BillEntry): string {
  const base = e.awb_tag_number || e.entry_ref;
  return DEPT_LABEL[e.type] ? `[${DEPT_LABEL[e.type]}] ${base}` : base;
}

// Local-date (not UTC) YYYY-MM-DD -- toISOString() would shift the boundary
// by the browser's UTC offset, silently dropping the first/last day's
// entries for any timezone west of UTC (all of Nigeria's business hours).
function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica' },
  header: { marginBottom: 20 },
  title: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase', marginBottom: 20 },
  clientBox: {
    marginBottom: 15,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  clientName: { fontSize: 14, fontWeight: 'bold', marginBottom: 3 },
  clientMeta: { fontSize: 9, color: '#6b7280', marginBottom: 2 },
  tableTitle: { fontSize: 10, fontWeight: 'bold', marginTop: 15, marginBottom: 5 },
  table: { display: 'flex', width: 'auto', borderStyle: 'solid', borderWidth: 1, borderRightWidth: 0, borderBottomWidth: 0, borderColor: '#e5e7eb' },
  tableRow: { flexDirection: 'row' },
  tableColSmall: { width: '6%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableColDate: { width: '12%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableColLarge: { width: '20%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableCol: { width: '16%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableColSmallBody: { width: '6%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableColDateBody: { width: '12%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableColLargeBody: { width: '20%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableCellHeader: { fontSize: 8, fontWeight: 'bold' },
  tableCell: { fontSize: 8 },
  summaryBox: { marginTop: 20, padding: 15, backgroundColor: '#f9fafb', borderRadius: 4, borderWidth: 1, borderColor: '#e5e7eb' },
  balanceBox: { marginTop: 15, padding: 15, backgroundColor: '#DBEAFE', borderRadius: 6, borderWidth: 1, borderColor: '#3B82F6' },
  balanceText: { fontSize: 14, fontWeight: 'bold', color: '#1E3A8A' },
  footerNote: { fontSize: 8, color: '#9ca3af', marginTop: 30, textAlign: 'center' },
});

interface CorporateBillPDFData {
  client: CorporateClient;
  periodLabel: string;
  entries: BillEntry[];
  totalAmount: number;
  generatedBy: string;
}

const CorporateBillPDF = ({ data }: { data: CorporateBillPDFData }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <View style={{ alignItems: 'center', marginBottom: 15 }}>
          <EHILogoPDF width={120} />
        </View>
        <Text style={styles.title}>CORPORATE CLIENT STATEMENT</Text>
      </View>

      <View style={styles.clientBox}>
        <Text style={styles.clientName}>{data.client.company_name}</Text>
        {data.client.contact_phone ? <Text style={styles.clientMeta}>Contact: {data.client.contact_phone}</Text> : null}
        <Text style={styles.clientMeta}>Billing Period: {data.periodLabel}</Text>
        <Text style={styles.clientMeta}>Generated: {new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} by {data.generatedBy}</Text>
      </View>

      <Text style={styles.tableTitle}>SHIPMENTS IN PERIOD ({data.entries.length})</Text>
      <View style={styles.table}>
        <View style={styles.tableRow}>
          <View style={styles.tableColSmall}><Text style={styles.tableCellHeader}>#</Text></View>
          <View style={styles.tableColDate}><Text style={styles.tableCellHeader}>Date</Text></View>
          <View style={styles.tableCol}><Text style={styles.tableCellHeader}>AWB/Tag</Text></View>
          <View style={styles.tableColLarge}><Text style={styles.tableCellHeader}>Route</Text></View>
          <View style={styles.tableCol}><Text style={styles.tableCellHeader}>Content</Text></View>
          <View style={styles.tableColSmall}><Text style={styles.tableCellHeader}>Pcs</Text></View>
          <View style={styles.tableColSmall}><Text style={styles.tableCellHeader}>KG</Text></View>
          <View style={styles.tableCol}><Text style={styles.tableCellHeader}>Amount (NGN)</Text></View>
        </View>
        {data.entries.map((e, i) => (
          <View style={styles.tableRow} key={`${e.type}:${e.entry_ref}`}>
            <View style={styles.tableColSmallBody}><Text style={styles.tableCell}>{i + 1}</Text></View>
            <View style={styles.tableColDateBody}><Text style={styles.tableCell}>{new Date(e.created_at).toLocaleDateString('en-GB')}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{billEntryRef(e)}</Text></View>
            <View style={styles.tableColLargeBody}><Text style={styles.tableCell}>{e.route || '-'}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{e.content_type || '-'}</Text></View>
            <View style={styles.tableColSmallBody}><Text style={styles.tableCell}>{e.total_pcs}</Text></View>
            <View style={styles.tableColSmallBody}><Text style={styles.tableCell}>{Math.round(e.total_kg)}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{e.amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
          </View>
        ))}
      </View>

      <View style={styles.summaryBox}>
        <Text style={{ fontSize: 10, fontWeight: 'bold', marginBottom: 5 }}>PERIOD SUMMARY</Text>
        <Text style={{ fontSize: 9 }}>Total Shipments: {data.entries.length}</Text>
        <Text style={{ fontSize: 9, marginTop: 3 }}>Total Charges for Period: {fmtNaira(data.totalAmount)}</Text>
      </View>

      <View style={styles.balanceBox}>
        <Text style={styles.balanceText}>CURRENT OUTSTANDING BALANCE: {fmtNaira(data.client.accumulated_monthly_debt)}</Text>
        <Text style={{ fontSize: 8, color: '#1E3A8A', marginTop: 2 }}>
          (Running account balance as of today -- not limited to this statement's period. Reflects all unpaid charges, including any from before or after this period.)
        </Text>
      </View>

      <Text style={styles.footerNote}>EHI Multisystems Nigeria Limited -- Generated by EHI Logistics Platform</Text>
    </Page>
  </Document>
);

export const CorporateBilling = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const { showToast } = useToast();
  const [clients, setClients] = useState<CorporateClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [rangeMode, setRangeMode] = useState<'month' | 'custom'>('month');
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [customStart, setCustomStart] = useState(() => toDateInputValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [customEnd, setCustomEnd] = useState(() => toDateInputValue(new Date()));
  const [loadingClients, setLoadingClients] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [entries, setEntries] = useState<BillEntry[] | null>(null);

  useEffect(() => {
    supabase.from('corporate_clients').select('id, company_name, contact_phone, accumulated_monthly_debt').order('company_name').then(({ data, error }) => {
      if (data && !error) setClients(data as CorporateClient[]);
      setLoadingClients(false);
    });
  }, []);

  // [start, end) -- end is exclusive (midnight of the day AFTER the last
  // included day) so a shipment logged any time on the last calendar day
  // of the range is still captured, instead of an inclusive `lte` on a
  // bare date silently excluding everything after 00:00 that day.
  const { rangeStart, rangeEnd, periodLabel } = useMemo(() => {
    if (rangeMode === 'month') {
      const [y, m] = month.split('-').map(Number);
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 1);
      return {
        rangeStart: start,
        rangeEnd: end,
        periodLabel: start.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' }),
      };
    }
    const start = new Date(customStart + 'T00:00:00');
    const end = new Date(customEnd + 'T00:00:00');
    end.setDate(end.getDate() + 1);
    return {
      rangeStart: start,
      rangeEnd: end,
      periodLabel: `${start.toLocaleDateString('en-GB')} – ${new Date(customEnd + 'T00:00:00').toLocaleDateString('en-GB')}`,
    };
  }, [rangeMode, month, customStart, customEnd]);

  const selectedClient = clients.find(c => c.id === selectedClientId) || null;

  const handleGenerate = async () => {
    if (!selectedClientId) return;
    if (rangeMode === 'custom' && customEnd < customStart) {
      showToast({ message: 'End date is before start date -- pick a valid range.', type: 'error' });
      return;
    }
    setGenerating(true);
    setEntries(null);
    try {
      // All 4 departments, not just cargo -- a corporate client's package/
      // baggage/marketing business was previously invisible on their own
      // statement even though accumulated_monthly_debt (shown right below)
      // already reflects all 4. Each uses fetchAllRows, not a bare
      // `.select()`, since PostgREST's default 1000-row cap could otherwise
      // silently truncate a high-volume client's monthly statement.
      const [cargoRows, packageRows, baggageRows, marketingRows] = await Promise.all([
        fetchAllRows<any>((from, to) => supabase.from('cargo_entries')
          .select('entry_ref, created_at, awb_tag_number, route, content_type, total_pcs, total_kg, amount')
          .eq('corporate_client_id', selectedClientId)
          .gte('created_at', rangeStart.toISOString()).lt('created_at', rangeEnd.toISOString())
          .order('created_at', { ascending: true }).range(from, to)),
        fetchAllRows<any>((from, to) => supabase.from('package_entries')
          .select('entry_ref, created_at, destination, content_type, total_pcs, total_kg, amount')
          .eq('corporate_client_id', selectedClientId)
          .gte('created_at', rangeStart.toISOString()).lt('created_at', rangeEnd.toISOString())
          .order('created_at', { ascending: true }).range(from, to)),
        fetchAllRows<any>((from, to) => supabase.from('manifests')
          .select('transaction_id, created_at, destination, total_pcs, excess_kg, amount')
          .eq('corporate_client_id', selectedClientId)
          .gte('created_at', rangeStart.toISOString()).lt('created_at', rangeEnd.toISOString())
          .order('created_at', { ascending: true }).range(from, to)),
        fetchAllRows<any>((from, to) => supabase.from('marketing_entries')
          .select('entry_ref, created_at, route, qty_big_bag, qty_med_bag, qty_small_bag, bb_kg, mb_kg, sb_kg, amount_paid')
          .eq('corporate_client_id', selectedClientId)
          .gte('created_at', rangeStart.toISOString()).lt('created_at', rangeEnd.toISOString())
          .order('created_at', { ascending: true }).range(from, to)),
      ]);

      const merged: BillEntry[] = [
        ...cargoRows.map((r: any): BillEntry => ({
          type: 'cargo', entry_ref: r.entry_ref, created_at: r.created_at, awb_tag_number: r.awb_tag_number,
          route: r.route, content_type: r.content_type, total_pcs: r.total_pcs || 0, total_kg: r.total_kg || 0, amount: r.amount || 0,
        })),
        ...packageRows.map((r: any): BillEntry => ({
          type: 'package', entry_ref: r.entry_ref, created_at: r.created_at, awb_tag_number: null,
          route: r.destination, content_type: r.content_type, total_pcs: r.total_pcs || 0, total_kg: r.total_kg || 0, amount: r.amount || 0,
        })),
        ...baggageRows.map((r: any): BillEntry => ({
          type: 'baggage', entry_ref: r.transaction_id, created_at: r.created_at, awb_tag_number: null,
          // excess_kg, not total_kg -- billable weight for baggage is only
          // the portion over the airline's free allowance, matching what
          // ExcessBaggageForm.tsx itself charges for at intake.
          route: r.destination, content_type: null, total_pcs: r.total_pcs || 0, total_kg: r.excess_kg || 0, amount: r.amount || 0,
        })),
        ...marketingRows.map((r: any): BillEntry => ({
          type: 'marketing', entry_ref: r.entry_ref, created_at: r.created_at, awb_tag_number: null,
          // amount_paid holds the SALE TOTAL for marketing (inverted
          // convention -- see debt.ts's own comment on this), not what's
          // actually been paid down; total_pcs/total_kg have no single
          // column here, so summed from the big/medium/small bag fields.
          route: r.route, content_type: null,
          total_pcs: (r.qty_big_bag || 0) + (r.qty_med_bag || 0) + (r.qty_small_bag || 0),
          total_kg: (r.bb_kg || 0) + (r.mb_kg || 0) + (r.sb_kg || 0),
          amount: r.amount_paid || 0,
        })),
      ].sort((a, b) => a.created_at.localeCompare(b.created_at));

      setEntries(merged);
    } catch (err: any) {
      showToast({ message: `Failed to generate bill: ${err.message}`, type: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const totalAmount = (entries || []).reduce((sum, e) => sum + (e.amount || 0), 0);

  const handleDownloadPDF = async () => {
    if (!selectedClient || !entries) return;
    const blob = await pdf(
      <CorporateBillPDF
        data={{
          client: selectedClient,
          periodLabel,
          entries,
          totalAmount,
          generatedBy: user.name || 'EHI Agent',
        }}
      />
    ).toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Custom-range periodLabel is en-GB-formatted ("14/07/2026 –
    // 15/07/2026") -- the slashes would otherwise land in a filename
    // download attribute, where browsers treat them as path separators.
    // Collapsing every run of non-alphanumeric characters (not just
    // whitespace/commas) covers that plus the en-dash and any other
    // punctuation a locale might introduce.
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    a.download = `Statement_${safe(selectedClient.company_name)}_${safe(periodLabel)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="flex-1 flex flex-col h-full bg-[var(--color-bg)] overflow-y-auto">
      <div className="bg-[var(--color-surface-card)] border-b border-[var(--color-border)] p-4">
        <BackButton onClick={onBack} label="Back to Menu" className="mb-3" />
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[rgba(245,158,11,0.1)] rounded-lg">
            <Receipt size={20} strokeWidth={1.5} className="text-[var(--color-accent-amber)]" />
          </div>
          <div>
            <h1 className="text-[16px] font-bold font-sans text-[var(--color-foreground)] tracking-tight">Corporate Client Billing</h1>
            <p className="text-[11px] font-mono text-[var(--color-muted)] mt-0.5">Generate a shipment statement for a corporate account</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-2xl">
        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
          <label className="block">
            <span className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Building2 size={12} /> Corporate Client</span>
            <select
              value={selectedClientId}
              onChange={e => { setSelectedClientId(e.target.value); setEntries(null); }}
              disabled={loadingClients}
              className="w-full h-11 px-3 mt-1 text-[13px] rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)]"
            >
              <option value="">{loadingClients ? 'Loading clients...' : 'Select a client...'}</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </label>

          <div>
            <span className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Calendar size={12} /> Billing Period</span>
            <div className="flex bg-[var(--color-obsidian)] border border-[var(--color-border)] p-1 rounded-lg mt-1 mb-2">
              <button
                onClick={() => { setRangeMode('month'); setEntries(null); }}
                className={`flex-1 py-2 text-[11px] font-bold font-mono uppercase tracking-wider rounded transition-all ${rangeMode === 'month' ? 'bg-[var(--color-surface-2)] text-[var(--color-accent-amber)]' : 'text-[var(--color-muted)]'}`}
              >
                Month
              </button>
              <button
                onClick={() => { setRangeMode('custom'); setEntries(null); }}
                className={`flex-1 py-2 text-[11px] font-bold font-mono uppercase tracking-wider rounded transition-all ${rangeMode === 'custom' ? 'bg-[var(--color-surface-2)] text-[var(--color-accent-amber)]' : 'text-[var(--color-muted)]'}`}
              >
                Custom Range
              </button>
            </div>
            {rangeMode === 'month' ? (
              <input
                type="month"
                value={month}
                onChange={e => { setMonth(e.target.value); setEntries(null); }}
                className="w-full h-11 px-3 text-[13px] rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)]"
              />
            ) : (
              <div className="flex gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={e => { setCustomStart(e.target.value); setEntries(null); }}
                  className="flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)]"
                />
                <input
                  type="date"
                  value={customEnd}
                  onChange={e => { setCustomEnd(e.target.value); setEntries(null); }}
                  className="flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)]"
                />
              </div>
            )}
          </div>

          <button
            onClick={handleGenerate}
            disabled={!selectedClientId || generating}
            className="w-full h-11 bg-[var(--color-accent-amber)] text-[var(--color-on-accent)] rounded-lg text-[12px] font-bold font-mono disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {generating ? <><Loader size={14} className="animate-spin" /> Generating...</> : 'Generate Bill'}
          </button>
        </div>

        {entries != null && selectedClient && (
          <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-[14px] font-bold text-[var(--color-foreground)]">{selectedClient.company_name}</div>
                <div className="text-[11px] font-mono text-[var(--color-muted)]">{periodLabel}</div>
              </div>
              <button
                onClick={handleDownloadPDF}
                className="flex items-center gap-1.5 px-3 py-2 bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.3)] text-[var(--color-accent-amber)] text-[11px] font-bold rounded-lg"
              >
                <FileDown size={13} /> Download PDF
              </button>
            </div>

            {entries.length === 0 ? (
              <div className="text-[12px] font-mono text-[var(--color-muted)] text-center py-6">No shipments for this client in the selected period.</div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {entries.map(e => (
                  <div key={`${e.type}:${e.entry_ref}`} className="flex justify-between items-center bg-[var(--color-surface-2)] rounded-lg p-2.5 text-[12px]">
                    <div>
                      <div className="font-bold text-[var(--color-foreground)]">{billEntryRef(e)}</div>
                      <div className="text-[10px] font-mono text-[var(--color-muted)]">{e.route || '-'} · {e.total_pcs} pcs · {Math.round(e.total_kg)} kg · {new Date(e.created_at).toLocaleDateString('en-GB')}</div>
                    </div>
                    <div className="font-mono font-bold text-[var(--color-foreground)]">{fmtNaira(e.amount)}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-[var(--color-border)] pt-3 flex justify-between items-center">
              <span className="text-[12px] font-mono text-[var(--color-muted)]">Total ({entries.length} shipments)</span>
              <span className="text-[16px] font-bold font-mono text-[var(--color-accent-amber)]">{fmtNaira(totalAmount)}</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="font-mono text-[var(--color-muted)]">Current Outstanding Balance (all-time)</span>
              <span className="font-mono font-bold text-[var(--color-foreground)]">{fmtNaira(selectedClient.accumulated_monthly_debt)}</span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};
