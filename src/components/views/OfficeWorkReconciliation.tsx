import { useState, useEffect, useMemo } from 'react';
import { Building2, Loader, CheckCircle2, RefreshCw } from 'lucide-react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { BackButton } from '../BackButton';
import { useToast } from '../../lib/ToastContext';
import { useConfirm } from '../../lib/ConfirmContext';
import { fmt } from '../../lib/helpers';

const norm = (s: string) => (s || '').trim().toUpperCase().replace(/\s+/g, ' ');

interface Client { id: string; company_name: string; }
interface Rate { corporate_client_id: string; route_name: string; rate_per_kg: number; minimum_amount: number | null; }
interface Candidate {
  entry_ref: string;
  consignee_name: string;
  route: string | null;
  total_kg: number;
  amount: number;
  amount_paid: number;
  retrieved_amount: number;
  receipt_mode: string;
  created_at: string;
  clientId: string;
  clientName: string;
  correctedAmount: number | null; // null = no rate configured for this route
  appliedRate: number | null;
  delta: number | null;
}

export const OfficeWorkReconciliation = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [debtOnly, setDebtOnly] = useState(true);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const load = async () => {
    setLoading(true);
    setSelected(new Set());
    const [{ data: clients }, { data: rates }] = await Promise.all([
      supabase.from('corporate_clients').select('id, company_name'),
      supabase.from('corporate_route_rates').select('corporate_client_id, route_name, rate_per_kg, minimum_amount'),
    ]);
    const clientList: Client[] = (clients as Client[]) || [];
    const rateList: Rate[] = (rates as Rate[]) || [];
    const byNorm = new Map<string, Client>();
    clientList.forEach(c => byNorm.set(norm(c.company_name), c));

    let q = supabase.from('cargo_entries')
      .select('entry_ref, consignee_name, route, total_kg, amount, amount_paid, retrieved_amount, receipt_mode, created_at')
      .is('corporate_client_id', null)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (debtOnly) q = q.eq('receipt_mode', 'Debt');
    const { data: rows, error } = await q;
    if (error) { showToast({ message: `Load failed: ${error.message}`, type: 'error' }); setLoading(false); return; }

    const out: Candidate[] = [];
    (rows || []).forEach((r: any) => {
      const client = byNorm.get(norm(r.consignee_name));
      if (!client) return; // exact match only — safe default
      const rate = rateList.find(rt => rt.corporate_client_id === client.id && rt.route_name === r.route);
      let correctedAmount: number | null = null;
      let appliedRate: number | null = null;
      if (rate) {
        appliedRate = Number(rate.rate_per_kg);
        correctedAmount = Math.max(Math.round(Number(r.total_kg) || 0) * appliedRate, Number(rate.minimum_amount) || 0);
      }
      out.push({
        entry_ref: r.entry_ref,
        consignee_name: r.consignee_name,
        route: r.route,
        total_kg: Number(r.total_kg) || 0,
        amount: Number(r.amount) || 0,
        amount_paid: Number(r.amount_paid) || 0,
        retrieved_amount: Number(r.retrieved_amount) || 0,
        receipt_mode: r.receipt_mode,
        created_at: r.created_at,
        clientId: client.id,
        clientName: client.company_name,
        correctedAmount,
        appliedRate,
        delta: correctedAmount == null ? null : correctedAmount - (Number(r.amount) || 0),
      });
    });
    setCandidates(out);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [debtOnly]);

  const repriceable = useMemo(() => candidates.filter(c => c.correctedAmount != null), [candidates]);
  const toggle = (ref: string) => setSelected(prev => { const n = new Set(prev); n.has(ref) ? n.delete(ref) : n.add(ref); return n; });
  const allSelected = repriceable.length > 0 && repriceable.every(c => selected.has(c.entry_ref));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(repriceable.map(c => c.entry_ref)));

  const selectedDelta = useMemo(
    () => candidates.filter(c => selected.has(c.entry_ref) && c.delta != null).reduce((s, c) => s + (c.delta || 0), 0),
    [candidates, selected]
  );

  const applySelected = async () => {
    const rows = candidates.filter(c => selected.has(c.entry_ref) && c.correctedAmount != null);
    if (rows.length === 0) return;
    const ok = await confirm({
      title: `Reconcile ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}?`,
      message: `This links each to its corporate client and reprices to the contract rate. Net change to outstanding debt: ${selectedDelta >= 0 ? '+' : ''}${fmt(selectedDelta)}. This cannot be auto-undone.`,
      confirmLabel: 'Yes, reconcile',
      tone: selectedDelta > 0 ? 'danger' : 'default',
    });
    if (!ok) return;
    setApplying(true);
    let done = 0, failed = 0;
    for (const c of rows) {
      const { error } = await supabase.rpc('reconcile_office_entry', {
        p_entry_ref: c.entry_ref,
        p_client_id: c.clientId,
        p_new_amount: c.correctedAmount,
        p_new_rate: c.appliedRate,
        p_logged_by: user.name || 'Unknown',
      });
      if (error) { failed++; } else { done++; }
    }
    setApplying(false);
    showToast({ message: `${done} reconciled${failed ? `, ${failed} failed` : ''}.`, type: failed ? 'warning' : 'success' });
    load();
  };

  return (
    <main className="flex-1 flex flex-col h-full bg-[var(--color-bg)] overflow-y-auto">
      <div className="bg-[var(--color-surface-card)] border-b border-[var(--color-border)] p-4">
        <BackButton onClick={onBack} label="Back to Menu" className="mb-3" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-[rgba(245,158,11,0.1)] rounded-lg"><Building2 size={20} className="text-[var(--color-accent-amber)]" /></div>
            <div className="min-w-0">
              <h1 className="text-[16px] font-bold text-[var(--color-foreground)] tracking-tight">Office Work Reconciliation</h1>
              <p className="text-[11px] font-mono text-[var(--color-muted)] mt-0.5">Unlinked entries whose consignee matches a corporate client</p>
            </div>
          </div>
          <button onClick={load} className="h-9 w-9 flex items-center justify-center rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-accent-amber)]" title="Refresh"><RefreshCw size={14} /></button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setDebtOnly(true)} className={`px-3 h-9 rounded-lg text-[11px] font-bold font-mono ${debtOnly ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-muted)]'}`}>Debt only</button>
          <button onClick={() => setDebtOnly(false)} className={`px-3 h-9 rounded-lg text-[11px] font-bold font-mono ${!debtOnly ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-muted)]'}`}>All modes</button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[12px] font-mono text-[var(--color-muted)] py-10 justify-center"><Loader size={16} className="animate-spin" /> Scanning entries…</div>
        ) : candidates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 size={28} className="text-[var(--color-success)]" />
            <div className="text-[13px] font-mono text-[var(--color-muted)]">No unlinked office-work entries found.</div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg px-3 py-2">
              <label className="flex items-center gap-2 text-[11px] font-mono text-[var(--color-muted)] cursor-pointer">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} /> Select all repriceable ({repriceable.length})
              </label>
              <div className="text-[11px] font-mono">
                <span className="text-[var(--color-muted)]">Net debt change: </span>
                <span className={selectedDelta > 0 ? 'text-[var(--color-error)] font-bold' : selectedDelta < 0 ? 'text-[var(--color-success)] font-bold' : 'text-[var(--color-muted)]'}>
                  {selectedDelta >= 0 ? '+' : ''}{fmt(selectedDelta)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {candidates.map(c => {
                const noRate = c.correctedAmount == null;
                return (
                  <div key={c.entry_ref} className={`rounded-lg border p-3 ${noRate ? 'border-[var(--color-border)] opacity-70' : selected.has(c.entry_ref) ? 'border-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.06)]' : 'border-[var(--color-border)] bg-[var(--color-surface-1)]'}`}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" disabled={noRate} checked={selected.has(c.entry_ref)} onChange={() => toggle(c.entry_ref)} className="mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] font-bold text-[var(--color-foreground)]">{c.consignee_name}</span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[rgba(139,92,246,0.12)] text-[#a78bfa] uppercase">{c.clientName}</span>
                          <span className="text-[9px] font-mono text-[var(--color-muted)]">{c.receipt_mode}</span>
                        </div>
                        <div className="text-[10px] font-mono text-[var(--color-muted)] mt-0.5">{c.entry_ref} · {c.route || '—'} · {Math.round(c.total_kg)}kg · {new Date(c.created_at).toLocaleDateString('en-GB')}</div>
                        {noRate ? (
                          <div className="text-[10px] font-mono text-[var(--color-accent-amber)] mt-1">No contract rate for "{c.route}" — configure it in Pricing, then refresh.</div>
                        ) : (
                          <div className="flex items-center gap-2 mt-1 text-[11px] font-mono">
                            <span className="text-[var(--color-muted)]">{fmt(c.amount)}</span>
                            <span className="text-[var(--color-muted)]">→</span>
                            <span className="text-[var(--color-foreground)] font-bold">{fmt(c.correctedAmount!)}</span>
                            <span className="text-[9px]">@ ₦{c.appliedRate}/kg</span>
                            <span className={(c.delta || 0) > 0 ? 'text-[var(--color-error)]' : (c.delta || 0) < 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-muted)]'}>
                              ({(c.delta || 0) >= 0 ? '+' : ''}{fmt(c.delta || 0)})
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={applySelected}
              disabled={applying || selected.size === 0}
              className="w-full h-11 rounded-lg bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[12px] font-bold font-mono disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {applying ? <><Loader size={14} className="animate-spin" /> Reconciling…</> : `Reconcile ${selected.size} selected`}
            </button>
          </>
        )}
      </div>
    </main>
  );
};
