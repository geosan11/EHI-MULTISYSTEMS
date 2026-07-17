import { useState, useMemo, useEffect } from 'react';
import { User, Transaction } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';
import { Calendar, FileText, Download, Printer, ChevronRight, Filter, Loader2 } from 'lucide-react';
import { BackButton } from '../BackButton';
import * as XLSX from 'xlsx';

const REPORT_TYPES = [
  { id: 'revenue',    label: 'Revenue Summary',     desc: 'Stream, mode, and total breakdown' },
  { id: 'routes',     label: 'Route Profitability', desc: 'Cargo + marketing by destination' },
  { id: 'customers',  label: 'Top Consignees',      desc: 'Highest revenue customers' },
  { id: 'debtors',    label: 'Debtor Aging',        desc: 'Outstanding balances 0-30/31-60/61-90/90+' },
  { id: 'staff',      label: 'Staff Productivity',  desc: 'Entries and revenue per agent' },
  { id: 'hubs',       label: 'Hub Comparison',      desc: 'Per-hub revenue (admin only)' },
];

const PRESETS = [
  { id: 'today',     label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week',      label: 'Last 7 Days' },
  { id: 'month',     label: 'This Month' },
  { id: 'last_month',label: 'Last Month' },
  { id: 'quarter',   label: 'This Quarter' },
  { id: 'ytd',       label: 'Year to Date' },
  { id: 'custom',    label: 'Custom Range' },
];

export const Reports = ({ user, transactions, onBack }: { user: User; transactions: Transaction[]; onBack?: () => void }) => {
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [preset, setPreset] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [generating, setGenerating] = useState(false);
  const [hubNames, setHubNames] = useState<Record<string, string>>({});
  const [fetchedTx, setFetchedTx] = useState<Transaction[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);

  useEffect(() => {
    supabase.from('hubs').select('id, name, code').then(({ data }) => {
      if (data) {
        const map: Record<string, string> = {};
        data.forEach((h: any) => { map[h.id] = `${h.code}/${h.name}`; });
        setHubNames(map);
      }
    });
  }, []);

  // Compute date range
  const dateRange = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let from: Date, to: Date;
    switch (preset) {
      case 'today':      from = today;                                                to = now; break;
      case 'yesterday':  from = new Date(today.getTime() - 86400000);                 to = today; break;
      case 'week':       from = new Date(today.getTime() - 7 * 86400000);             to = now; break;
      case 'month':      from = new Date(now.getFullYear(), now.getMonth(), 1);       to = now; break;
      case 'last_month': from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                         to = new Date(now.getFullYear(), now.getMonth(), 0); break;
      case 'quarter':    from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); to = now; break;
      case 'ytd':        from = new Date(now.getFullYear(), 0, 1);                    to = now; break;
      case 'custom':     from = customFrom ? new Date(customFrom) : today;
                         to = customTo ? new Date(customTo) : now; break;
      default:           from = today; to = now;
    }
    return { from, to };
  }, [preset, customFrom, customTo]);

  // Fetch transactions based on dateRange
  useEffect(() => {
    let isMounted = true;
    const fetchTransactions = async () => {
      setIsLoadingTx(true);
      const fromISO = dateRange.from.toISOString();
      const toISO = dateRange.to.toISOString();
      
      const isAdmin = ['super_admin','admin','accountant','auditor'].includes(user.role);
      const addHubFilter = (q: any) => (!isAdmin && user.hub_id) ? q.eq('hub_id', user.hub_id) : q;

      try {
        const [cargoRes, vjRes, mktRes, profilesRes] = await Promise.all([
          addHubFilter(supabase.from('cargo_entries').select('entry_ref,consignee_name,airline,awb_tag_number,total_pcs,total_kg,route,content_type,amount,receipt_mode,created_at,status,bank,hub_id').gte('created_at', fromISO).lte('created_at', toISO)),
          addHubFilter(supabase.from('manifests').select('transaction_id,passenger_name,flight_no,destination,excess_kg,amount,payment_mode,created_at,bank,hub_id,total_kg,pnr,passenger_phone').gte('created_at', fromISO).lte('created_at', toISO)),
          addHubFilter(supabase.from('marketing_entries').select('entry_ref,customer_name,route,qty_big_bag,qty_med_bag,qty_small_bag,amount_paid,payment_mode,created_at,hub_id,bank,entered_by').gte('created_at', fromISO).lte('created_at', toISO)),
          supabase.from('user_profiles').select('id,name')
        ]);

        const profileLookup: Record<string, string> = {};
        if (profilesRes.data) {
          profilesRes.data.forEach((p: any) => {
            if (p.id) profileLookup[p.id] = p.name || '';
          });
        }

        const allTx: Transaction[] = [];

        if (cargoRes.data) {
          cargoRes.data.forEach((r: any) => {
            allTx.push({
              id: r.entry_ref,
              name: r.consignee_name || 'Consignee',
              detail: `${r.route || 'Local'} · ${r.airline || 'Airline'} · ${r.awb_tag_number || ''}`,
              amount: r.amount || 0,
              mode: r.receipt_mode || 'Cash',
              time: new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              type: 'cargo',
              status: r.status,
              created_at: r.created_at,
              bank: r.bank,
              hub_id: r.hub_id,
              route: r.route,
            });
          });
        }

        if (vjRes.data) {
          vjRes.data.forEach((r: any) => {
            allTx.push({
              id: r.transaction_id,
              name: r.passenger_name || 'Passenger',
              detail: `${r.destination || 'Destination'} · ${r.flight_no || 'Flight'} · ${r.excess_kg}KG`,
              amount: r.amount || 0,
              mode: r.payment_mode || 'Cash',
              time: new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              type: 'baggage',
              status: r.status || 'Received',
              created_at: r.created_at,
              bank: r.bank,
              hub_id: r.hub_id,
            });
          });
        }

        if (mktRes.data) {
          mktRes.data.forEach((r: any) => {
            const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
            allTx.push({
              id: r.entry_ref || r.id,
              name: r.customer_name || 'Customer',
              detail: `${r.route || 'Local'} · BB:${r.qty_big_bag||0} MB:${r.qty_med_bag||0} SB:${r.qty_small_bag||0}`,
              amount: r.amount_paid || 0,
              mode: r.payment_mode || 'Cash',
              time: new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              type: 'marketing',
              status: r.status || 'Received',
              created_at: r.created_at,
              bank: r.bank,
              hub_id: r.hub_id,
              route: r.route,
              enteredByName: enteredByName || undefined,
            });
          });
        }
        
        if (isMounted) {
          setFetchedTx(allTx.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()));
        }
      } catch (err) {
        console.error("Failed to fetch report transactions", err);
      } finally {
        if (isMounted) setIsLoadingTx(false);
      }
    };

    fetchTransactions();
    return () => { isMounted = false; };
  }, [dateRange, user]);

  // Filter transactions to date range (we now just use the fetchedTx, which are already filtered by the DB)
  const filteredTx = useMemo(() => {
    return fetchedTx;
  }, [fetchedTx]);

  // ── Report computations ─────────────────────────

  const revenueReport = useMemo(() => {
    const cargo     = filteredTx.filter(t => t.type === 'cargo');
    const marketing = filteredTx.filter(t => t.type === 'marketing');
    const vj        = filteredTx.filter(t => t.type === 'baggage');
    return {
      streams: [
        { name: 'Air Cargo',          count: cargo.length,     amount: cargo.reduce((s,t) => s+t.amount, 0) },
        { name: 'Field Marketing',    count: marketing.length, amount: marketing.reduce((s,t) => s+t.amount, 0) },
        { name: 'Excess Baggage',     count: vj.length,        amount: vj.reduce((s,t) => s+t.amount, 0) },
      ],
      modes: [
        { name: 'Cash',     amount: filteredTx.filter(t => t.mode === 'Cash').reduce((s,t) => s+t.amount, 0) },
        { name: 'Transfer', amount: filteredTx.filter(t => t.mode === 'Transfer').reduce((s,t) => s+t.amount, 0) },
        { name: 'POS',      amount: filteredTx.filter(t => t.mode === 'POS').reduce((s,t) => s+t.amount, 0) },
        { name: 'Credit (Debt)', amount: filteredTx.filter(t => t.mode === 'Debt').reduce((s,t) => s+t.amount, 0) },
      ],
      total: filteredTx.reduce((s,t) => s+t.amount, 0),
    };
  }, [filteredTx]);

  const routeReport = useMemo(() => {
    const map: Record<string, { revenue: number; count: number; cargo: number; mktg: number }> = {};
    filteredTx.filter(t => t.type === 'cargo' || t.type === 'marketing').forEach(t => {
      const route = t.route || t.detail?.split('·')[0]?.trim() || 'Unknown';
      if (!map[route]) map[route] = { revenue: 0, count: 0, cargo: 0, mktg: 0 };
      map[route].revenue += t.amount;
      map[route].count   += 1;
      if (t.type === 'cargo') map[route].cargo += t.amount; else map[route].mktg += t.amount;
    });
    return Object.entries(map)
      .map(([route, d]) => ({ route, ...d }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filteredTx]);

  const customerReport = useMemo(() => {
    const map: Record<string, { revenue: number; transactions: number; lastSeen: string }> = {};
    filteredTx.forEach(t => {
      const name = (t.name || 'Unknown').trim();
      if (!map[name]) map[name] = { revenue: 0, transactions: 0, lastSeen: t.time || '' };
      map[name].revenue      += t.amount;
      map[name].transactions += 1;
      if (t.time && t.time > map[name].lastSeen) map[name].lastSeen = t.time;
    });
    return Object.entries(map)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20);
  }, [filteredTx]);

  const debtorReport = useMemo(() => {
    const debts = filteredTx.filter(t => t.mode === 'Debt');
    const buckets = { 'Current': 0, 'Overdue': 0, 'Critical': 0, 'Write-off risk': 0 };
    const items: Array<{ name: string; amount: number; age: number; bucket: string }> = [];
    
    debts.forEach(t => {
      const agedays = Math.floor(
        (Date.now() - new Date(t.created_at || (t as any).date || Date.now()).getTime())
        / (1000 * 60 * 60 * 24)
      );
      const bucket = agedays <= 30 ? 'Current' : agedays <= 60 ? 'Overdue' : agedays <= 90 ? 'Critical' : 'Write-off risk';
      buckets[bucket as keyof typeof buckets] += t.amount;
      items.push({ name: t.name, amount: t.amount, age: agedays, bucket });
    });
    
    return { buckets, items: items.sort((a, b) => b.age - a.age), total: debts.reduce((s,t) => s+t.amount, 0) };
  }, [filteredTx]);

  const staffReport = useMemo(() => {
    const map: Record<string, { entries: number; revenue: number; cargo: number; mktg: number; vj: number }> = {};
    filteredTx.forEach(t => {
      const agent = (t.enteredByName || 'Unknown Agent').trim();
      if (!map[agent]) map[agent] = { entries: 0, revenue: 0, cargo: 0, mktg: 0, vj: 0 };
      map[agent].entries  += 1;
      map[agent].revenue  += t.amount;
      if (t.type === 'cargo')     map[agent].cargo += t.amount;
      if (t.type === 'marketing') map[agent].mktg  += t.amount;
      if (t.type === 'baggage')   map[agent].vj    += t.amount;
    });
    return Object.entries(map).map(([role, d]) => ({ role, ...d })).sort((a, b) => b.revenue - a.revenue).slice(0, 20);
  }, [filteredTx]);

  const hubReport = useMemo(() => {
    const byHub: Record<string, { revenue: number; entries: number }> = {};
    filteredTx.forEach(t => {
      // Fall back to the viewing user's own hub only when a transaction has no hub_id
      // (legacy rows created before hub_id was tracked)
      const key = t.hub_id || `unassigned:${user.hub}`;
      if (!byHub[key]) byHub[key] = { revenue: 0, entries: 0 };
      byHub[key].revenue += t.amount;
      byHub[key].entries += 1;
    });
    return Object.entries(byHub)
      .map(([key, d]) => ({
        hub: key.startsWith('unassigned:') ? key.replace('unassigned:', '') : (hubNames[key] || 'Unknown Hub'),
        revenue: d.revenue,
        entries: d.entries,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filteredTx, user.hub, hubNames]);

  // ── Export functions ─────────────────────────────

  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();
    if (selectedReport === 'revenue') {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(revenueReport.streams), 'Streams');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(revenueReport.modes), 'Payment Modes');
    }
    if (selectedReport === 'routes')    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(routeReport),     'Routes');
    if (selectedReport === 'customers') XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customerReport),  'Top Customers');
    if (selectedReport === 'debtors')   XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(debtorReport.items), 'Debtors');
    if (selectedReport === 'staff')     XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(staffReport),     'Staff');
    if (selectedReport === 'hubs')      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hubReport),       'Hubs');
    const fromStr = dateRange.from.toISOString().split('T')[0];
    const toStr   = dateRange.to.toISOString().split('T')[0];
    XLSX.writeFile(wb, `EHI_${selectedReport}_${fromStr}_to_${toStr}.xlsx`);
  };

  const exportToPdf = async () => {
    setGenerating(true);
    // Dynamic import — PDF report generator
    const { downloadReportPDF } = await import('./ReportPDF');
    await downloadReportPDF({
      reportType:    selectedReport!,
      reportLabel:   REPORT_TYPES.find(r => r.id === selectedReport)?.label || '',
      hubName:       user.hub,
      generatedBy:   user.name,
      dateRange,
      revenue:       selectedReport === 'revenue'   ? revenueReport  : null,
      routes:        selectedReport === 'routes'    ? routeReport    : null,
      customers:     selectedReport === 'customers' ? customerReport : null,
      debtors:       selectedReport === 'debtors'   ? debtorReport   : null,
      staff:         selectedReport === 'staff'     ? staffReport    : null,
      hubs:          selectedReport === 'hubs'      ? hubReport      : null,
    });
    setGenerating(false);
  };

  // ── Render ───────────────────────────────────────

  return (
    <div>
      <div className="ehi-page-body px-4 pt-4 space-y-4">
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] pb-2">
        {onBack && <BackButton onClick={onBack} />}
        <div>
          <div className="text-[9px] font-mono text-[var(--color-muted)] tracking-[0.12em] uppercase">▸ REPORTS CENTRE</div>
          <div className="text-[11px] font-mono text-[var(--color-accent-amber)] mt-0.5">{user.hub}</div>
        </div>
      </div>

      {!selectedReport ? (
        // ── Report selection grid ──
        <div className="grid gap-3 md:grid-cols-2">
          {REPORT_TYPES
            .filter(r => r.id !== 'hubs' || user.role === 'super_admin' || user.role === 'admin')
            .map(r => (
            <button
              key={r.id}
              onClick={() => setSelectedReport(r.id)}
              className="ehi-card text-left p-4 flex items-start gap-3 bg-[var(--color-surface-card)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
            >
              <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-[rgba(245,158,11,0.12)] flex items-center justify-center shrink-0">
                <FileText size={16} className="text-[var(--color-accent-amber)]" />
              </div>
              <div className="flex-1">
                <div className="text-[14px] font-bold text-[var(--color-foreground)]">{r.label}</div>
                <div className="text-[11px] text-[var(--color-muted)] mt-0.5">{r.desc}</div>
              </div>
              <ChevronRight size={16} className="text-[var(--color-muted)] mt-1" />
            </button>
          ))}
        </div>
      ) : (
        // ── Report viewer ──
        <div className="space-y-4">
          <button
            onClick={() => setSelectedReport(null)}
            className="text-[11px] text-[var(--color-muted)] bg-transparent border-none cursor-pointer hover:text-[var(--color-foreground)] transition-colors"
          >
            ← Back to reports
          </button>

          {/* Date range selector */}
          <div className="ehi-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Calendar size={13} className="text-[var(--color-accent-amber)]" />
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-accent-amber)] font-bold">Date Range</span>
            </div>
            {/* auto-fit (not a viewport-width md: breakpoint) so column count
                tracks the actually-available width next to SideNav, instead
                of jumping to 4 columns whenever the viewport crosses 768px
                regardless of how much room is really left -- that's what was
                spilling the row out of the card. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  className={`min-w-0 truncate px-3 py-2 text-[11px] font-mono border rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                    preset === p.id
                      ? 'bg-[var(--color-accent-amber)] text-[#0B0F19] border-[var(--color-accent-amber)] font-bold'
                      : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] border-[var(--color-border)] font-medium hover:bg-[var(--color-surface-3)] hover:text-[var(--color-foreground)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex gap-2">
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="ehi-input" />
                <input type="date" value={customTo}   onChange={e => setCustomTo(e.target.value)} className="ehi-input" />
              </div>
            )}
          </div>

          {/* Report content area */}
          <div className="ehi-card p-4">
            <div className="text-[14px] font-bold text-[var(--color-foreground)] mb-3">
              {REPORT_TYPES.find(r => r.id === selectedReport)?.label}
            </div>

            {isLoadingTx ? (
              <div className="flex justify-center py-12">
                <Loader2 size={24} className="animate-spin text-[var(--color-accent-amber)]" />
              </div>
            ) : (
              <>
                {selectedReport === 'revenue' && <RevenueReportView data={revenueReport} />}
                {selectedReport === 'routes'    && <RouteReportView data={routeReport} />}
                {selectedReport === 'customers' && <CustomerReportView data={customerReport} />}
                {selectedReport === 'debtors'   && <DebtorReportView data={debtorReport} />}
                {selectedReport === 'staff'     && <StaffReportView data={staffReport} />}
                {selectedReport === 'hubs'      && <HubReportView data={hubReport} />}
              </>
            )}
          </div>

          {/* Export buttons */}
          <div className="flex gap-2">
            <button 
              onClick={exportToExcel}
              className="flex-1 p-3 bg-transparent border border-[var(--color-success)] text-[var(--color-success)] rounded-[var(--radius-md)] font-bold text-[12px] cursor-pointer flex items-center justify-center gap-1.5 hover:bg-[rgba(16,185,129,0.1)] transition-colors"
            >
              <Download size={14} /> EXCEL
            </button>
            <button 
              onClick={exportToPdf} 
              disabled={generating}
              className={`flex-[2] p-3 rounded-[var(--radius-md)] font-extrabold text-[13px] cursor-pointer flex items-center justify-center gap-2 transition-opacity ${generating ? 'opacity-60' : 'opacity-100 hover:opacity-90'}`}
              style={{
                background: 'linear-gradient(135deg, var(--color-accent-amber) 0%, #C87900 100%)',
                color: '#0D1117', border: 'none',
              }}
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              {generating ? 'GENERATING...' : 'DOWNLOAD PDF'}
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

