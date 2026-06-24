import { useState, useMemo } from 'react';
import { User, Transaction } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { Calendar, FileText, Download, Printer, ChevronRight, Filter, Loader2, ArrowLeft } from 'lucide-react';
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

  // Filter transactions to date range
  const filteredTx = useMemo(() => {
    return transactions.filter(t => {
      // Demo: use today's date for all entries
      const d = new Date();
      return d >= dateRange.from && d <= dateRange.to;
    });
  }, [transactions, dateRange]);

  // ── Report computations ─────────────────────────

  const revenueReport = useMemo(() => {
    const cargo     = filteredTx.filter(t => t.type === 'cargo');
    const marketing = filteredTx.filter(t => t.type === 'marketing');
    const vj        = filteredTx.filter(t => t.type === 'baggage');
    return {
      streams: [
        { name: 'Air Cargo',          count: cargo.length,     amount: cargo.reduce((s,t) => s+t.amount, 0) },
        { name: 'Field Marketing',    count: marketing.length, amount: marketing.reduce((s,t) => s+t.amount, 0) },
        { name: 'ValueJet POS',       count: vj.length,        amount: vj.reduce((s,t) => s+t.amount, 0) },
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
    // Deterministic aging by tx id hash
    const stableAge = (id: string): number => {
      let h = 0;
      for (let i = 0; i < id.length; i++) { h = ((h << 5) - h) + id.charCodeAt(i); h |= 0; }
      return Math.abs(h) % 120;
    };
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const items: Array<{ name: string; amount: number; age: number; bucket: string }> = [];
    debts.forEach(t => {
      const age = stableAge(t.id);
      const bucket = age <= 30 ? '0-30' : age <= 60 ? '31-60' : age <= 90 ? '61-90' : '90+';
      buckets[bucket as keyof typeof buckets] += t.amount;
      items.push({ name: t.name, amount: t.amount, age, bucket });
    });
    return { buckets, items: items.sort((a, b) => b.age - a.age), total: debts.reduce((s,t) => s+t.amount, 0) };
  }, [filteredTx]);

  const staffReport = useMemo(() => {
    // In demo: derive from tx.id prefix (CG = cargo agent, MK = marketing agent, VJ = VJ agent)
    const map: Record<string, { entries: number; revenue: number; cargo: number; mktg: number; vj: number }> = {};
    filteredTx.forEach(t => {
      const role = t.type === 'cargo' ? 'Cargo Agent' : t.type === 'marketing' ? 'Marketing Agent' : 'VJ Agent';
      if (!map[role]) map[role] = { entries: 0, revenue: 0, cargo: 0, mktg: 0, vj: 0 };
      map[role].entries  += 1;
      map[role].revenue  += t.amount;
      if (t.type === 'cargo')     map[role].cargo += t.amount;
      if (t.type === 'marketing') map[role].mktg += t.amount;
      if (t.type === 'baggage')   map[role].vj += t.amount;
    });
    return Object.entries(map).map(([role, d]) => ({ role, ...d })).sort((a, b) => b.revenue - a.revenue);
  }, [filteredTx]);

  const hubReport = useMemo(() => {
    // Group transactions by hub (in demo, all transactions belong to user.hub)
    return [{ hub: user.hub, revenue: filteredTx.reduce((s,t) => s+t.amount, 0), entries: filteredTx.length }];
  }, [filteredTx, user.hub]);

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
    <div className="p-4 pb-24 space-y-4">
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] pb-2">
        {onBack && (
          <button onClick={onBack} className="p-1 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer border-none bg-transparent">
            <ArrowLeft size={18} />
          </button>
        )}
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
              className="ehi-card text-left p-4 flex items-start gap-3"
              style={{ background: 'var(--color-surface-card)' }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--radius-sm)',
                background: 'rgba(245,158,11,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <FileText size={16} style={{ color: 'var(--color-accent-amber)' }} />
              </div>
              <div className="flex-1">
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-foreground)' }}>{r.label}</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>{r.desc}</div>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--color-muted)' }} />
            </button>
          ))}
        </div>
      ) : (
        // ── Report viewer ──
        <div className="space-y-4">
          <button
            onClick={() => setSelectedReport(null)}
            style={{ fontSize: 11, color: 'var(--color-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            ← Back to reports
          </button>

          {/* Date range selector */}
          <div className="ehi-card space-y-3">
            <div className="flex items-center gap-2">
              <Calendar size={13} style={{ color: 'var(--color-accent-amber)' }} />
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-accent-amber)] font-bold">Date Range</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  style={{
                    padding: '8px 12px',
                    fontSize: 11, fontFamily: 'monospace',
                    background: preset === p.id ? 'var(--color-accent-amber)' : 'var(--color-surface-2)',
                    color: preset === p.id ? '#0D1117' : 'var(--color-muted)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    fontWeight: preset === p.id ? 700 : 500,
                    cursor: 'pointer',
                  }}
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
          <div className="ehi-card">
            <div className="text-[14px] font-bold text-[var(--color-foreground)] mb-3">
              {REPORT_TYPES.find(r => r.id === selectedReport)?.label}
            </div>

            {selectedReport === 'revenue' && <RevenueReportView data={revenueReport} />}
            {selectedReport === 'routes'    && <RouteReportView data={routeReport} />}
            {selectedReport === 'customers' && <CustomerReportView data={customerReport} />}
            {selectedReport === 'debtors'   && <DebtorReportView data={debtorReport} />}
            {selectedReport === 'staff'     && <StaffReportView data={staffReport} />}
            {selectedReport === 'hubs'      && <HubReportView data={hubReport} />}
          </div>

          {/* Export buttons */}
          <div className="flex gap-2">
            <button onClick={exportToExcel}
              style={{
                flex: 1, padding: '12px',
                background: 'transparent',
                border: '1px solid var(--color-success)',
                color: 'var(--color-success)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 700, fontSize: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
              <Download size={14} /> EXCEL
            </button>
            <button onClick={exportToPdf} disabled={generating}
              style={{
                flex: 2, padding: '12px',
                background: 'linear-gradient(135deg, var(--color-accent-amber) 0%, #C87900 100%)',
                color: '#0D1117', border: 'none',
                borderRadius: 'var(--radius-md)',
                fontWeight: 800, fontSize: 13, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: generating ? 0.6 : 1,
              }}>
              {generating ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              {generating ? 'GENERATING...' : 'DOWNLOAD PDF'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Report View Components ────────────────────────────

const RevenueReportView = ({ data }: { data: any }) => (
  <div className="space-y-4">
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-muted)', marginBottom: 6, textTransform: 'uppercase' }}>By Stream</div>
      {data.streams.map((s: any) => (
        <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: 12, color: 'var(--color-foreground)' }}>{s.name}</span>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-foreground)' }}>{fmt(s.amount)}</div>
            <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>{s.count} entries</div>
          </div>
        </div>
      ))}
    </div>
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-muted)', marginBottom: 6, textTransform: 'uppercase' }}>By Payment Mode</div>
      {data.modes.map((m: any) => (
        <div key={m.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
          <span style={{ fontSize: 12 }}>{m.name}</span>
          <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700 }}>{fmt(m.amount)}</span>
        </div>
      ))}
    </div>
    <div style={{ paddingTop: 12, borderTop: '1px solid var(--color-accent-amber)', display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-accent-amber)' }}>TOTAL</span>
      <span style={{ fontSize: 16, fontFamily: 'monospace', fontWeight: 800, color: 'var(--color-accent-amber)' }}>{fmt(data.total)}</span>
    </div>
  </div>
);

