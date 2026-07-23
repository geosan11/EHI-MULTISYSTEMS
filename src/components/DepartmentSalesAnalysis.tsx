import { useState, useMemo, useEffect } from 'react';
import { User, Transaction } from '../lib/types';
import { fmt } from '../lib/helpers';
import { Calendar, Loader2, X, BarChart2 } from 'lucide-react';
import {
  DepartmentSalesAnalysis as DeptAnalysis,
  DepartmentType,
  computeDepartmentSalesAnalysis,
  computeReportDateRange,
  fetchDepartmentSalesTransactions,
} from '../lib/salesAnalysis';

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

// Layer 1 (collective, all agents rolled up) then Layer 2 (per-agent
// detail) -- the big picture before the drill-down. Shared by Reports.tsx's
// admin-facing "X Sales Analysis" report and DepartmentSalesAnalysisModal
// below (each department's own self-serve view), so both render identically.
export const DepartmentSalesAnalysisView = ({ data, deptLabel, routeLabel }: { data: DeptAnalysis; deptLabel: string; routeLabel: string }) => (
  <div className="space-y-5">
    {/* Layer 1 — Collective */}
    <div className="rounded-[var(--radius-md)] border border-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.06)] p-3">
      <div className="text-[10px] text-[var(--color-accent-amber)] mb-2.5 uppercase font-bold tracking-wider">{deptLabel} — All Agents Combined</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">Total Sales</div>
          <div className="text-[15px] font-mono font-bold text-[var(--color-foreground)]">₦{fmt(data.collective.revenue)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">Total Collected</div>
          <div className="text-[15px] font-mono font-bold text-[var(--color-success)]">₦{fmt(data.collective.collected)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">Total Owed</div>
          <div className="text-[15px] font-mono font-bold text-[var(--color-error)]">₦{fmt(data.collective.owed)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">Agents / Entries</div>
          <div className="text-[15px] font-mono font-bold text-[var(--color-foreground)]">{data.collective.agentCount} / {data.collective.entries}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 pt-3 mt-3 border-t border-[var(--color-accent-amber)] border-opacity-30">
        <div>
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">Cash</div>
          <div className="text-[13px] font-mono font-bold text-[var(--color-foreground)]">₦{fmt(data.collective.cash)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">Transfer</div>
          <div className="text-[13px] font-mono font-bold text-[var(--color-foreground)]">₦{fmt(data.collective.transfer)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">POS/Card</div>
          <div className="text-[13px] font-mono font-bold text-[var(--color-foreground)]">₦{fmt(data.collective.pos)}</div>
        </div>
        {data.collective.wallet > 0 && (
          <div>
            <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">Wallet</div>
            <div className="text-[13px] font-mono font-bold text-[var(--color-foreground)]">₦{fmt(data.collective.wallet)}</div>
          </div>
        )}
      </div>
    </div>

    {data.agents.length === 0 ? (
      <div className="p-8 text-center bg-[var(--color-surface-card)] rounded-xl border border-dashed border-[var(--color-border)] text-[var(--color-muted)] text-[12px] font-mono">
        No {deptLabel.toLowerCase()} entries in this period.
      </div>
    ) : (
      <div className="space-y-2.5">
        {data.agents.map(s => (
          <div key={s.role} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider mb-0.5">Owed</div>
                <div className={`text-[16px] font-mono font-bold ${s.owed > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-muted)]'}`}>₦{fmt(s.owed)}</div>
              </div>
              <div className="text-right">
                <div className="text-[13px] font-bold text-[var(--color-foreground)]">{s.role}</div>
                <div className="text-[10px] text-[var(--color-muted)]">{s.entries} {s.entries === 1 ? 'entry' : 'entries'}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2 border-t border-[var(--color-border)] border-dashed">
              <div className="flex justify-between">
                <span className="text-[10px] text-[var(--color-muted)]">Sales Value</span>
                <span className="text-[11px] font-mono font-bold text-[var(--color-foreground)]">₦{fmt(s.revenue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[var(--color-muted)]">Collected</span>
                <span className="text-[11px] font-mono font-bold text-[var(--color-success)]">₦{fmt(s.collected)}</span>
              </div>
              {s.cash > 0 && (
                <div className="flex justify-between">
                  <span className="text-[10px] text-[var(--color-muted)]">Cash</span>
                  <span className="text-[11px] font-mono text-[var(--color-foreground)]">₦{fmt(s.cash)}</span>
                </div>
              )}
              {s.transfer > 0 && (
                <div className="flex justify-between">
                  <span className="text-[10px] text-[var(--color-muted)]">Transfer</span>
                  <span className="text-[11px] font-mono text-[var(--color-foreground)]">₦{fmt(s.transfer)}</span>
                </div>
              )}
              {s.pos > 0 && (
                <div className="flex justify-between">
                  <span className="text-[10px] text-[var(--color-muted)]">POS/Card</span>
                  <span className="text-[11px] font-mono text-[var(--color-foreground)]">₦{fmt(s.pos)}</span>
                </div>
              )}
              {s.wallet > 0 && (
                <div className="flex justify-between">
                  <span className="text-[10px] text-[var(--color-muted)]">Wallet</span>
                  <span className="text-[11px] font-mono text-[var(--color-foreground)]">₦{fmt(s.wallet)}</span>
                </div>
              )}
              {s.topRoute && (
                <div className="flex justify-between col-span-2">
                  <span className="text-[10px] text-[var(--color-muted)]">Top {routeLabel}</span>
                  <span className="text-[11px] font-mono font-bold text-[var(--color-foreground)]">{s.topRoute} ({s.topRouteCount})</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

// Self-serve entry point for department screens (Cargo/Marketing/Excess
// Baggage/Package) -- lets any agent working that desk pull the same
// collective + per-agent breakdown an admin sees in Reports > "X Sales
// Analysis", without needing access to the Reports screen itself (which
// stays admin/accountant-gated for its other, cross-department reports).
// Fullscreen on mobile, matching ReviewEntryModal's convention.
export const DepartmentSalesAnalysisModal = ({ user, deptType, deptLabel, routeLabel, onClose }: {
  user: User;
  deptType: DepartmentType;
  deptLabel: string;
  routeLabel: string;
  onClose: () => void;
}) => {
  const [preset, setPreset] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  const dateRange = useMemo(() => computeReportDateRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    fetchDepartmentSalesTransactions(deptType, user, dateRange)
      .then(data => { if (isMounted) setTxs(data); })
      .catch(err => console.error('Failed to fetch sales analysis', err))
      .finally(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [deptType, user, dateRange]);

  const analysis = useMemo(() => computeDepartmentSalesAnalysis(txs, deptType), [txs, deptType]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center sm:p-4">
      <div className="bg-[var(--color-obsidian)] border-0 sm:border border-[var(--color-border)] rounded-none sm:rounded-xl w-full h-full sm:h-auto sm:max-w-lg sm:max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[var(--color-border)] bg-[var(--color-surface-card)] shrink-0">
          <div className="flex items-center gap-2">
            <BarChart2 size={16} className="text-[var(--color-accent-amber)]" />
            <h3 className="text-[14px] font-bold font-sans text-[var(--color-foreground)] tracking-wide">{deptLabel} Sales Analysis</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[var(--color-surface-2)] rounded text-[var(--color-muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Period selector */}
        <div className="p-3 border-b border-[var(--color-border)] shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <Calendar size={12} className="text-[var(--color-accent-amber)]" />
            <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-accent-amber)] font-bold">Period</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(90px,1fr))] gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                className={`min-w-0 truncate px-2 py-1.5 text-[10px] font-mono border rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
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
              <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="ehi-input" />
              <input type="datetime-local" value={customTo}   onChange={e => setCustomTo(e.target.value)} className="ehi-input" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 size={24} className="animate-spin text-[var(--color-accent-amber)]" />
            </div>
          ) : (
            <DepartmentSalesAnalysisView data={analysis} deptLabel={deptLabel} routeLabel={routeLabel} />
          )}
        </div>
      </div>
    </div>
  );
};
