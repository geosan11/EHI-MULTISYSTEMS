import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { User, Transaction, Expense } from '../../lib/types';
import { fmt, parseLocalDateBoundary } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';
import { Box, Plane, TrendingUp, Package, Lock, Unlock, AlertCircle, FileDown, Loader2 } from 'lucide-react';
import { BackButton } from '../BackButton';
const DebtorsTab = lazy(() => import('./DebtorsTab').then(m => ({ default: m.DebtorsTab })));
const ExpensesTab = lazy(() => import('./ExpensesTab').then(m => ({ default: m.ExpensesTab })));
const BankReconciliation = lazy(() => import('./BankReconciliation').then(m => ({ default: m.BankReconciliation })));
const PaymentValidation = lazy(() => import('./PaymentValidation').then(m => ({ default: m.PaymentValidation })));
import { useToast } from '../../lib/ToastContext';
const B2BSalesTab = lazy(() => import('./B2BSalesTab').then(m => ({ default: m.B2BSalesTab })));
import { fetchAllDebtAndRetrievalEntries, buildShadowRowExclusionCounts, extractPaymentHistoryEvents, sumPaymentHistoryByMode } from '../../lib/debt';

export interface AccountingConsoleProps {
  user: User;
  transactions: Transaction[];
  expenses: Expense[];
  onBack: () => void;
  onAddExpense: (exp: Expense) => void;
  onUpdateExpense?: (expenseId: string, decision: 'approved' | 'rejected') => void;
  onUpdateTx?: (id: string, update: Partial<Transaction>) => void;
  onOpenBankRecon: () => void;
  onFullUpdateTx?: (tx: Transaction) => void;
  dateRange?: { start: string; end: string };
  onDateRangeChange?: (range: { start: string; end: string }) => void;
}

