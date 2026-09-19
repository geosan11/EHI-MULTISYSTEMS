import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Transaction, User } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { ChevronDown, ChevronUp, Printer, Plus, HandCoins } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useToast } from '../../lib/ToastContext';
import { useConfirm } from '../../lib/ConfirmContext';
import { clearDebt, DEBT_TABLE_NAME, DebtEntryType } from '../../lib/debt';
import { supabase, writeAuditLog } from '../../lib/supabase';
import { useHubNames } from '../../lib/hubRoutes';
import { useBanks } from '../../lib/banks';
import { isOfficeWorkEntry } from '../../lib/officeWork';
import { downloadBatchDebtReceipt } from './BatchDebtReceipt';
import { isDebtSettled, computeDebtDisplayModeFromRow, DebtEntryType as DebtDept } from '../../lib/debtStatus';

const DEBT_TABLE_BY_TYPE: Record<DebtDept, string> = {
  cargo: 'cargo_entries', baggage: 'manifests', marketing: 'marketing_entries', package: 'package_entries',
};
const DEBT_MODE_COL_BY_TYPE: Record<DebtDept, string> = {
  cargo: 'receipt_mode', baggage: 'payment_mode', marketing: 'payment_mode', package: 'payment_mode',
};

// Shared by the initial fetchedDebts load and its realtime channels below --
// one raw-row -> Transaction mapping per department, reused instead of
// duplicated per call site.
function mapDebtRow(r: any, type: DebtDept): Transaction {
  const base = {
    time: r.created_at, created_at: r.created_at, type, status: r.status || 'Intake',
    hub_id: r.hub_id, hub: r.hub, paymentHistory: r.payment_history || [], raw: r,
    mode: computeDebtDisplayModeFromRow(r, type),
  };
  if (type === 'cargo') {
    return {
      ...base, id: r.entry_ref || r.id, name: r.consignee_name || 'Cargo', detail: `${r.airline || ''}`,
      amount: r.amount || 0, amountPaid: r.amount_paid || 0, awb_tag_number: r.awb_tag_number,
      pieces: r.total_pcs, kg: r.total_kg, route: r.route,
      airline: r.airline, clientType: r.client_type, corporate_client_id: r.corporate_client_id,
      consigneePhone: r.consignee_phone,
    } as Transaction;
  }
  if (type === 'baggage') {
    return {
      ...base, id: r.transaction_id || r.id, name: r.passenger_name || 'Passenger', detail: `${r.flight_no || ''}`,
      amount: r.amount || 0, amountPaid: r.amount_paid || 0, clientType: r.client_type, consigneePhone: r.passenger_phone,
      pieces: r.total_pcs, kg: r.excess_kg, destination: r.destination,
    } as Transaction;
  }
  if (type === 'marketing') {
    return {
      ...base, id: r.entry_ref || r.id, name: r.customer_name || 'Customer', detail: `${r.route || ''}`,
      amount: r.amount_paid || 0, amountPaid: r.debt_amount_paid || 0, clientType: r.client_type, consigneePhone: r.customer_phone,
      awb_tag_number: r.awb_tag_number, route: r.route,
    } as Transaction;
  }
  return {
    ...base, id: r.entry_ref || r.id, name: r.customer_name || 'Customer', detail: `${r.destination || ''}`,
    amount: r.amount || 0, amountPaid: r.amount_paid || 0, consigneePhone: r.customer_phone,
    pieces: r.total_pcs || undefined, kg: r.total_kg || undefined, destination: r.destination,
  } as Transaction;
}