// ── Report View Components ────────────────────────────

const RevenueReportView = ({ data }: { data: any }) => (
  <div className="space-y-4">
    <div>
      <div className="text-[10px] text-[var(--color-muted)] mb-1.5 uppercase font-bold tracking-wider">By Stream</div>
      {data.streams.map((s: any) => (
        <div key={s.name} className="flex justify-between py-2 border-b border-[var(--color-border)]">
          <span className="text-[12px] text-[var(--color-foreground)] font-medium">{s.name}</span>
          <div className="text-right">
            <div className="text-[13px] font-mono font-bold text-[var(--color-foreground)]">{fmt(s.amount)}</div>
            <div className="text-[10px] text-[var(--color-muted)]">{s.count} entries</div>
          </div>
        </div>
      ))}
    </div>
    <div>
      <div className="text-[10px] text-[var(--color-muted)] mb-1.5 uppercase font-bold tracking-wider">By Payment Mode</div>
      {data.modes.map((m: any) => (
        <div key={m.name} className="flex justify-between py-1.5 border-b border-[var(--color-border)] border-dashed last:border-0">
          <span className="text-[12px] text-[var(--color-foreground)]">{m.name}</span>
          <span className="text-[12px] font-mono font-bold text-[var(--color-foreground)]">{fmt(m.amount)}</span>
        </div>
      ))}
    </div>
    <div className="pt-3 border-t border-[var(--color-accent-amber)] flex justify-between items-center">
      <span className="text-[12px] font-bold text-[var(--color-accent-amber)] tracking-wider">TOTAL</span>
      <span className="text-[16px] font-mono font-bold text-[var(--color-accent-amber)]">{fmt(data.total)}</span>
    </div>
  </div>
);

