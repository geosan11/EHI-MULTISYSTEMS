import React, { useState, useEffect, useMemo } from 'react';
import { Transaction, User } from '../../lib/types';
import { fmt, tnow } from '../../lib/helpers';
import { ChevronDown, ChevronUp, Printer, Plus, HandCoins } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useToast } from '../../lib/ToastContext';
import { clearDebt } from '../../lib/debt';
import { supabase } from '../../lib/supabase';

export const DebtorsTab = ({
  transactions = [],
  user,
  onUpdateTx,
  onAddTx,
}: {
  transactions?: Transaction[];
  user?: User;
  onUpdateTx?: (tx: Transaction) => void;
  onAddTx?: (tx: Transaction) => void;
}) => {
  const { showToast } = useToast();
  const [filter, setFilter] = useState<'All' | 'Corporate' | 'Individual'>('All');
  const [sort, setSort] = useState<'Highest Amount' | 'Oldest First' | 'Newest First' | 'Alphabetical'>('Highest Amount');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [showPaymentForm, setShowPaymentForm] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');
  const [paymentBank, setPaymentBank] = useState('');

  const [statementPrint, setStatementPrint] = useState<Transaction | null>(null);
  const [submittingPaymentId, setSubmittingPaymentId] = useState<string | null>(null);

  // This screen only ever received the `transactions` prop, which
  // EHIApp.tsx's fetchInitial windows to `globalDateRange` (defaults to
  // the last 7 days, in-memory only -- resets on every login/reload). A
  // debt logged 10 days ago was simply never fetched, so it silently
  // vanished from the debtor list for anyone who hadn't manually widened
  // the date range elsewhere in their current session. A debtor screen
  // inherently needs every outstanding debt regardless of when it was
  // entered, so this does its own dedicated, date-unbounded fetch --
  // filtered server-side to Debt-mode rows only (a small slice of the
  // full ledger), so it doesn't reintroduce the "All Time" filter's
  // known 5000-row-cap performance problem. RLS scopes this the same way
  // it scopes every other query (sibling-hub visibility / unrestricted
  // roles) -- no manual hub filter needed here.
  const [fetchedDebts, setFetchedDebts] = useState<Transaction[]>([]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [cargoRes, baggageRes, marketingRes, packageRes] = await Promise.all([
          supabase.from('cargo_entries').select('*').eq('receipt_mode', 'Debt').order('created_at', { ascending: false }).limit(1000),
          supabase.from('manifests').select('*').eq('payment_mode', 'Debt').order('created_at', { ascending: false }).limit(1000),
          supabase.from('marketing_entries').select('*').eq('payment_mode', 'Debt').order('created_at', { ascending: false }).limit(1000),
          supabase.from('package_entries').select('*').eq('payment_mode', 'Debt').order('created_at', { ascending: false }).limit(1000),
        ]);
        const mapped: Transaction[] = [];
        (cargoRes.data || []).forEach((r: any) => mapped.push({
          id: r.entry_ref || r.id, name: r.consignee_name || 'Cargo', detail: `${r.airline || ''} · ${r.awb_tag_number || ''}`,
          amount: r.amount || 0, amountPaid: r.amount_paid || 0, paymentHistory: r.payment_history || [], mode: 'Debt',
          time: r.created_at, created_at: r.created_at, type: 'cargo', awb_tag_number: r.awb_tag_number, status: r.status || 'Intake',
          airline: r.airline, hub_id: r.hub_id, hub: r.hub, clientType: r.client_type, corporate_client_id: r.corporate_client_id,
          consigneePhone: r.consignee_phone, raw: r,
        } as Transaction));
        (baggageRes.data || []).forEach((r: any) => mapped.push({
          id: r.transaction_id || r.id, name: r.passenger_name || 'Passenger', detail: `${r.flight_no || ''}`,
          amount: r.amount || 0, amountPaid: r.amount_paid || 0, paymentHistory: r.payment_history || [], mode: 'Debt',
          time: r.created_at, created_at: r.created_at, type: 'baggage', status: r.status || 'Intake',
          hub_id: r.hub_id, hub: r.hub, clientType: r.client_type, consigneePhone: r.passenger_phone, raw: r,
        } as Transaction));
        (marketingRes.data || []).forEach((r: any) => mapped.push({
          id: r.entry_ref || r.id, name: r.customer_name || 'Customer', detail: `${r.route || ''}`,
          amount: r.amount_paid || 0, amountPaid: r.debt_amount_paid || 0, paymentHistory: r.payment_history || [], mode: 'Debt',
          time: r.created_at, created_at: r.created_at, type: 'marketing', status: r.status || 'Intake',
          hub_id: r.hub_id, hub: r.hub, clientType: r.client_type, consigneePhone: r.customer_phone, raw: r,
        } as Transaction));
        (packageRes.data || []).forEach((r: any) => mapped.push({
          id: r.entry_ref || r.id, name: r.customer_name || 'Customer', detail: `${r.destination || ''}`,
          amount: r.amount || 0, amountPaid: r.amount_paid || 0, paymentHistory: r.payment_history || [], mode: 'Debt',
          time: r.created_at, created_at: r.created_at, type: 'package', status: r.status || 'Intake',
          hub_id: r.hub_id, hub: r.hub, consigneePhone: r.customer_phone, raw: r,
        } as Transaction));
        if (active) setFetchedDebts(mapped);
      } catch { /* keep whatever's already in the transactions prop */ }
    })();
    return () => { active = false; };
  }, []);

  // Merge the dedicated fetch with the live, realtime-updated `transactions`
  // prop -- the prop wins on a shared id (it reflects any edit/payment made
  // this session), the fetch only fills in debts the prop's date window
  // never included.
  const debtSource = useMemo(() => {
    const byId = new Map<string, Transaction>();
    fetchedDebts.forEach(t => byId.set(t.id, t));
    transactions.forEach(t => byId.set(t.id, t));
    return Array.from(byId.values());
  }, [transactions, fetchedDebts]);

  // Compute real aging from the transaction's created_at timestamp
  const realAgeInDays = (t: any): number => {
    if (!t.created_at) return 0;
    const created = new Date(t.created_at).getTime();
    if (isNaN(created)) return 0;
    return Math.max(0, Math.floor((Date.now() - created) / 86400000));
  };

  const debts = debtSource
    .filter(t => t.mode === 'Debt' || t.mode?.includes('Debt'))
    .map(t => {
      const ageInDays = realAgeInDays(t);
      let bucket: 'current' | 'overdue' | 'critical' | 'writeoff-risk' = 'current';
      if (ageInDays > 90) bucket = 'writeoff-risk';
      else if (ageInDays > 60) bucket = 'critical';
      else if (ageInDays > 30) bucket = 'overdue';

      return {
        ...t,
        // Prefer the value set at entry time; otherwise classify off the
        // real corporate_client_id link rather than matching a hardcoded
        // list of client names (which silently misclassified any corporate
        // client not on that list, and never updated as new ones onboarded).
        clientType: t.clientType || (t.corporate_client_id ? 'Corporate' : 'Individual'),
        ageInDays,
        agingBucket: bucket,
        balance: t.amount - (t.amountPaid || 0) - ((t.raw as any)?.retrieved_amount || 0),
      };
    })
    .filter(d => d.balance > 0);

  let visibleDebts = debts;
  if (filter !== 'All') {
    visibleDebts = debts.filter(d => d.clientType === filter);
  }

  visibleDebts.sort((a, b) => {
    if (sort === 'Highest Amount') return b.balance - a.balance;
    if (sort === 'Oldest First') return b.ageInDays - a.ageInDays;
    if (sort === 'Newest First') return a.ageInDays - b.ageInDays;
    return a.name.localeCompare(b.name);
  });

  const totalOutstanding = visibleDebts.reduce((sum, d) => sum + d.balance, 0);

  const buckets = {
    current: debts.filter(d => d.agingBucket === 'current'),
    overdue: debts.filter(d => d.agingBucket === 'overdue'),
    critical: debts.filter(d => d.agingBucket === 'critical'),
    writeoff: debts.filter(d => d.agingBucket === 'writeoff-risk'),
  };

  const getBucketColor = (bucket: string) => {
    switch(bucket) {
      case 'current': return 'text-[var(--color-success)] bg-[rgba(16,185,129,0.1)] border-[var(--color-success)]';
      case 'overdue': return 'text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.1)] border-[var(--color-accent-amber)]';
      case 'critical': return 'text-[#ea580c] bg-[rgba(234,88,12,0.1)] border-[#ea580c]'; // orange-600
      case 'writeoff-risk': return 'text-[var(--color-error)] bg-[rgba(239,68,68,0.1)] border-[var(--color-error)]';
      default: return 'text-[var(--color-muted)]';
    }
  };

  const getBucketDot = (bucket: string) => {
    switch(bucket) {
      case 'current': return 'bg-[var(--color-success)]';
      case 'overdue': return 'bg-[var(--color-accent-amber)]';
      case 'critical': return 'bg-[#ea580c]';
      case 'writeoff-risk': return 'bg-[var(--color-error)]';
      default: return 'bg-gray-500';
    }
  };

  const handleRecordPayment = async (id: string) => {
    // Synchronous, first line -- this Confirm button previously had zero
    // double-submit protection (unlike every other submit path in the
    // app), so a double-click/fast-tap could fire two clearDebt() calls
    // for one physical payment; each independently passed the RPC's own
    // "doesn't exceed remaining" guard for a PARTIAL payment (only a full
    // payoff gets caught by that), double-deducting the debt and
    // double-emitting the shadow ledger record below.
    if (submittingPaymentId) return;
    const debt = debts.find(d => d.id === id);
    if (!debt) return;
    const paidNow = parseFloat(paymentAmount);
    if (!paidNow || paidNow <= 0) {
      showToast({ message: 'Enter a payment amount greater than zero.', type: 'warning' });
      return;
    }
    setSubmittingPaymentId(id);
    try {
      const cappedPaid = Math.min(paidNow, debt.balance);
      const remaining = debt.balance - cappedPaid;

      // 1. Update the original debt entry via clear_*_debt (see
      // src/lib/debt.ts) instead of the generic onUpdateTx path -- that
      // path's plain UPDATE is hub-locked and silently affects 0 rows (no
      // error) when the debtor belongs to a sibling hub the agent can see
      // but doesn't own, which used to show "recorded" regardless of
      // whether the database actually changed.
      const result = await clearDebt({
        type: (debt as any).type,
        id,
        paymentAmount: cappedPaid,
        paymentMode,
        bank: paymentMode === 'Transfer' ? paymentBank : undefined,
        loggedBy: user?.name || 'Unknown',
        // Server re-validates this against the just-locked row and rejects
        // a stale/duplicate call instead of silently double-applying it.
        expectedRemaining: debt.balance,
      });

      if (!result.ok) {
        showToast({ message: result.error || 'Failed to record payment.', type: 'error' });
        return;
      }

      // 2. Emit a visible debt-clearance shadow transaction so today's
      //    ledger and EOD show this collection separately from new sales.
      //    Without this, the cash arrives in the till but the system cannot
      //    explain it — staff write "unexplained excess" in every variance
      //    reason. The shadow entry carries the full context the accountant needs.
      if (onAddTx) {
        const shadowTx: Transaction = {
          id: `DC-${Date.now()}-${id.slice(-6)}`,
          name: debt.name,
          // Kept short and un-delimited on purpose -- EHIApp.tsx's
          // handleAddTx positionally parses a cargo/marketing entry's
          // `detail` (airline · awb · pcs · kg · route · content) as a
          // fallback for its structured columns, and cargo_entries doesn't
          // persist `detail` verbatim at all (it's rebuilt from those
          // columns on every fetch) -- a multi-segment summary here either
          // got discarded on refresh or, worse, corrupted route/awb/content
          // with fragments of this text. The full breakdown goes in
          // `remarks` instead, which genuinely round-trips.
          detail: 'DEBT CLEARANCE',
          remarks: `${(debt as any).awb_tag_number ? `AWB: ${(debt as any).awb_tag_number} · ` : ''}Orig: ${fmt(debt.amount)} · Paid: ${fmt(cappedPaid)} · Bal: ${fmt(remaining)} · Age: ${debt.ageInDays}d`,
          amount: cappedPaid,
          mode: paymentMode,
          // Never set before -- EHIApp.tsx's handleAddTx falls back to
          // parsing this shadow entry's own `detail` string for cargo
          // (yielding the literal "DEBT CLEARANCE" as the airline) or to a
          // hardcoded 'ValueJet' for baggage when tx.airline is undefined,
          // polluting AirlinePerformance/Analytics airline groupings with
          // fake or misattributed revenue for every cleared debt. This is
          // real money collected for the original airline/route, so it
          // should count there, not toward a bogus bucket.
          airline: (debt as any).airline,
          bank: paymentMode === 'Transfer' ? paymentBank : undefined,
          time: tnow(),
          created_at: new Date().toISOString(),
          // Was hardcoded 'cargo' regardless of the debt's real type -- the
          // RPC call above already uses (debt as any).type correctly (it
          // routes to the matching clear_*_debt function), but this shadow
          // receipt didn't, so clearing a baggage/marketing/package debt
          // wrote its receipt into cargo_entries instead: parsed through
          // cargo's own detail-string format (garbled airline/route/awb),
          // and invisible under any type filter except "Cargo"/"All Types".
          type: (debt as any).type || 'cargo',
          status: 'Intake',
          is_debt_clearance: true,
          related_tx_id: id,
          clientType: (debt as any).clientType || 'Individual',
          enteredByName: user?.name || 'Unknown',
          // The original debt's own hub, not the clearing user's -- a
          // super_admin (or any hub-unrestricted role) clearing a debt on
          // behalf of a branch has their own hub_id, which is often a
          // different hub (or none at all). Stamping that instead of the
          // debt's real hub silently hid the clearance record from that
          // branch's own agents (RLS scopes them to their own hub_id), even
          // though the super_admin could always see it fine.
          hub_id: (debt as any).hub_id || user?.hub_id,
          hub: user?.hub,
        };
        onAddTx(shadowTx);
      }

      setShowPaymentForm(null);
      setPaymentAmount('');
      showToast({ message: `₦${cappedPaid.toLocaleString()} recorded. ${remaining > 0 ? `Balance: ${fmt(remaining)}` : 'Debt fully cleared.'}`, type: 'success' });
    } finally {
      // Guarantees the lock releases even if clearDebt()/onAddTx() throws
      // unexpectedly -- without this, an unhandled exception left the
      // Confirm button permanently disabled for this debtor until reload.
      setSubmittingPaymentId(null);
    }
  };

  return (
    <div className="space-y-6 pb-24">
      
      {statementPrint && (
        <div className="fixed inset-0 z-50 bg-[var(--color-obsidian)] flex flex-col p-4 overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <button onClick={() => setStatementPrint(null)} className="flex items-center space-x-2 bg-[var(--color-surface-1)] border border-[var(--color-border-strong)] px-4 py-2 rounded-lg text-[13px] font-sans font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)] transition-colors">
              <span>Close</span>
            </button>
             <button onClick={() => window.print()} className="flex items-center space-x-2 bg-[var(--color-surface-2)] px-4 py-2 rounded-lg text-[13px] font-sans font-medium text-[var(--color-foreground)]">
              <Printer size={16} />
              <span>Print / Export PDF</span>
            </button>
          </div>

          <div className="bg-white rounded p-8 text-black print:p-0 print:m-0 print:w-full print:shadow-none min-h-[A4]">
            <div className="flex justify-between items-start border-b border-gray-300 pb-6 mb-6">
              <div>
                <h1 className="text-[24px] font-sans font-black text-black leading-none tracking-tight">EHI MULTISYSTEMS</h1>
                <div className="text-[12px] font-sans text-gray-500 mt-1">Logistics Intelligence Platform</div>
                <div className="text-[12px] font-sans text-gray-600 mt-4">{user?.hub || 'HQ'} Hub Operations</div>
              </div>
              <div className="text-right">
                <div className="text-[18px] font-sans font-bold text-gray-800">STATEMENT OF ACCOUNT</div>
                <div className="text-[12px] font-sans text-gray-500 mt-1">Generated: {new Date().toLocaleDateString()}</div>
              </div>
            </div>

            <div className="mb-8">
              <div className="text-[12px] font-sans font-medium text-gray-500 uppercase tracking-wider mb-1">Prepared For</div>
              <div className="text-[18px] font-sans font-bold text-gray-900">{statementPrint.name}</div>
              <div className="text-[13px] font-sans text-gray-600 mt-1">Account Type: {statementPrint.clientType || 'Individual'}</div>
            </div>

            <div className="overflow-x-auto">
            <table className="w-full text-left font-sans mb-8 min-w-[500px]">
              <thead>
                <tr className="border-b-2 border-gray-800">
                  <th className="py-2 text-[12px] font-bold text-gray-800">Date</th>
                  <th className="py-2 text-[12px] font-bold text-gray-800">Description</th>
                  <th className="py-2 text-[12px] font-bold text-gray-800 text-right">Debit (₦)</th>
                  <th className="py-2 text-[12px] font-bold text-gray-800 text-right">Credit (₦)</th>
                  <th className="py-2 text-[12px] font-bold text-gray-800 text-right">Balance (₦)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-200">
                  <td className="py-3 text-[13px] text-gray-700">{statementPrint.time}</td>
                  <td className="py-3 text-[13px] text-gray-900">{statementPrint.detail}</td>
                  <td className="py-3 text-[13px] font-mono text-gray-900 text-right">{fmt(statementPrint.amount).replace('₦','')}</td>
                  <td className="py-3 text-[13px] font-mono text-gray-700 text-right">-</td>
                  <td className="py-3 text-[13px] font-mono font-medium text-gray-900 text-right">{fmt(statementPrint.amount).replace('₦','')}</td>
                </tr>
                {((statementPrint as any).paymentHistory || []).reduce((rows: React.JSX.Element[], p: { amount: number; mode: string; at: string; by?: string }, idx: number, arr: any[]) => {
                  const paidSoFar = arr.slice(0, idx + 1).reduce((s, x) => s + x.amount, 0);
                  const runningBalance = statementPrint.amount - paidSoFar;
                  rows.push(
                    <tr key={idx} className="border-b border-gray-200">
                      <td className="py-3 text-[13px] text-gray-700">{new Date(p.at).toLocaleDateString('en-GB')}</td>
                      <td className="py-3 text-[13px] text-gray-900">Payment received ({p.mode}){p.by ? ` — ${p.by}` : ''}</td>
                      <td className="py-3 text-[13px] font-mono text-gray-700 text-right">-</td>
                      <td className="py-3 text-[13px] font-mono text-gray-900 text-right">{fmt(p.amount).replace('₦','')}</td>
                      <td className="py-3 text-[13px] font-mono font-medium text-gray-900 text-right">{fmt(runningBalance).replace('₦','')}</td>
                    </tr>
                  );
                  return rows;
                }, [])}
              </tbody>
            </table>
            </div>

            <div className="flex justify-end mb-12">
              <div className="w-[300px]">
                <div className="flex justify-between py-2 border-b border-gray-200 text-[14px]">
                  <span className="font-sans font-medium text-gray-600">Total Outstanding:</span>
                  <span className="font-mono font-bold text-red-600">{fmt((statementPrint as any).balance ?? statementPrint.amount)}</span>
                </div>
              </div>
            </div>

            <div className="text-[11px] font-sans text-gray-500 italic text-center border-t border-gray-200 pt-4 mt-12">
              Payment is due within 30 days of service date. Please remit payment to EHI Multisystems accounts.
            </div>
          </div>
        </div>
      )}

      {/* SUMMARY HEADER */}
      <div className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-5">
        <div className="text-[13px] font-sans font-medium text-[var(--color-muted)] mb-1">Total Outstanding</div>
        <div className="text-[28px] font-mono font-bold text-[var(--color-error)] mb-6">{fmt(totalOutstanding)}</div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
           {([
             { label: 'Current', days: '0-30', bucket: 'current', data: buckets.current },
             { label: 'Overdue', days: '31-60', bucket: 'overdue', data: buckets.overdue },
             { label: 'Critical', days: '61-90', bucket: 'critical', data: buckets.critical },
             { label: 'Write-off Risk', days: '90+', bucket: 'writeoff-risk', data: buckets.writeoff }
           ] as const).map(b => (
             <div key={b.label} className={`border rounded-xl p-3 bg-opacity-10 border-opacity-30 ${getBucketColor(b.bucket)}`}>
               <div className="text-[11px] font-sans font-semibold uppercase tracking-wider mb-1 opacity-80">{b.label} <span className="opacity-60 lowercase font-normal ml-1">{b.days} days</span></div>
               <div className="text-[15px] font-mono font-bold">{fmt(b.data.reduce((sum,d)=>sum+d.balance,0))}</div>
               <div className="text-[11px] font-sans mt-0.5 opacity-70">{b.data.length} accounts</div>
             </div>
           ))}
        </div>
      </div>

      {user?.role === 'super_admin' && (
        <button className="w-full py-3.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-1)] text-[var(--color-foreground)] text-[14px] font-sans font-medium rounded-xl border border-[var(--color-border)] transition-colors focus:outline-none flex items-center justify-center space-x-2">
          <Plus size={16} />
          <span>Log Manual Credit Sale</span>
        </button>
      )}

      {/* FILTER & SORT BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex space-x-2 bg-[var(--color-surface-card)] p-1 rounded-xl border border-[var(--color-border)] w-max">
           {['All', 'Corporate', 'Individual'].map(f => (
             <button
               key={f}
               onClick={() => setFilter(f as any)}
               className={`px-4 py-1.5 rounded-full text-[12px] font-sans font-semibold transition-colors ${filter === f ? 'bg-[var(--color-accent-amber)] text-[#030712]' : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] border border-[var(--color-border)]'}`}
             >
               {f === 'Corporate' ? 'Office Work (B2B)' : f}
             </button>
           ))}
        </div>

        <select 
          value={sort}
          onChange={e => setSort(e.target.value as any)}
          className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl px-3 py-2 text-[12px] font-sans text-[var(--color-foreground)] focus:outline-none min-w-[150px]"
        >
          <option value="Highest Amount">Highest Amount</option>
          <option value="Oldest First">Oldest First</option>
          <option value="Newest First">Newest First</option>
          <option value="Alphabetical">Alphabetical</option>
        </select>
      </div>

      {/* DEBT LIST */}
      {visibleDebts.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 py-16 text-center bg-[var(--color-surface-card)] rounded-xl border border-dashed border-[var(--color-surface-2)]">
           <div className="w-12 h-12 rounded-full bg-[rgba(16,185,129,0.1)] flex items-center justify-center border border-[rgba(16,185,129,0.2)] mb-3">
             <div className="w-5 h-5 border-b-2 border-r-2 border-[var(--color-success)] transform rotate-45 mb-1" />
           </div>
           <div className="text-[15px] font-sans font-medium text-[var(--color-foreground)] mb-1">No outstanding debts</div>
           <div className="text-[13px] font-sans text-[var(--color-muted)]">All accounts are settled and up to date.</div>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {visibleDebts.map(d => {
              const isExpanded = expandedId === d.id;
              
              return (
                <motion.div 
                  key={d.id}
                  layout="position"
                  className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] overflow-hidden"
                >
                  {/* COLLAPSED ROW */}
                  <div 
                    onClick={() => setExpandedId(isExpanded ? null : d.id)}
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center space-x-2 mb-1">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${getBucketDot(d.agingBucket)}`} />
                        <span className="text-[14px] font-sans font-bold text-[var(--color-foreground)] truncate">{d.name}</span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-medium uppercase tracking-wider bg-[var(--color-surface-2)] text-[var(--color-muted)] shrink-0">
                          {d.clientType}
                        </span>
                      </div>
                      <div className={`text-[11px] font-sans font-medium inline-block px-1.5 py-0.5 rounded border ${getBucketColor(d.agingBucket)}`}>
                        {d.ageInDays} days overdue
                      </div>
                    </div>
                    
                    <div className="pl-4 border-l border-[var(--color-border)] flex items-center gap-3">
                       <div className="flex flex-col items-end justify-center">
                         <span className="text-[16px] font-mono font-bold text-[var(--color-error)] mb-1">{fmt(d.balance)}</span>
                         <div className="text-[var(--color-muted)]">
                           {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                         </div>
                       </div>
                       
                       <button
                         title="Clear Debt"
                         onClick={(e) => {
                           e.stopPropagation();
                           setExpandedId(d.id);
                           setShowPaymentForm(d.id);
                         }}
                         className="p-2 rounded-full bg-[rgba(16,185,129,0.1)] text-[var(--color-success)] hover:bg-[var(--color-success)] hover:text-[#030712] transition-colors focus:outline-none"
                       >
                         <HandCoins size={18} />
                       </button>
                    </div>
                  </div>

                  {/* EXPANDED AREA */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-[var(--color-border)] bg-[rgba(0,0,0,0.2)]"
                      >
                        <div className="p-4 space-y-4">
                           {/* Details */}
                           <div className="grid grid-cols-2 gap-4">
                             <div>
                               <div className="text-[11px] font-sans text-[var(--color-muted)] mb-1">Service Detail</div>
                               <div className="text-[13px] font-sans text-[var(--color-foreground)]">{d.detail}</div>
                             </div>
                             <div>
                               <div className="text-[11px] font-sans text-[var(--color-muted)] mb-1">Original Date</div>
                               <div className="text-[13px] font-sans text-[var(--color-foreground)]">{d.time}</div>
                             </div>
                             {d.consigneePhone && (
                               <div>
                                 <div className="text-[11px] font-sans text-[var(--color-muted)] mb-1">Phone</div>
                                 <div className="text-[13px] font-sans text-[var(--color-foreground)]">{d.consigneePhone}</div>
                               </div>
                             )}
                           </div>

                           {/* Notes */}
                           <div>
                             <div className="text-[11px] font-sans text-[var(--color-muted)] mb-1">Notes</div>
                             <textarea 
                               placeholder="Add notes about this debt..."
                               className="w-full h-20 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-3 text-[13px] font-sans text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-cobalt)] transition-colors resize-none"
                             />
                           </div>

                           {/* Actions */}
                           <div className="flex space-x-2 pt-2 border-t border-[var(--color-border)]">
                             <button 
                               onClick={() => setShowPaymentForm(showPaymentForm === d.id ? null : d.id)}
                               className="flex-1 py-2.5 bg-[var(--color-surface-2)] text-[var(--color-success)] text-[13px] font-sans font-medium rounded-lg hover:bg-[var(--color-surface-1)] transition-colors focus:outline-none"
                             >
                               Record Payment
                             </button>
                             <button 
                               onClick={() => setStatementPrint(d as unknown as Transaction)}
                               className="flex-1 py-2.5 bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[13px] font-sans font-medium rounded-lg hover:bg-[var(--color-surface-1)] transition-colors focus:outline-none"
                             >
                               View Statement
                             </button>
                           </div>

                           {/* Mini Payment Form */}
                           <AnimatePresence>
                             {showPaymentForm === d.id && (
                               <motion.div 
                                 initial={{ height: 0, opacity: 0 }}
                                 animate={{ height: "auto", opacity: 1 }}
                                 exit={{ height: 0, opacity: 0 }}
                                 className="bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.2)] rounded-xl p-4 mt-3"
                               >
                                 <div className="text-[13px] font-sans font-semibold text-[var(--color-success)] mb-3">Post Payment</div>
                                 <div className="space-y-3">
                                   <div className="flex gap-3">
                                     <div className="flex-1">
                                       <label htmlFor={`payment-amount-${d.id}`} className="text-[11px] font-sans text-[var(--color-muted)] block mb-1">Amount ₦</label>
                                       <input
                                         id={`payment-amount-${d.id}`}
                                         name={`payment-amount-${d.id}`}
                                         type="number"
                                         min="0"
                                         value={paymentAmount}
                                         onChange={e => setPaymentAmount(e.target.value)}
                                         placeholder={d.balance.toString()}
                                         className="w-full h-10 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-lg px-3 text-[var(--color-foreground)] font-mono text-[14px] focus:outline-none focus:border-[var(--color-success)] focus:ring-1 focus:ring-[var(--color-success)]"
                                       />
                                     </div>
                                     <div className="flex-1">
                                       <label htmlFor={`payment-mode-${d.id}`} className="text-[11px] font-sans text-[var(--color-muted)] block mb-1">Mode</label>
                                       <select
                                         id={`payment-mode-${d.id}`}
                                         value={paymentMode}
                                         onChange={e => setPaymentMode(e.target.value as any)}
                                         className="w-full h-10 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-lg px-3 text-[var(--color-foreground)] font-sans text-[13px] focus:outline-none"
                                       >
                                         <option value="Cash">Cash</option>
                                         <option value="Transfer">Transfer</option>
                                         <option value="POS">POS</option>
                                       </select>
                                     </div>
                                   </div>
                                   
                                   <div className="flex justify-end pt-2">
                                     <button
                                       disabled={submittingPaymentId === d.id}
                                       onClick={() => handleRecordPayment(d.id)}
                                       className="bg-[var(--color-success)] text-[#0B0F19] px-6 py-2 rounded-lg text-[13px] font-sans font-bold hover:bg-opacity-90 transition-opacity focus:outline-none disabled:opacity-50"
                                     >
                                       {submittingPaymentId === d.id ? 'Saving...' : 'Confirm'}
                                     </button>
                                   </div>
                                 </div>
                               </motion.div>
                             )}
                           </AnimatePresence>

                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};