const RouteReportView = ({ data }: { data: any[] }) => (
  <div className="space-y-1">
    {data.map((r, i) => (
      <div key={r.route} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
        <span style={{ fontSize: 10, color: 'var(--color-muted)', minWidth: 20 }}>#{i + 1}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{r.route}</div>
          <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>
            Cargo: {fmt(r.cargo)} · Mktg: {fmt(r.mktg)} · {r.count} entries
          </div>
        </div>
        <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-accent-amber)' }}>{fmt(r.revenue)}</span>
      </div>
    ))}
  </div>
);

const CustomerReportView = ({ data }: { data: any[] }) => (
  <div className="space-y-1">
    {data.map((c, i) => (
      <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
        <span style={{ fontSize: 10, color: 'var(--color-muted)', minWidth: 20 }}>#{i + 1}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
          <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>{c.transactions} transactions · Last: {c.lastSeen}</div>
        </div>
        <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-accent-amber)' }}>{fmt(c.revenue)}</span>
      </div>
    ))}
  </div>
);

const DebtorReportView = ({ data }: { data: any }) => (
  <div className="space-y-3">
    <div className="grid grid-cols-4 gap-2">
      {Object.entries(data.buckets).map(([bucket, amount]) => (
        <div key={bucket} style={{ padding: 10, background: 'var(--color-surface-2)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--color-muted)', textTransform: 'uppercase' }}>{bucket} days</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: bucket === '90+' ? 'var(--color-error)' : 'var(--color-foreground)' }}>
            {fmt(amount as number)}
          </div>
        </div>
      ))}
    </div>
    <div className="space-y-1">
      {data.items.slice(0, 15).map((d: any, i: number) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{d.name}</div>
            <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>Bucket: {d.bucket} · {d.age} days old</div>
          </div>
          <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-error)' }}>{fmt(d.amount)}</span>
        </div>
      ))}
    </div>
    <div style={{ paddingTop: 10, borderTop: '1px solid var(--color-error)', display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-error)' }}>TOTAL OUTSTANDING</span>
      <span style={{ fontSize: 16, fontFamily: 'monospace', fontWeight: 800, color: 'var(--color-error)' }}>{fmt(data.total)}</span>
    </div>
  </div>
);

const StaffReportView = ({ data }: { data: any[] }) => (
  <div className="space-y-1">
    {data.map(s => (
      <div key={s.role} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{s.role}</div>
          <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>{s.entries} entries</div>
        </div>
        <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-accent-amber)' }}>{fmt(s.revenue)}</span>
      </div>
    ))}
  </div>
);

const HubReportView = ({ data }: { data: any[] }) => (
  <div className="space-y-1">
    {data.map(h => (
      <div key={h.hub} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{h.hub}</div>
          <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>{h.entries} entries</div>
        </div>
        <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-accent-amber)' }}>{fmt(h.revenue)}</span>
      </div>
    ))}
  </div>
);