export const AccountingConsole = ({ user, transactions, expenses, onBack, onAddExpense, onUpdateExpense, onUpdateTx, onOpenBankRecon, onFullUpdateTx, dateRange, onDateRangeChange }: AccountingConsoleProps) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'Summary' | 'Cash Register' | 'Credit Sales' | 'B2B Sales' | 'Expenses' | 'Remittances' | 'Payment Validation'>(() => {
    return (sessionStorage.getItem('ehi_accounting_tab') as any) || 'Summary';
  });

  useEffect(() => {
    sessionStorage.setItem('ehi_accounting_tab', activeTab);
  }, [activeTab]);

  const [period, setPeriod] = useState<'Today' | 'This Week' | 'This Month' | 'Custom'>('Today');
  const [customStart, setCustomStart] = useState(new Date().toISOString().split('T')[0]);
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().split('T')[0]);

  // `transactions` is fetched ONCE by EHIApp.tsx bounded by the shared
  // globalDateRange (default: last 7 days) -- this screen has no fetch of
  // its own, so picking "This Month"/"Custom" here used to silently filter
  // whatever partial window happened to already be loaded, with no
  // indication anything outside it was missing. Mirrors TransactionLedger.
  // tsx's "All Time" pattern: only ever WIDENS the shared range to cover
  // what's needed, never narrows it back down, so switching back to
  // "Today" here doesn't fight another open tab that deliberately widened
  // it (e.g. Ledger's "All Time").
  useEffect(() => {
    if (!onDateRangeChange || !dateRange) return;
    let neededStart: string | null = null;
    let neededEnd: string | null = null;
    if (period === 'This Month') {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      neededStart = monthAgo.toISOString().split('T')[0];
      neededEnd = new Date().toISOString().split('T')[0];
    } else if (period === 'Custom') {
      neededStart = customStart;
      neededEnd = customEnd;
    }
    if (neededStart === null || neededEnd === null) return;
    const start = neededStart < dateRange.start ? neededStart : dateRange.start;
    const end = neededEnd > dateRange.end ? neededEnd : dateRange.end;
    if (start !== dateRange.start || end !== dateRange.end) {
      onDateRangeChange({ start, end });
    }
  }, [period, customStart, customEnd, dateRange, onDateRangeChange]);

  // Only meaningful when this screen can't widen the fetch itself (no
  // onDateRangeChange wired up) -- turns "silently wrong" into "visibly
  // incomplete" instead.
  const showIncompleteWindowBanner = !onDateRangeChange && dateRange != null &&
    (period === 'This Month' || period === 'Custom') &&
    (period === 'Custom' ? customStart < dateRange.start || customEnd > dateRange.end : (() => {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return monthAgo.toISOString().split('T')[0] < dateRange.start;
    })());

  // Was computed off `transactions`, which EHIApp.tsx windows to
  // globalDateRange (a trailing few days) -- a Transfer sale left
  // unconfirmed longer than that window silently dropped out of both this
  // badge and the tab's own internal match-candidate list (PaymentValidation.tsx),
  // even though it's still a genuinely open, unresolved payment. A
  // dedicated, unbounded COUNT query (not full rows -- this is just a
  // badge number) across all 4 department tables instead.
  const [unconfirmedCount, setUnconfirmedCount] = useState(0);
  useEffect(() => {
    let active = true;
    const tables: { name: string; modeCol: string }[] = [
      { name: 'cargo_entries', modeCol: 'receipt_mode' },
      { name: 'manifests', modeCol: 'payment_mode' },
      { name: 'marketing_entries', modeCol: 'payment_mode' },
      { name: 'package_entries', modeCol: 'payment_mode' },
    ];
    Promise.all(tables.map(({ name, modeCol }) =>
      supabase.from(name).select('*', { count: 'exact', head: true }).eq(modeCol, 'Transfer').eq('payment_confirmed', false)
    )).then(results => {
      if (!active) return;
      setUnconfirmedCount(results.reduce((sum, r) => sum + (r.count || 0), 0));
    }).catch(() => { /* badge is a nice-to-have indicator, not worth a toast on failure */ });
    return () => { active = false; };
  }, []);

  const periodMatches = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    return (d: Date): boolean => {
      if (period === 'Today') return d >= today;
      if (period === 'This Week') return d >= weekAgo;
      if (period === 'This Month') return d >= monthAgo;
      if (period === 'Custom') {
        // parseLocalDateBoundary, not `new Date(customStart)` -- a bare
        // "YYYY-MM-DD" string parses as UTC midnight per the JS spec, not
        // local midnight, which silently excluded the first ~hour of the
        // selected start day's local transactions.
        const start = parseLocalDateBoundary(customStart);
        const end = parseLocalDateBoundary(customEnd, true);
        return d >= start && d <= end;
      }
      return true;
    };
  }, [period, customStart, customEnd]);

  const { filteredTx, filteredExp } = useMemo(() => {
    const fTx = transactions.filter(t => periodMatches(t.created_at ? new Date(t.created_at) : new Date()));
    const fExp = expenses.filter(e => periodMatches(e.created_at ? new Date(e.created_at) : new Date()));
    return { filteredTx: fTx, filteredExp: fExp };
  }, [transactions, expenses, periodMatches]);

  // Debt-bearing/retrieved entries, unbounded by the `transactions` prop's
  // own date window -- feeds the payment_history-derived collection events
  // below. See src/lib/debt.ts.
  const [debtBearingEntries, setDebtBearingEntries] = useState<Transaction[]>([]);
  useEffect(() => {
    let active = true;
    fetchAllDebtAndRetrievalEntries().then(entries => { if (active) setDebtBearingEntries(entries); }).catch(() => {});
    return () => { active = false; };
  }, []);

  // Debt-collection events (payment_history-derived) inside the selected
  // period -- the going-forward replacement for a debt-clearance shadow
  // row's contribution to this screen's revenue/cash totals below.
  const periodCollectionEvents = useMemo(() => {
    const exclusionCounts = buildShadowRowExclusionCounts(debtBearingEntries);
    return extractPaymentHistoryEvents(debtBearingEntries, exclusionCounts).filter(e => periodMatches(new Date(e.at)));
  }, [debtBearingEntries, periodMatches]);
  const collectionByMode = useMemo(() => sumPaymentHistoryByMode(periodCollectionEvents), [periodCollectionEvents]);

  // !t.is_debt_clearance: a cleared debt's historical shadow row is a
  // PAYMENT against a sale already counted once via the original Debt-mode
  // entry, not a second sale -- without this guard, every cleared debt
  // double-counted here (original amount + shadow row's collected amount).
  const cargoTx = filteredTx.filter(t => t.type === 'cargo' && !t.is_debt_clearance);
  const vjTx = filteredTx.filter(t => t.type === 'baggage' && !t.is_debt_clearance);
  const mktgTx = filteredTx.filter(t => t.type === 'marketing' && !t.is_debt_clearance);
  const pkgTx = filteredTx.filter(t => t.type === 'package' && !t.is_debt_clearance);

  const cargoTotal = cargoTx.reduce((sum, t) => sum + t.amount, 0);
  const vjTotal = vjTx.reduce((sum, t) => sum + t.amount, 0);
  const mktgTotal = mktgTx.reduce((sum, t) => sum + t.amount, 0);
  const pkgTotal = pkgTx.reduce((sum, t) => sum + t.amount, 0);

  const grandRevenue = cargoTotal + vjTotal + mktgTotal + pkgTotal;
  // Only approved spend counts as real outflow. Pending/rejected expenses
  // must not distort Net Revenue.
  const approvedExp = filteredExp.filter(e => (e.status || 'approved') === 'approved');
  const totalExpenses = approvedExp.reduce((sum, e) => sum + e.amount, 0);
  const pendingExpTotal = filteredExp.filter(e => e.status === 'pending').reduce((sum, e) => sum + e.amount, 0);
  const netRevenue = grandRevenue - totalExpenses;

  // Historical shadow rows (still present in filteredTx, unconditional --
  // correct forever for old data) plus payment_history-derived collections
  // (going forward, now that clearing a debt no longer creates a row here).
  // A tx whose mode is Cash/Transfer/POS can still be partly wallet-covered
  // (chargeWalletForSale's auto-split, or the Edit Transaction wallet+
  // remainder split) -- wallet_deduction_amount is that portion and must be
  // subtracted here or it gets double-counted: once under its own Wallet
  // bucket below, once still embedded in the remainder mode's full t.amount.
  const nonWalletPortion = (t: Transaction) => Math.max(0, t.amount - (t.wallet_deduction_amount || 0));
  const cashTotal = filteredTx.reduce((sum, t) => sum + (t.mode === 'Cash' ? nonWalletPortion(t) : 0), 0) + collectionByMode.cash;
  // TransferCash ("paid by bank transfer, agent holds the cash") is a real,
  // fully-collected sale mode (see src/lib/salesAnalysis.ts's own bucket for
  // it) -- omitting it here understated Collected/Collection Rate below and
  // made the four mode segments stop summing to grandRevenue whenever any
  // TransferCash sales existed in the period.
  const transferTotal = filteredTx.reduce((sum, t) => sum + ((t.mode === 'Transfer' || t.mode === 'TransferCash') ? nonWalletPortion(t) : 0), 0) + collectionByMode.transfer;
  const posTotal = filteredTx.reduce((sum, t) => sum + (t.mode === 'POS' ? nonWalletPortion(t) : 0), 0) + collectionByMode.pos;
  const debtTotal = filteredTx.reduce((sum, t) => sum + (t.mode === 'Debt' ? t.amount : 0), 0);
  // Every wallet_deduction_amount across the period, whichever remainder
  // mode (or none, for a fully wallet-paid tx) the rest was booked under.
  // Falls back to the full amount for a mode==='Wallet' row whose
  // wallet_deduction_amount is NULL -- the column was backfilled only for
  // the retrieval reclassification (20260717_cargo_workflow_overhaul.sql),
  // so older Wallet-mode rows predate it. Same fallback EODReconciliation.tsx/
  // Analytics.tsx/LiveCreditFeed.tsx already use for this exact gap.
  const walletTotal = filteredTx.reduce((sum, t) => sum + (t.wallet_deduction_amount || (t.mode === 'Wallet' ? t.amount : 0)), 0);
  const modeSum = cashTotal + transferTotal + posTotal + debtTotal + walletTotal;

  const cashPct = modeSum ? (cashTotal / modeSum) * 100 : 0;
  const transferPct = modeSum ? (transferTotal / modeSum) * 100 : 0;
  const posPct = modeSum ? (posTotal / modeSum) * 100 : 0;
  const debtPct = modeSum ? (debtTotal / modeSum) * 100 : 0;
  const walletPct = modeSum ? (walletTotal / modeSum) * 100 : 0;

  const collectionEff = grandRevenue ? ((cashTotal + transferTotal + posTotal + walletTotal) / grandRevenue) * 100 : 0;
  const collectionColor = collectionEff >= 90 ? 'text-[var(--color-success)]' : collectionEff >= 70 ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-error)]';
  const vatEstimate = grandRevenue * 0.075;

  // ==== CASH REGISTER STATE ====
  // Backed by eod_records (hub_id, date) -- the same table EODReconciliation.tsx
  // locks the day against -- instead of a separate localStorage register that
  // could silently disagree with it.
  // Local calendar date, not `.toISOString().split('T')[0]` (UTC) -- must
  // match isOnRegDate's local-day comparison below (regReceipts etc.), or
  // the register defaults to "yesterday" for the first ~1hr after local
  // midnight in a UTC+ timezone (Lagos is UTC+1), excluding sales that just
  // happened from what the register displays as "today".
  const todayDate = new Date();
  const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
  const [regDate, setRegDate] = useState(todayStr);

  // regDate is a free date-picker, not tied to the period selector above --
  // same silent-truncation risk (transactions/expenses are windowed by the
  // shared globalDateRange), so it gets the same widen-if-possible,
  // warn-if-not treatment as "This Month"/"Custom" do above.
  // A native <input type="date"> fires onChange with '' the instant it's
  // cleared, and can emit a partial value (e.g. while typing a year digit
  // by digit) before landing on a real date -- widening the APP-WIDE shared
  // range to '' propagates into EHIApp.tsx's fetchInitial as `new Date('')`,
  // which throws on .toISOString() and breaks data loading for every other
  // tab until reload. Only ever act on a well-formed YYYY-MM-DD value.
  const isValidDateStr = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  useEffect(() => {
    if (!onDateRangeChange || !dateRange || !isValidDateStr(regDate)) return;
    if (regDate >= dateRange.start && regDate <= dateRange.end) return;
    const start = regDate < dateRange.start ? regDate : dateRange.start;
    const end = regDate > dateRange.end ? regDate : dateRange.end;
    onDateRangeChange({ start, end });
  }, [regDate, dateRange, onDateRangeChange]);

  const showRegDateIncompleteBanner = !onDateRangeChange && dateRange != null && isValidDateStr(regDate) &&
    (regDate < dateRange.start || regDate > dateRange.end);

  const [openingBalance, setOpeningBalance] = useState<number | null>(null);
  const [physicalCount, setPhysicalCount] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [showOpeningModal, setShowOpeningModal] = useState(false);
  const [openingInput, setOpeningInput] = useState('');
  const [physicalInput, setPhysicalInput] = useState('');

  useEffect(() => {
    if (!user.hub_id) {
      setOpeningBalance(null);
      setPhysicalCount(null);
      setIsLocked(false);
      setShowOpeningModal(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: todayRow } = await supabase
        .from('eod_records')
        .select('opening_balance, physical_count, status')
        .eq('hub_id', user.hub_id)
        .eq('date', regDate)
        .maybeSingle();
      if (cancelled) return;

      if (todayRow && todayRow.opening_balance !== null) {
        setOpeningBalance(todayRow.opening_balance);
        setPhysicalCount(todayRow.physical_count ?? null);
        setIsLocked(todayRow.status === 'locked');
        setShowOpeningModal(false);
        setPhysicalInput('');
        return;
      }

      // No opening balance recorded yet for regDate -- auto-fill from
      // yesterday's closing physical count, but still require confirmation
      // through the same modal before it's actually set.
      const yesterday = new Date(regDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const { data: prevRow } = await supabase
        .from('eod_records')
        .select('physical_count')
        .eq('hub_id', user.hub_id)
        .eq('date', yesterdayStr)
        .maybeSingle();
      if (cancelled) return;

      setOpeningBalance(null);
      setPhysicalCount(null);
      setIsLocked(false);
      setShowOpeningModal(true);
      setOpeningInput(prevRow?.physical_count != null ? String(prevRow.physical_count) : '');
    })();
    return () => { cancelled = true; };
  }, [regDate, user.hub_id]);

  const handleSetOpening = async () => {
    const val = parseFloat(openingInput);
    if (isNaN(val) || val < 0) {
      showToast({ message: 'Enter a valid opening balance of 0 or more.', type: 'warning' });
      return;
    }
    const { error } = await supabase.from('eod_records').upsert({
      hub_id: user.hub_id,
      hub: user.hub,
      date: regDate,
      opening_balance: val,
      status: 'open'
    }, { onConflict: 'hub_id,date' });
    // Only reflect the new opening balance in the UI once the write is
    // confirmed -- setting it beforehand meant a failed/offline upsert
    // left the screen showing a balance that was never actually saved.
    if (error) {
      showToast({ message: `Failed to save opening balance: ${error.message}`, type: 'error' });
      return;
    }
    setOpeningBalance(val);
    setShowOpeningModal(false);
  };

  const handleLockRegister = async () => {
    const val = parseFloat(physicalInput);
    if (isNaN(val) || val < 0) {
      showToast({ message: 'Enter a valid physical cash count of 0 or more.', type: 'warning' });
      return;
    }
    const { error } = await supabase.from('eod_records').upsert({
      hub_id: user.hub_id,
      hub: user.hub,
      date: regDate,
      opening_balance: openingBalance,
      physical_count: val,
      status: 'locked'
    }, { onConflict: 'hub_id,date' });
    // Same reasoning as handleSetOpening -- don't claim "locked" in the UI
    // until the DB write is confirmed to have actually happened.
    if (error) {
      showToast({ message: `Failed to lock register: ${error.message}`, type: 'error' });
      return;
    }
    setPhysicalCount(val);
    setIsLocked(true);
  };

  // Scoped to the register's own date (regDate), not the whole history --
  // otherwise this silently accumulates every transaction/expense ever
  // logged since go-live, making the EOD variance meaningless.
  // A debt payment leaves the parent transaction's mode as 'Debt'/'Debt Paid'
  // (never 'Cash'), so today's cash recovered against an old debt would be
  // invisible to a mode-only filter -- pull it from paymentHistory instead.
  // isOnRegDate compares against the LOCAL calendar day (parseLocalDateBoundary,
  // same as periodMatches above), not a raw UTC-substring match -- a cash
  // sale logged late evening local time can fall on the "next day" in UTC,
  // so `.split('T')[0] === regDate` silently dropped it from Cash Register's
  // totals for the day it actually happened, while Summary's periodMatches
  // (local-day aware) still counted it under "Today".
  const isOnRegDate = (dateStr: string | null | undefined): boolean => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= parseLocalDateBoundary(regDate) && d <= parseLocalDateBoundary(regDate, true);
  };
  const debtCashRecoveredToday = transactions.reduce((sum, t) => {
    const todays = (t.paymentHistory || []).filter(p => p.mode === 'Cash' && isOnRegDate(p.at));
    return sum + todays.reduce((s, p) => s + p.amount, 0);
  }, 0);
  const regReceipts = transactions
    .filter(t => (t.mode === 'Cash' || t.wallet_deduction_amount) && isOnRegDate(t.created_at))
    .reduce((sum, t) => {
      const cashPortion = t.mode === 'Cash' ? Math.max(0, t.amount - (t.wallet_deduction_amount || 0)) : 0;
      return sum + cashPortion;
    }, 0) + debtCashRecoveredToday;
  // Only approved expenses actually left the register -- a pending or
  // rejected expense hasn't (or won't) be paid out, so counting it here
  // would falsely shrink the expected closing balance.
  const regPayments = expenses
    .filter(e => (e.status || 'approved') === 'approved' && e.mode === 'Cash' && isOnRegDate(e.created_at))
    .reduce((sum, e) => sum + e.amount, 0);
  const expectedClosing = (openingBalance || 0) + regReceipts - regPayments;
  const variance = physicalCount !== null ? physicalCount - expectedClosing : 0;

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] overflow-y-auto animate-in slide-in-from-right">
      <div className="ehi-page-body px-4 pt-4 relative text-[var(--color-foreground)]">
      <div className="flex items-center justify-between mb-4">
        <BackButton onClick={onBack} label="Accounting" />
      </div>

      {/* TABS HEADER */}
      <div className="relative mb-4">
      <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-hide">
        {['Summary', 'Cash Register', 'Credit Sales', 'B2B Sales', 'Expenses', 'Payment Validation', 'Remittances'].map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t as any)}
            className={`px-4 py-2 text-[13px] font-sans font-medium rounded-full whitespace-nowrap transition-colors focus:outline-none flex items-center ${activeTab === t ? 'bg-[var(--color-accent-cobalt)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
          >
            {t}
            {t === 'Payment Validation' && unconfirmedCount > 0 && (
              <span className="ml-2 bg-[var(--color-accent-amber)] text-[var(--color-on-accent)] text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                {unconfirmedCount}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={onOpenBankRecon}
          className="px-4 py-2 text-[13px] font-sans font-medium rounded-full whitespace-nowrap transition-colors focus:outline-none flex items-center bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          Bank Reconciliation
        </button>
      </div>
      <div className="pointer-events-none absolute top-0 right-0 bottom-2 w-10 bg-gradient-to-l from-[var(--color-obsidian)] to-transparent" />
      </div>

      {activeTab === 'Summary' && (
        <div className="space-y-6 pb-20">
          {/* PERIOD FILTER */}
          <div className="flex space-x-2">
             {['Today', 'This Week', 'This Month', 'Custom'].map(p => (
               <button
                 key={p}
                 onClick={() => setPeriod(p as any)}
                 className={`px-3 py-1.5 text-[12px] font-sans font-medium rounded-full transition-colors focus:outline-none ${period === p ? 'bg-[var(--color-surface-2)] text-[var(--color-foreground)]' : 'text-[var(--color-muted)] hover:bg-[var(--color-border)]'}`}
               >
                 {p}
               </button>
             ))}
          </div>
          {period === 'Custom' && (
            <div className="flex items-center space-x-2">
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-[12px] font-sans text-[var(--color-foreground)] focus:outline-none"
              />
              <span className="text-[12px] font-sans text-[var(--color-muted)]">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-[12px] font-sans text-[var(--color-foreground)] focus:outline-none"
              />
            </div>
          )}
          {showIncompleteWindowBanner && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(245,158,11,0.08)] border border-[var(--color-accent-amber)] text-[11px] font-sans text-[var(--color-accent-amber)]">
              <AlertCircle size={14} />
              Data only loaded from {dateRange?.start} onward — this period may be showing an incomplete total.
            </div>
          )}

          <button
            onClick={() => {
              import('./AccountingSummaryPDF').then(({ downloadAccountingSummaryPDF }) => {
                downloadAccountingSummaryPDF({
                  hubName: user.hub,
                  generatedBy: user.name,
                  generatedAt: new Date().toLocaleString('en-GB'),
                  periodLabel: period === 'Custom' ? `Custom: ${customStart} to ${customEnd}` : period,
                  streams: [
                    { name: 'Cargo Station', amount: cargoTotal, count: cargoTx.length },
                    { name: 'Excess Baggage', amount: vjTotal, count: vjTx.length },
                    { name: 'Field Marketing', amount: mktgTotal, count: mktgTx.length },
                    { name: 'Package Desk', amount: pkgTotal, count: pkgTx.length },
                  ],
                  grandRevenue,
                  totalExpenses,
                  pendingExpTotal,
                  netRevenue,
                  modes: { cash: cashTotal, transfer: transferTotal, pos: posTotal, debt: debtTotal, wallet: walletTotal },
                  collectionEff,
                  vatEstimate,
                });
              });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[12px] font-sans font-medium text-[var(--color-muted)] hover:text-[var(--color-accent-amber)] hover:border-[var(--color-accent-amber)] transition-colors"
          >
            <FileDown size={14} /> Download PDF
          </button>

          {/* REVENUE SUMMARY ROW */}
          <div className="flex space-x-4 overflow-x-auto pb-2 snap-x">
             <div className="min-w-[200px] flex-1 bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-4 relative overflow-hidden snap-start">
                <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-[var(--color-accent-amber)]" />
                <div className="flex items-center space-x-2 mb-2 ml-2">
                  <Box size={16} className="text-[var(--color-accent-amber)]" />
                  <span className="text-[13px] font-sans font-medium text-[var(--color-muted)]">Cargo Station</span>
                </div>
                <div className="text-[20px] font-bold font-mono text-[var(--color-accent-amber)] ml-2 mb-1">{fmt(cargoTotal)}</div>
                <div className="text-[12px] font-sans text-[var(--color-light-muted)] ml-2 mb-3">{cargoTx.length} Entries</div>
             </div>

             <div className="min-w-[200px] flex-1 bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-4 relative overflow-hidden snap-start">
                <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-[var(--color-accent-cobalt)]" />
                <div className="flex items-center space-x-2 mb-2 ml-2">
                  <Plane size={16} className="text-[var(--color-accent-cobalt)]" />
                  <span className="text-[13px] font-sans font-medium text-[var(--color-muted)]">Excess Baggage</span>
                </div>
                <div className="text-[20px] font-bold font-mono text-[var(--color-accent-cobalt)] ml-2 mb-1">{fmt(vjTotal)}</div>
                <div className="text-[12px] font-sans text-[var(--color-light-muted)] ml-2 mb-3">{vjTx.length} Passengers</div>
             </div>

             <div className="min-w-[200px] flex-1 bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-4 relative overflow-hidden snap-start">
                <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-[var(--color-success)]" />
                <div className="flex items-center space-x-2 mb-2 ml-2">
                  <TrendingUp size={16} className="text-[var(--color-success)]" />
                  <span className="text-[13px] font-sans font-medium text-[var(--color-muted)]">Field Marketing</span>
                </div>
                <div className="text-[20px] font-bold font-mono text-[var(--color-success)] ml-2 mb-1">{fmt(mktgTotal)}</div>
                <div className="text-[12px] font-sans text-[var(--color-light-muted)] ml-2 mb-3">{mktgTx.length} Customers</div>
             </div>

             <div className="min-w-[200px] flex-1 bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-4 relative overflow-hidden snap-start">
                <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-purple-500" />
                <div className="flex items-center space-x-2 mb-2 ml-2">
                  <Package size={16} className="text-purple-400" />
                  <span className="text-[13px] font-sans font-medium text-[var(--color-muted)]">Package Desk</span>
                </div>
                <div className="text-[20px] font-bold font-mono text-purple-400 ml-2 mb-1">{fmt(pkgTotal)}</div>
                <div className="text-[12px] font-sans text-[var(--color-light-muted)] ml-2 mb-3">{pkgTx.length} Packages</div>
             </div>
          </div>

          {/* NET REVENUE BLOCK */}
          <div className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-5">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[13px] font-sans text-[var(--color-muted)]">Grand Revenue</span>
              <span className="text-[15px] font-mono text-[var(--color-foreground)]">{fmt(grandRevenue)}</span>
            </div>
            <div className="flex justify-between items-center mb-4 border-b border-[var(--color-border)] pb-4">
              <div>
                <span className="text-[13px] font-sans text-[var(--color-muted)]">Total Expenses</span>
                {pendingExpTotal > 0 && (
                  <div className="text-[11px] font-sans text-[var(--color-muted)] mt-0.5">{fmt(pendingExpTotal)} pending approval — not yet included above</div>
                )}
              </div>
              <span className="text-[15px] font-mono text-[var(--color-error)]">-{fmt(totalExpenses)}</span>
            </div>
             <div className="flex justify-between items-center">
              <span className="text-[14px] font-sans font-medium text-[var(--color-light-muted)]">Net Revenue</span>
              <span className={`text-[24px] font-bold font-mono ${netRevenue >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                {fmt(netRevenue)}
              </span>
            </div>
          </div>

          {/* COLLECTION MIX & EFFICIENCY */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-5">
               <div className="text-[13px] font-sans font-medium text-[var(--color-muted)] mb-4">Collection Breakdown</div>
               <div className="w-full h-4 flex rounded-full overflow-hidden mb-4">
                 {cashPct > 0 && <div style={{width: `${cashPct}%`}} className="bg-[var(--color-success)]" title={`Cash: ${fmt(cashTotal)}`} />}
                 {transferPct > 0 && <div style={{width: `${transferPct}%`}} className="bg-[var(--color-accent-cobalt)]" title={`Bank Transfer: ${fmt(transferTotal)}`} />}
                 {posPct > 0 && <div style={{width: `${posPct}%`}} className="bg-[var(--color-accent-amber)]" title={`POS / Card: ${fmt(posTotal)}`} />}
                 {debtPct > 0 && <div style={{width: `${debtPct}%`}} className="bg-[var(--color-error)]" title={`On Credit: ${fmt(debtTotal)}`} />}
                 {walletPct > 0 && <div style={{width: `${walletPct}%`, backgroundColor: '#8B5CF6'}} title={`Customer Wallet: ${fmt(walletTotal)}`} />}
               </div>
               <div className="grid grid-cols-2 gap-3 text-[12px] font-sans">
                  <div className="flex items-center space-x-2"><div className="w-2 h-2 rounded-full bg-[var(--color-success)]"/> <span className="text-[var(--color-light-muted)]">Cash: {cashPct.toFixed(0)}% ({fmt(cashTotal)})</span></div>
                  <div className="flex items-center space-x-2"><div className="w-2 h-2 rounded-full bg-[var(--color-accent-cobalt)]"/> <span className="text-[var(--color-light-muted)]">Bank Transfer: {transferPct.toFixed(0)}% ({fmt(transferTotal)})</span></div>
                  <div className="flex items-center space-x-2"><div className="w-2 h-2 rounded-full bg-[var(--color-accent-amber)]"/> <span className="text-[var(--color-light-muted)]">POS / Card: {posPct.toFixed(0)}% ({fmt(posTotal)})</span></div>
                  <div className="flex items-center space-x-2"><div className="w-2 h-2 rounded-full bg-[var(--color-error)]"/> <span className="text-[var(--color-light-muted)]">On Credit: {debtPct.toFixed(0)}% ({fmt(debtTotal)})</span></div>
                  <div className="flex items-center space-x-2"><div className="w-2 h-2 rounded-full" style={{backgroundColor: '#8B5CF6'}}/> <span className="text-[var(--color-light-muted)]">Customer Wallet: {walletPct.toFixed(0)}% ({fmt(walletTotal)})</span></div>
               </div>
             </div>

             <div className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-5 flex flex-col justify-between relative overflow-hidden">
                <div className="text-[13px] font-sans font-medium text-[var(--color-muted)]">Collection Rate</div>
                <div className="mt-4 flex items-center justify-between">
                   <div className="flex flex-col">
                     <span className="text-[12px] font-sans text-[var(--color-muted)]">Total Collected</span>
                     <span className="text-[20px] font-bold font-mono text-[var(--color-foreground)] mt-1">{fmt(cashTotal + transferTotal + posTotal)}</span>
                   </div>
                   <div className={`flex items-center justify-center w-16 h-16 rounded-full border-4 ${collectionEff >= 90 ? 'border-[var(--color-success)] text-[var(--color-success)] bg-[rgba(16,185,129,0.1)]' : collectionEff >= 70 ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.1)]' : 'border-[var(--color-error)] text-[var(--color-error)] bg-[rgba(239,68,68,0.1)]'}`}>
                     <span className="text-[18px] font-bold font-mono">{collectionEff.toFixed(0)}%</span>
                   </div>
                </div>
                <div className="mt-4 text-[12px] font-sans text-[var(--color-error)] opacity-80">
                   {fmt(debtTotal)} still on credit
                </div>
             </div>
          </div>

          <div className="bg-[var(--color-border)] border border-[var(--color-border)] rounded-xl p-4 flex items-start space-x-3">
             <AlertCircle size={18} className="text-[var(--color-muted)] shrink-0 mt-0.5" />
             <div>
               <div className="text-[13px] font-sans font-medium text-[var(--color-light-muted)]">Estimated Output VAT (7.5% of gross revenue): <span className="font-mono">{fmt(vatEstimate)}</span></div>
               <div className="text-[12px] font-sans text-[var(--color-muted)] mt-1">Indicative only — computed on gross revenue with no netting against input VAT on expenses/purchases, and no exempt/zero-rated adjustments. Confirm actual liability with your accountant before filing with FIRS.</div>
             </div>
          </div>
        </div>
      )}

      {activeTab === 'Cash Register' && (
        <div className="space-y-6 pb-24">
           {showOpeningModal && (
             <div className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-5 animate-in fade-in zoom-in-95">
               <h3 className="text-[16px] font-sans font-bold text-[var(--color-foreground)] mb-2">Set Opening Balance</h3>
               <p className="text-[13px] font-sans text-[var(--color-muted)] mb-4">Enter the cash carried over from yesterday's closing count.</p>
               <input
                 id="opening-balance"
                 name="opening-balance"
                 type="number"
                 min="0"
                 placeholder="e.g. 15000"
                 value={openingInput}
                 onChange={e => setOpeningInput(e.target.value)}
                 className="w-full h-12 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl px-4 text-[var(--color-foreground)] font-mono text-[16px] focus:outline-none focus:border-[var(--color-accent-cobalt)] focus:ring-1 focus:ring-[var(--color-accent-cobalt)] transition-all mb-4"
               />
               <button 
                 onClick={handleSetOpening}
                 className="w-full h-12 bg-[var(--color-accent-cobalt)] hover:opacity-90 text-white text-[14px] font-sans font-bold rounded-xl transition-all"
               >
                 Confirm Opening Balance
               </button>
             </div>
           )}

           {!showOpeningModal && (
             <>
               <div className="flex items-center justify-between bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-2 px-3">
                 <input 
                   type="date" 
                   value={regDate}
                   onChange={e => setRegDate(e.target.value)}
                   className="bg-transparent text-[14px] font-sans font-medium text-[var(--color-foreground)] focus:outline-none"
                 />
                 <div className={`px-2.5 py-1 rounded-md text-[11px] font-sans font-bold uppercase ${isLocked ? 'bg-[rgba(16,185,129,0.15)] text-[var(--color-success)]' : 'bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)]'}`}>
                   {isLocked ? 'LOCKED' : 'OPEN'}
                 </div>
               </div>

               {showRegDateIncompleteBanner && (
                 <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(245,158,11,0.08)] border border-[var(--color-accent-amber)] text-[11px] font-sans text-[var(--color-accent-amber)]">
                   <AlertCircle size={14} />
                   Data only loaded from {dateRange?.start} onward — {regDate} may be showing an incomplete total.
                 </div>
               )}

               <div className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-5 space-y-4">
                 <div className="flex justify-between items-center pb-3 border-b border-[var(--color-border)]">
                   <div className="text-[13px] font-sans text-[var(--color-muted)]">Opening Balance</div>
                   <div className="text-[15px] font-mono text-[var(--color-foreground)]">{fmt(openingBalance || 0)}</div>
                 </div>
                 <div className="flex justify-between items-center pb-3 border-b border-[var(--color-border)]">
                   <div className="text-[13px] font-sans text-[var(--color-muted)]">Total Cash Receipts</div>
                   <div className="text-[15px] font-mono text-[var(--color-success)]">+{fmt(regReceipts)}</div>
                 </div>
                 <div className="flex justify-between items-center pb-3 border-b border-[var(--color-border)]">
                   <div className="text-[13px] font-sans text-[var(--color-muted)]">Total Cash Payments</div>
                   <div className="text-[15px] font-mono text-[var(--color-error)]">-{fmt(regPayments)}</div>
                 </div>
                 <div className="flex justify-between items-center pt-2">
                   <div className="text-[15px] font-sans font-semibold text-[var(--color-light-muted)]">Expected Closing</div>
                   <div className="text-[20px] font-mono font-bold text-[var(--color-foreground)]">{fmt(expectedClosing)}</div>
                 </div>
               </div>

               {(!isLocked || physicalCount !== null) && (
                 <div className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-5">
                   {isLocked ? (
                     <div className="space-y-4">
                       <div className="flex justify-between items-center">
                         <div className="text-[13px] font-sans text-[var(--color-muted)]">Physical Count</div>
                         <div className="text-[16px] font-mono text-[var(--color-foreground)] font-bold">{fmt(physicalCount!)}</div>
                       </div>
                       <div className="flex justify-between items-center">
                         <div className="text-[13px] font-sans text-[var(--color-muted)]">Variance</div>
                         <div className={`text-[16px] font-mono font-bold ${variance === 0 ? 'text-[var(--color-success)]' : variance < 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-accent-amber)]'}`}>
                           {variance > 0 ? '+' : ''}{fmt(variance)}
                         </div>
                       </div>
                       <div className="flex items-center space-x-2 text-[var(--color-success)] bg-[rgba(16,185,129,0.1)] p-3 rounded-xl mt-4 justify-center">
                         <Lock size={16} />
                         <span className="text-[13px] font-sans font-medium">Register Locked by {user.name}</span>
                       </div>
                     </div>
                   ) : (
                     <div className="space-y-4">
                       <div>
                         <label htmlFor="eod-physical-cash-count" className="text-[13px] font-sans text-[var(--color-muted)] block mb-2">EOD Physical Cash Count</label>
                         <input
                           id="eod-physical-cash-count"
                           name="eod-physical-cash-count"
                           type="number"
                           min="0"
                           placeholder="Enter actual cash in till"
                           value={physicalInput}
                           onChange={e => setPhysicalInput(e.target.value)}
                           className="w-full h-12 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl px-4 text-[var(--color-foreground)] font-mono text-[16px] focus:outline-none focus:border-[var(--color-accent-cobalt)] focus:ring-1 focus:ring-[var(--color-accent-cobalt)] transition-all"
                         />
                       </div>
                       {physicalInput && (
                         <div className="flex justify-between items-center py-2">
                           <div className="text-[13px] font-sans text-[var(--color-muted)]">Variance</div>
                           <div className={`text-[15px] font-mono font-bold ${parseFloat(physicalInput) - expectedClosing === 0 ? 'text-[var(--color-success)]' : parseFloat(physicalInput) - expectedClosing < 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-accent-amber)]'}`}>
                             {parseFloat(physicalInput) - expectedClosing > 0 ? '+' : ''}{fmt(parseFloat(physicalInput) - expectedClosing)}
                           </div>
                         </div>
                       )}
                       <button 
                         onClick={handleLockRegister}
                         disabled={!physicalInput}
                         className="w-full h-12 bg-[var(--color-accent-cobalt)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[14px] font-sans font-bold rounded-xl transition-all flex items-center justify-center space-x-2"
                       >
                         <Lock size={16} />
                         <span>Lock Day</span>
                       </button>
                     </div>
                   )}
                 </div>
               )}
             </>
           )}
        </div>
      )}

      <Suspense fallback={(
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[var(--color-muted)]" size={24} />
        </div>
      )}>
      {activeTab === 'Credit Sales' && (
        <DebtorsTab
          transactions={transactions}
          user={user}
          onUpdateTx={(tx) => {
            if (onFullUpdateTx) {
              onFullUpdateTx(tx);
            }
          }}
        />
      )}
      {activeTab === 'B2B Sales' && (
        <B2BSalesTab
          transactions={filteredTx}
          user={user}
        />
      )}
      {activeTab === 'Expenses' && <ExpensesTab expenses={expenses} user={user} onAddExpense={onAddExpense} onUpdateExpense={onUpdateExpense} />}
      {activeTab === 'Payment Validation' && <PaymentValidation transactions={transactions} onUpdateTx={onFullUpdateTx!} user={user} />}
      </Suspense>
      {activeTab === 'Remittances' && (
        <div className="flex flex-col items-center justify-center p-8 py-16 text-center bg-[var(--color-surface-card)] rounded-xl border border-dashed border-[var(--color-surface-2)] mt-4">
           <Unlock size={36} className="text-[var(--color-muted)] mb-3" />
           <div className="text-[15px] font-sans font-medium text-[var(--color-foreground)] mb-1">Coming Next</div>
           <div className="text-[13px] font-sans text-[var(--color-muted)]">Hub Remittances module will be available soon.</div>
        </div>
      )}
      </div>{/* end ehi-page-body */}
    </div>
  );
};