const RouteReportView = ({ data }: { data: any[] }) => (
  <div className="space-y-1">
    {data.map((r, i) => (
      <div key={r.route} className="flex items-center gap-3 py-2.5 border-b border-[var(--color-border)] last:border-0">
        <span className="text-[10px] text-[var(--color-muted)] min-w-[20px] font-mono">#{i + 1}</span>
        <div className="flex-1">
          <div className="text-[13px] font-bold text-[var(--color-foreground)]">{r.route}</div>
          <div className="text-[10px] text-[var(--color-muted)]">
            Cargo: {fmt(r.cargo)} · Mktg: {fmt(r.mktg)} · {r.count} entries
          </div>
        </div>
        <span className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">{fmt(r.revenue)}</span>
      </div>
    ))}
  </div>
);

const CustomerReportView = ({ data }: { data: any[] }) => (
  <div className="space-y-1">
    {data.map((c, i) => (
      <div key={c.name} className="flex items-center gap-3 py-2.5 border-b border-[var(--color-border)] last:border-0">
        <span className="text-[10px] text-[var(--color-muted)] min-w-[20px] font-mono">#{i + 1}</span>
        <div className="flex-1">
          <div className="text-[13px] font-bold text-[var(--color-foreground)]">{c.name}</div>
          <div className="text-[10px] text-[var(--color-muted)]">{c.transactions} transactions · Last: {c.lastSeen}</div>
        </div>
        <span className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">{fmt(c.revenue)}</span>
      </div>
    ))}
  </div>
);