export const DebtorsTab = ({
  transactions = [],
  user,
  onUpdateTx,
}: {
  transactions?: Transaction[];
  user?: User;
  onUpdateTx?: (tx: Transaction) => void;
}) => {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const banks = useBanks();
  // hub_id -> name, for the DEBT_COLLECTION audit log's `hub` field below --
  // (debt as any).hub is unreliable (see useHubNames' own comment), so this
  // is the only way to reliably show the debt's REAL hub name rather than
  // falling through to the clearing user's own.
  const hubNames = useHubNames();
  const [filter, setFilter] = useState<'All' | 'Corporate' | 'Individual'>('All');
  const [sort, setSort] = useState<'Highest Amount' | 'Oldest First' | 'Newest First' | 'Alphabetical'>('Highest Amount');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [showPaymentForm, setShowPaymentForm] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');
  const [paymentBank, setPaymentBank] = useState('');

  const [statementPrint, setStatementPrint] = useState<Transaction | null>(null);
  const [submittingPaymentId, setSubmittingPaymentId] = useState<string | null>(null);

  // Bulk clear -- Office Work (B2B) only (see handleBulkClear's own
  // comment on why). Selection is dropped on any filter change so leaving
  // the Corporate tab can't leave a stale selection armed underneath a
  // different filter.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkClearing, setBulkClearing] = useState(false);
  // Starts (and resets to) empty rather than defaulting to 'Cash' -- see
  // the matching effect below. A silent default meant a staff member
  // could clear a debt without ever consciously choosing how it was
  // actually paid.
  const [bulkMode, setBulkMode] = useState<'Cash' | 'Transfer' | 'POS' | ''>('');
  const [bulkBank, setBulkBank] = useState('');
  useEffect(() => { setSelectedIds(new Set()); }, [filter]);
  // Forces a fresh, deliberate mode choice for every new batch -- fires
  // whenever the selection returns to empty (after a completed clear or
  // manually unchecking everything), not on every incremental checkbox
  // added to an already-in-progress selection.
  useEffect(() => { if (selectedIds.size === 0) setBulkMode(''); }, [selectedIds]);

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
        const mapped: Transaction[] = [
          ...(cargoRes.data || []).map((r: any) => mapDebtRow(r, 'cargo')),
          ...(baggageRes.data || []).map((r: any) => mapDebtRow(r, 'baggage')),
          ...(marketingRes.data || []).map((r: any) => mapDebtRow(r, 'marketing')),
          ...(packageRes.data || []).map((r: any) => mapDebtRow(r, 'package')),
        ];
        if (active) setFetchedDebts(mapped);
      } catch { /* keep whatever's already in the transactions prop */ }
    })();
    return () => { active = false; };
  }, []);

  // This screen only refetched on remount (e.g. leaving and returning to
  // the Credit Sales sub-tab) -- a debt collected or newly logged from
  // another agent's session/device never appeared here until then. Mirrors
  // EHIApp.tsx's own per-table realtime channel pattern; upserts by id into
  // fetchedDebts on INSERT/UPDATE so a debt just cleared elsewhere drops
  // out of the debtor list (via the balance/isDebtSettled check in `debts`
  // above) as soon as the event arrives, not on next remount.
  useEffect(() => {
    const upsert = (type: DebtDept) => (payload: any) => {
      const r = payload.new as any;
      const mapped = mapDebtRow(r, type);
      setFetchedDebts(prev => {
        const idx = prev.findIndex(t => t.id === mapped.id);
        if (idx === -1) {
          // The UPDATE subscription below is unfiltered (see comment
          // above), so it also delivers every non-Debt update state-wide
          // -- only start tracking a row here if it's actually Debt-mode.
          if (r[DEBT_MODE_COL_BY_TYPE[type]] !== 'Debt') return prev;
          return [mapped, ...prev];
        }
        const copy = prev.slice();
        copy[idx] = mapped;
        return copy;
      });
    };
    const types: DebtDept[] = ['cargo', 'baggage', 'marketing', 'package'];
    const channels = types.map(type =>
      supabase
        .channel(`ehi-debtors-${type}-live`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: DEBT_TABLE_BY_TYPE[type], filter: `${DEBT_MODE_COL_BY_TYPE[type]}=eq.Debt` }, upsert(type))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: DEBT_TABLE_BY_TYPE[type] }, upsert(type))
        .subscribe()
    );
    return () => { channels.forEach(c => supabase.removeChannel(c)); };
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

  const debts = useMemo(() => {
    return debtSource
      // Check the row's actual mode column, not the pre-computed display
      // string -- t.mode can now legitimately read 'Debt Paid' for a
      // settled debt sourced from the live `transactions` prop, and
      // `.includes('Debt')` would still match that string.
      .filter(t => ((t.raw as any)?.receipt_mode ?? (t.raw as any)?.payment_mode) === 'Debt')
      .map(t => {
        const ageInDays = realAgeInDays(t);
        let bucket: 'current' | 'overdue' | 'critical' | 'writeoff-risk' = 'current';
        if (ageInDays > 90) bucket = 'writeoff-risk';
        else if (ageInDays > 60) bucket = 'critical';
        else if (ageInDays > 30) bucket = 'overdue';

        const amt = Number(t.amount || 0);
        const amtPaid = Number(t.amountPaid || 0);
        const retrieved = Number((t.raw as any)?.retrieved_amount || 0);
        // Package's legacy debt_paid boolean settles the debt independently
        // of the amount/amountPaid arithmetic (see src/lib/debtStatus.ts) --
        // without this, a package debt cleared only via that flag showed
        // correctly as "Debt Paid" everywhere else but stayed listed here.
        const settled = isDebtSettled(amtPaid, retrieved, amt, (t.raw as any)?.debt_paid === true);

        return {
          ...t,
          // Shared classifier (src/lib/officeWork.ts) also used by
          // TransactionLedger.tsx/Analytics.tsx -- previously this screen
          // didn't check linked_as_office_work at all, and couldn't
          // recognize "office work" typed into a remark without a real
          // corporate-client link.
          clientType: (isOfficeWorkEntry(t) ? 'Corporate' : 'Individual') as 'Corporate' | 'Individual',
          ageInDays,
          agingBucket: bucket,
          balance: settled ? 0 : amt - amtPaid - retrieved,
        };
      })
      .filter(d => d.balance > 0);
  }, [debtSource]);

  // statementPrint is a value snapshot captured once at click time (see
  // setStatementPrint below) -- without this, a debt paid down/cleared
  // elsewhere while this statement was open kept showing the pre-payment
  // balance/history until manually closed and reopened, same bug class as
  // TransactionLedger.tsx's viewingDetail/clearDebtEntry.
  useEffect(() => {
    if (!statementPrint) return;
    const fresh = debts.find(d => d.id === statementPrint.id);
    if (fresh && fresh !== statementPrint) setStatementPrint(fresh as unknown as Transaction);
  }, [debts]);

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

  // Shared by handleRecordPayment (one debt) and handleBulkClear (many at
  // once) -- applies a successful clearDebt() result to local state and
  // writes its audit trail entry. Extracted so bulk-clear doesn't carry its
  // own second copy of this that could drift from the single-debt path.
  // Returns the amount still owed after this payment.
  const applyClearResult = (
    debt: (typeof debts)[number],
    cappedPaid: number,
    mode: 'Cash' | 'Transfer' | 'POS',
    result: Awaited<ReturnType<typeof clearDebt>>
  ): number => {
    const remaining = debt.balance - cappedPaid;

    // Optimistically update the original transaction in global state
    let updatedTx: Transaction | null = null;
    if (onUpdateTx) {
      const stillOwed = result.remainingBalance ?? remaining;
      const fullyPaid = result.fullyPaid ?? (stillOwed <= 0);
      const historyEntry = {
        amount: cappedPaid,
        mode,
        by: user?.name || 'Unknown',
        at: new Date().toISOString()
      };
      updatedTx = {
        ...debt,
        amountPaid: result.newAmountPaid ?? ((debt.amountPaid || 0) + cappedPaid),
        paymentHistory: [...(debt.paymentHistory || []), historyEntry],
        // result.newMode is clear_*_debt's own real final value -- trust it
        // over an assumed 'Debt Paid' the same way newAmountPaid just above
        // trusts the RPC's own total. Without this, onUpdateTx's redundant
        // write right after this call overwrote a same-shift Individual
        // reclassification (receipt_mode/payment_mode rewritten to the real
        // payment mode) back to plain 'Debt' a moment after the RPC set it
        // correctly -- see 20260948_clear_debt_return_final_mode.sql.
        mode: fullyPaid ? (result.newMode || 'Debt Paid') : 'Debt',
        paymentConfirmed: fullyPaid,
        confirmedBy: fullyPaid ? (user?.name || 'Unknown') : debt.confirmedBy,
        confirmedAt: fullyPaid ? new Date().toISOString() : debt.confirmedAt,
        ...(debt.type === 'package' && fullyPaid ? {
          debtPaid: true,
          debtPaidAt: new Date().toISOString()
        } : {})
      };
      onUpdateTx(updatedTx);
    }
    // handleUpdateTx's setTransactions(prev => prev.map(...)) in
    // EHIApp.tsx is a no-op for any debt whose id isn't already in the
    // `transactions` prop -- true for most aged debts, since this screen's
    // whole reason for a separate `fetchedDebts` fetch (see the effect
    // above) is that they fall outside the app's default 7-day
    // globalDateRange window. Updating fetchedDebts directly here
    // guarantees `debts` (and therefore `visibleDebts`) recomputes and
    // drops/adjusts this debt immediately, regardless of whether EHIApp's
    // own transactions array had it.
    if (updatedTx) {
      const finalTx = updatedTx;
      setFetchedDebts(prev => prev.map(d => d.id === debt.id ? { ...d, ...finalTx } : d));
    }

    // Record this collection in the audit trail -- see src/lib/debt.ts's
    // own comment on why this reads straight off the original entry's
    // payment_history instead of a second synthetic "DC-..." row.
    // hubNames resolves the debt's real hub_id to its real name (debt.hub
    // is unreliable) so a super_admin clearing a sibling branch's debt
    // still attributes it correctly.
    writeAuditLog({
      user_id: user?.id, user_name: user?.name || 'Unknown', action: 'DEBT_COLLECTION',
      table_name: DEBT_TABLE_NAME[(debt as any).type as DebtEntryType], record_id: debt.id,
      description: `₦${fmt(cappedPaid)} collected against ${debt.name}'s debt via ${mode}${remaining > 0 ? ` (₦${fmt(remaining)} still owed)` : ' (fully cleared)'}`,
      hub: hubNames[(debt as any).hub_id] || (debt as any).hub || user?.hub,
      hub_id: (debt as any).hub_id || user?.hub_id,
      old_values: { amount_paid: debt.amountPaid || 0 },
      new_values: { amount_paid: result.newAmountPaid, mode, amount: cappedPaid },
    }).catch(() => {});

    return remaining;
  };

  const handleRecordPayment = async (id: string) => {
    // Synchronous, first line -- this Confirm button previously had zero
    // double-submit protection (unlike every other submit path in the
    // app), so a double-click/fast-tap could fire two clearDebt() calls
    // for one physical payment; each independently passed the RPC's own
    // "doesn't exceed remaining" guard for a PARTIAL payment (only a full
    // payoff gets caught by that), double-deducting the debt.
    if (submittingPaymentId) return;
    const debt = debts.find(d => d.id === id);
    if (!debt) return;
    const paidNow = parseFloat(paymentAmount);
    if (!paidNow || paidNow <= 0) {
      showToast({ message: 'Enter a payment amount greater than zero.', type: 'warning' });
      return;
    }
    // paymentBank had no input anywhere in this screen -- every Transfer
    // payment silently sent bank: undefined to clearDebt with nothing ever
    // prompting for one. Mirrors the same guard TransactionLedger.tsx's
    // confirmClearDebt already has for its own Transfer clearance flow.
    if (paymentMode === 'Transfer' && !paymentBank.trim()) {
      showToast({ message: 'Select the bank for this transfer payment.', type: 'warning' });
      return;
    }
    setSubmittingPaymentId(id);
    try {
      const cappedPaid = Math.min(paidNow, debt.balance);

      // Update the original debt entry via clear_*_debt (see
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

      const remaining = applyClearResult(debt, cappedPaid, paymentMode, result);

      setShowPaymentForm(null);
      setPaymentAmount('');
      showToast({ message: `₦${cappedPaid.toLocaleString()} recorded. ${remaining > 0 ? `Balance: ${fmt(remaining)}` : 'Debt fully cleared.'}`, type: 'success' });
    } finally {
      // Guarantees the lock releases even if clearDebt() throws
      // unexpectedly -- without this, an unhandled exception left the
      // Confirm button permanently disabled for this debtor until reload.
      setSubmittingPaymentId(null);
    }
  };

  // Both batch actions below require a single customer per batch -- a
  // combined receipt only makes sense under one name, and batch-clearing
  // several unrelated customers' debts in one click is exactly the
  // accidental-mass-clear risk per-customer batching is meant to avoid.
  const notifySameCustomerRequired = (selected: Transaction[]): boolean => {
    if (new Set(selected.map(d => d.name)).size > 1) {
      showToast({ message: 'Selected transactions are not for the same customer -- batch print/clear requires everything selected to belong to one customer.', type: 'warning' });
      return false;
    }
    return true;
  };

  // Bulk-clears every currently-selected debt for its full remaining
  // balance in one action -- a customer (corporate or an individual with
  // several outstanding routes/shipments) settling multiple debts in one
  // payment previously meant clicking Confirm separately on every row.
  // Available on every filter tab (All/Corporate/Individual) -- originally
  // Corporate-only, but that hid the checkboxes/buttons entirely on the
  // default "All" view, which read as "the feature is missing." The
  // confirm dialog's count/total display is the safety net against a
  // misclick, the same one already relied on when this was Corporate-only.
  const handleBulkClear = async () => {
    if (bulkClearing || selectedIds.size === 0) return;
    // Belt-and-suspenders on top of the button's own disabled state -- the
    // mode is required, not defaulted, specifically so a batch clear can
    // never go through without a staff member consciously picking it.
    if (!bulkMode) {
      showToast({ message: 'Select a payment mode before clearing.', type: 'warning' });
      return;
    }
    const selected = visibleDebts.filter(d => selectedIds.has(d.id));
    if (!notifySameCustomerRequired(selected)) return;
    if (bulkMode === 'Transfer' && !bulkBank.trim()) {
      showToast({ message: 'Select the bank for this transfer payment.', type: 'warning' });
      return;
    }
    const total = selected.reduce((sum, d) => sum + d.balance, 0);
    const ok = await confirm({
      title: 'Clear selected debts?',
      message: `This clears ${selected.length} office-work debt${selected.length === 1 ? '' : 's'} totalling ₦${fmt(total)} via ${bulkMode}. This cannot be undone.`,
      confirmLabel: `Clear ${selected.length} Debt${selected.length === 1 ? '' : 's'}`,
      tone: 'danger',
    });
    if (!ok) return;

    setBulkClearing(true);
    try {
      // Parallel dispatch -- same pattern TransactionLedger.tsx's
      // selectAllCash already uses for bulk actions. Each clearDebt() call
      // is independently row-locked and expectedRemaining-guarded, and
      // clear_*_debt's `accumulated_monthly_debt = accumulated_monthly_debt
      // - x` update is a single atomic UPDATE, so two selected debts
      // belonging to the same corporate client are safe to clear
      // concurrently -- Postgres serializes same-row updates on its own.
      const results = await Promise.all(selected.map(async (debt) => {
        const result = await clearDebt({
          type: (debt as any).type,
          id: debt.id,
          paymentAmount: debt.balance,
          paymentMode: bulkMode,
          bank: bulkMode === 'Transfer' ? bulkBank : undefined,
          loggedBy: user?.name || 'Unknown',
          expectedRemaining: debt.balance,
        });
        return { debt, result };
      }));

      let cleared = 0;
      let clearedTotal = 0;
      let failed = 0;
      results.forEach(({ debt, result }) => {
        if (!result.ok) { failed++; return; }
        applyClearResult(debt, debt.balance, bulkMode, result);
        cleared++;
        clearedTotal += debt.balance;
      });

      setSelectedIds(new Set());
      if (failed === 0) {
        showToast({ message: `${cleared} debt${cleared === 1 ? '' : 's'} cleared (₦${fmt(clearedTotal)}).`, type: 'success' });
      } else {
        showToast({ message: `${cleared} of ${selected.length} debts cleared (₦${fmt(clearedTotal)}). ${failed} failed -- their balances may have changed, refresh and retry.`, type: 'warning' });
      }
    } finally {
      setBulkClearing(false);
    }
  };

  // Independent of handleBulkClear -- printable before or after clearing,
  // for whichever order the agent works in. Combines every selected debt
  // into ONE receipt (one customer name, every route/ref listed, a single
  // total) instead of printing one mini-receipt per debt.
  const handleBatchPrintReceipt = async () => {
    const selected = visibleDebts.filter(d => selectedIds.has(d.id));
    if (selected.length === 0) return;
    // Same requirement as clearing -- a receipt claiming a payment was
    // made needs to say how, not a vague placeholder.
    if (!bulkMode) {
      showToast({ message: 'Select a payment mode before printing.', type: 'warning' });
      return;
    }
    if (!notifySameCustomerRequired(selected)) return;
    const items = selected.map(d => ({
      ref: d.id,
      route: (d.type === 'baggage' || d.type === 'package')
        ? ((d.raw as any)?.destination || '')
        : ((d.raw as any)?.route || ''),
      type: d.type,
      amount: d.balance,
      tagNumber: d.awb_tag_number,
      pieces: d.pieces,
      kg: d.kg,
      time: d.time,
    }));
    try {
      await downloadBatchDebtReceipt({
        batchRef: `BATCH-${Date.now()}`,
        date: new Date().toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }),
        agentName: user?.name || 'Unknown',
        customerName: selected[0].name,
        customerPhone: selected[0].consigneePhone,
        items,
        totalAmount: items.reduce((s, i) => s + i.amount, 0),
        // Guaranteed non-empty by the guard above.
        paymentMode: bulkMode,
        bankName: bulkMode === 'Transfer' ? bulkBank : undefined,
      });
    } catch (err: any) {
      showToast({ message: err?.message || 'Failed to generate batch receipt.', type: 'error' });
    }
  };

  // Belt-and-suspenders on top of the statementPrint resync effect above: a
  // realtime event can still be in flight at the exact click moment. Re-
  // fetches this one row immediately before printing so a statement never
  // shows a stale balance/payment history. Falls back to the in-memory
  // value (possibly stale, e.g. offline) if this fetch doesn't come back.
  const handlePrintStatement = async () => {
    if (!statementPrint) return;
    const deptType = (statementPrint as any).type as DebtEntryType;
    const idCol = deptType === 'baggage' ? 'transaction_id' : 'entry_ref';
    try {
      const { data: freshRow } = await supabase
        .from(DEBT_TABLE_NAME[deptType])
        .select('*')
        .eq(idCol, statementPrint.id)
        .maybeSingle();
      if (freshRow) {
        const amt = deptType === 'marketing' ? Number(freshRow.amount_paid || 0) : Number(freshRow.amount || 0);
        const amtPaid = deptType === 'marketing' ? Number(freshRow.debt_amount_paid || 0) : Number(freshRow.amount_paid || 0);
        const retrieved = Number(freshRow.retrieved_amount || 0);
        const settled = isDebtSettled(amtPaid, retrieved, amt, deptType === 'package' && freshRow.debt_paid === true);
        setStatementPrint({
          ...statementPrint,
          amount: amt,
          amountPaid: amtPaid,
          paymentHistory: freshRow.payment_history || [],
          raw: freshRow,
          balance: settled ? 0 : amt - amtPaid - retrieved,
        } as any);
      }
    } catch { /* offline or fetch failed -- print with what we already have */ }
    window.print();
  };

  return (
    <div className="space-y-6 pb-24">
      
      {statementPrint && createPortal(
        <div className="fixed inset-0 z-50 bg-[var(--color-obsidian)] flex flex-col p-4 overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <button onClick={() => setStatementPrint(null)} className="flex items-center space-x-2 bg-[var(--color-surface-1)] border border-[var(--color-border-strong)] px-4 py-2 rounded-lg text-[13px] font-sans font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)] transition-colors">
              <span>Close</span>
            </button>
             <button onClick={handlePrintStatement} className="flex items-center space-x-2 bg-[var(--color-surface-2)] px-4 py-2 rounded-lg text-[13px] font-sans font-medium text-[var(--color-foreground)]">
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
        </div>,
        document.body
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
             <div key={b.label} className={`border rounded-xl p-3 ${getBucketColor(b.bucket)}`}>
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
               className={`px-4 py-1.5 rounded-full text-[12px] font-sans font-semibold transition-colors ${filter === f ? 'bg-[var(--color-accent-amber)] text-[var(--color-on-accent)]' : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] border border-[var(--color-border)]'}`}
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

      {/* BULK CLEAR BAR -- available on every filter tab, including All */}
      {visibleDebts.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-3">
          <label className="flex items-center gap-2 text-[12px] font-sans font-semibold text-[var(--color-foreground)] cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={selectedIds.size > 0 && selectedIds.size === visibleDebts.length}
              onChange={(e) => setSelectedIds(e.target.checked ? new Set(visibleDebts.map(d => d.id)) : new Set())}
              className="w-4 h-4 cursor-pointer"
            />
            Select All ({visibleDebts.length})
          </label>

          {selectedIds.size > 0 && (
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <span className="text-[12px] font-mono font-bold text-[var(--color-foreground)]">
                {selectedIds.size} selected · ₦{fmt(visibleDebts.filter(d => selectedIds.has(d.id)).reduce((s, d) => s + d.balance, 0))}
              </span>
              <select
                value={bulkMode}
                onChange={e => setBulkMode(e.target.value as any)}
                className={`bg-[var(--color-surface-1)] border rounded-lg px-2.5 py-1.5 text-[12px] font-sans focus:outline-none ${
                  bulkMode === '' ? 'border-[var(--color-error)] text-[var(--color-error)]' : 'border-[var(--color-border)] text-[var(--color-foreground)]'
                }`}
              >
                <option value="" disabled>Select mode…</option>
                <option value="Cash">Cash</option>
                <option value="Transfer">Transfer</option>
                <option value="POS">POS</option>
              </select>
              {bulkMode === 'Transfer' && (
                <select
                  value={bulkBank}
                  onChange={e => setBulkBank(e.target.value)}
                  className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-[12px] font-sans text-[var(--color-foreground)] focus:outline-none"
                >
                  <option value="">Select Bank</option>
                  {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={handleBatchPrintReceipt}
                  disabled={!bulkMode}
                  title={!bulkMode ? 'Select a payment mode first' : undefined}
                  className="flex items-center gap-1.5 bg-[var(--color-surface-2)] text-[var(--color-foreground)] px-4 py-1.5 rounded-lg text-[12px] font-sans font-bold hover:opacity-90 transition-opacity focus:outline-none disabled:opacity-50"
                >
                  <Printer size={14} />
                  Print Receipt
                </button>
                <button
                  onClick={handleBulkClear}
                  disabled={bulkClearing || !bulkMode || (bulkMode === 'Transfer' && !bulkBank.trim())}
                  title={!bulkMode ? 'Select a payment mode first' : undefined}
                  className="bg-[var(--color-success)] text-[var(--color-on-accent)] px-4 py-1.5 rounded-lg text-[12px] font-sans font-bold hover:opacity-90 transition-opacity focus:outline-none disabled:opacity-50"
                >
                  {bulkClearing ? 'Clearing...' : `Clear ${selectedIds.size} Debt${selectedIds.size === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(d.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(d.id); else next.delete(d.id);
                          return next;
                        });
                      }}
                      className="w-4 h-4 mr-3 shrink-0 cursor-pointer"
                    />
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
                         className="p-2 rounded-full bg-[rgba(16,185,129,0.1)] text-[var(--color-success)] hover:bg-[var(--color-success)] hover:text-[var(--color-on-accent)] transition-colors focus:outline-none"
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

                                   {paymentMode === 'Transfer' && (
                                     <div>
                                       <label htmlFor={`payment-bank-${d.id}`} className="text-[11px] font-sans text-[var(--color-muted)] block mb-1">Bank</label>
                                       <select
                                         id={`payment-bank-${d.id}`}
                                         value={paymentBank}
                                         onChange={e => setPaymentBank(e.target.value)}
                                         className="w-full h-10 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-lg px-3 text-[var(--color-foreground)] font-sans text-[13px] focus:outline-none focus:border-[var(--color-success)] focus:ring-1 focus:ring-[var(--color-success)]"
                                       >
                                         <option value="">Select Bank</option>
                                         {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                                       </select>
                                     </div>
                                   )}

                                   <div className="flex justify-end pt-2">
                                     <button
                                       disabled={submittingPaymentId === d.id || (paymentMode === 'Transfer' && !paymentBank.trim())}
                                       onClick={() => handleRecordPayment(d.id)}
                                       className="bg-[var(--color-success)] text-[var(--color-on-accent)] px-6 py-2 rounded-lg text-[13px] font-sans font-bold hover:opacity-90 transition-opacity focus:outline-none disabled:opacity-50"
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