const DebtorReportView = ({ data }: { data: any }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-2">
      {Object.entries(data.buckets).map(([bucket, amount]) => (
        <div key={bucket} className="min-w-0 p-2.5 bg-[var(--color-surface-2)] rounded-[var(--radius-sm)] text-center border border-[var(--color-border)]">
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider font-bold mb-1 truncate">{bucket}</div>
          <div className={`text-[13px] font-mono font-bold ${bucket === 'Write-off risk' ? 'text-[var(--color-error)]' : 'text-[var(--color-foreground)]'}`}>
            {fmt(amount as number)}
          </div>
        </div>
      ))}
    </div>
    <div className="space-y-1">
      {data.items.slice(0, 15).map((d: any, i: number) => (
        <div key={i} className="flex justify-between py-2 border-b border-[var(--color-border)] last:border-0">
          <div>
            <div className="text-[12px] font-bold text-[var(--color-foreground)]">{d.name}</div>
            <div className="text-[10px] text-[var(--color-muted)]">Bucket: {d.bucket} · {d.age} days old</div>
          </div>
          <span className="text-[13px] font-mono font-bold text-[var(--color-error)]">{fmt(d.amount)}</span>
        </div>
      ))}
    </div>
    <div className="pt-3 border-t border-[var(--color-error)] flex justify-between items-center">
      <span className="text-[12px] font-bold text-[var(--color-error)] tracking-wider">TOTAL OUTSTANDING</span>
      <span className="text-[16px] font-mono font-bold text-[var(--color-error)]">{fmt(data.total)}</span>
    </div>
  </div>
);

const StaffReportView = ({ data }: { data: any[] }) => (
  <div className="space-y-1">
    {data.map(s => (
      <div key={s.role} className="flex justify-between py-2.5 border-b border-[var(--color-border)] last:border-0">
        <div>
          <div className="text-[13px] font-bold text-[var(--color-foreground)]">{s.role}</div>
          <div className="text-[10px] text-[var(--color-muted)]">{s.entries} entries</div>
        </div>
        <span className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">{fmt(s.revenue)}</span>
      </div>
    ))}
  </div>
);

const HubReportView = ({ data }: { data: any[] }) => (
  <div className="space-y-1">
    {data.map(h => (
      <div key={h.hub} className="flex justify-between py-2.5 border-b border-[var(--color-border)] last:border-0">
        <div>
          <div className="text-[13px] font-bold text-[var(--color-foreground)]">{h.hub}</div>
          <div className="text-[10px] text-[var(--color-muted)]">{h.entries} entries</div>
        </div>
        <span className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">{fmt(h.revenue)}</span>
      </div>
    ))}
  </div>
);
