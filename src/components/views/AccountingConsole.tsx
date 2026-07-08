import React, { useState, useEffect, useMemo } from 'react';
import { User, Transaction, Expense } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Box, Plane, TrendingUp, Lock, Unlock, AlertCircle } from 'lucide-react';
import { DebtorsTab } from './DebtorsTab';
import { ExpensesTab } from './ExpensesTab';
import { BankReconciliation } from './BankReconciliation';
import { PaymentValidation } from './PaymentValidation';

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
}

export const AccountingConsole = ({ user, transactions, expenses, onBack, onAddExpense, onUpdateExpense, onUpdateTx, onOpenBankRecon, onFullUpdateTx }: AccountingConsoleProps) => {
  const [activeTab, setActiveTab] = useState<'Summary' | 'Cash Register' | 'Credit Sales' | 'Expenses' | 'Remittances' | 'Payment Validation'>('Summary');
  const [period, setPeriod] = useState<'Today' | 'This Week' | 'This Month' | 'Custom'>('Today');
  const [customStart, setCustomStart] = useState(new Date().toISOString().split('T')[0]);
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().split('T')[0]);

  const unconfirmedCount = useMemo(() => {
    return transactions.filter(t => t.mode === 'Transfer' && !t.paymentConfirmed).length;
  }, [transactions]);

  const { filteredTx, filteredExp } = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const fTx = transactions.filter(t => {
      let d = new Date();
      if (t.created_at) d = new Date(t.created_at);
      if (period === 'Today') return d >= today;
      if (period === 'This Week') return d >= weekAgo;
      if (period === 'This Month') return d >= monthAgo;
      if (period === 'Custom') {
        const start = new Date(customStart);
        const end = new Date(customEnd);
        end.setHours(23, 59, 59, 999);
        return d >= start && d <= end;
      }
      return true;
    });

    const fExp = expenses.filter(e => {
      const d = e.created_at ? new Date(e.created_at) : today;
      if (period === 'Today') return d >= today;
      if (period === 'This Week') return d >= weekAgo;
      if (period === 'This Month') return d >= monthAgo;
      if (period === 'Custom') {
        const start = new Date(customStart);
        const end = new Date(customEnd);
        end.setHours(23, 59, 59, 999);
        return d >= start && d <= end;
      }
      return true;
    });

    return { filteredTx: fTx, filteredExp: fExp };
  }, [transactions, expenses, period, customStart, customEnd]);

  // ==== SUMMARY TAB CALCULATIONS ====
  const cargoTx = filteredTx.filter(t => t.type === 'cargo');
  const vjTx = filteredTx.filter(t => t.type === 'baggage');
  const mktgTx = filteredTx.filter(t => t.type === 'marketing');

  const cargoTotal = cargoTx.reduce((sum, t) => sum + t.amount, 0);
  const vjTotal = vjTx.reduce((sum, t) => sum + t.amount, 0);
  const mktgTotal = mktgTx.reduce((sum, t) => sum + t.amount, 0);

  const grandRevenue = cargoTotal + vjTotal + mktgTotal;
  // Only approved spend counts as real outflow. Pending/rejected expenses
  // must not distort Net Revenue.
  const approvedExp = filteredExp.filter(e => (e.status || 'approved') === 'approved');
  const totalExpenses = approvedExp.reduce((sum, e) => sum + e.amount, 0);
  const pendingExpTotal = filteredExp.filter(e => e.status === 'pending').reduce((sum, e) => sum + e.amount, 0);
  const netRevenue = grandRevenue - totalExpenses;

  const cashTotal = filteredTx.reduce((sum, t) => sum + (t.mode === 'Cash' ? t.amount : 0), 0);
  const transferTotal = filteredTx.reduce((sum, t) => sum + (t.mode === 'Transfer' ? t.amount : 0), 0);
  const posTotal = filteredTx.reduce((sum, t) => sum + (t.mode === 'POS' ? t.amount : 0), 0);
  const debtTotal = filteredTx.reduce((sum, t) => sum + (t.mode === 'Debt' ? t.amount : 0), 0);
  const modeSum = cashTotal + transferTotal + posTotal + debtTotal;

  const cashPct = modeSum ? (cashTotal / modeSum) * 100 : 0;
  const transferPct = modeSum ? (transferTotal / modeSum) * 100 : 0;
  const posPct = modeSum ? (posTotal / modeSum) * 100 : 0;
  const debtPct = modeSum ? (debtTotal / modeSum) * 100 : 0;

  const collectionEff = grandRevenue ? ((cashTotal + transferTotal + posTotal) / grandRevenue) * 100 : 0;
  const collectionColor = collectionEff >= 90 ? 'text-[var(--color-success)]' : collectionEff >= 70 ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-error)]';
  const vatEstimate = grandRevenue * 0.075;

  // ==== CASH REGISTER STATE ====
  // Backed by eod_records (hub_id, date) -- the same table EODReconciliation.tsx
  // locks the day against -- instead of a separate localStorage register that
  // could silently disagree with it.
  const todayStr = new Date().toISOString().split('T')[0];
  const [regDate, setRegDate] = useState(todayStr);

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
    if (!isNaN(val)) {
      setOpeningBalance(val);
      setShowOpeningModal(false);
      await supabase.from('eod_records').upsert({
        hub_id: user.hub_id,
        hub: user.hub,
        date: regDate,
        opening_balance: val,
        status: 'open'
      }, { onConflict: 'hub_id,date' });
    }
  };

  const handleLockRegister = async () => {
    const val = parseFloat(physicalInput);
    if (!isNaN(val)) {
      setPhysicalCount(val);
      setIsLocked(true);
      await supabase.from('eod_records').upsert({
        hub_id: user.hub_id,
        hub: user.hub,
        date: regDate,
        opening_balance: openingBalance,
        physical_count: val,
        status: 'locked'
      }, { onConflict: 'hub_id,date' });
    }
  };

  // Scoped to the register's own date (regDate), not the whole history --
  // otherwise this silently accumulates every transaction/expense ever
  // logged since go-live, making the EOD variance meaningless.
  // A debt payment leaves the parent transaction's mode as 'Debt'/'Debt Paid'
  // (never 'Cash'), so today's cash recovered against an old debt would be
  // invisible to a mode-only filter -- pull it from paymentHistory instead.
  const debtCashRecoveredToday = transactions.reduce((sum, t) => {
    const todays = (t.paymentHistory || []).filter(p => p.mode === 'Cash' && p.at.split('T')[0] === regDate);
    return sum + todays.reduce((s, p) => s + p.amount, 0);
  }, 0);
  const regReceipts = transactions
    .filter(t => t.mode === 'Cash' && t.created_at && t.created_at.split('T')[0] === regDate)
    .reduce((sum, t) => sum + t.amount, 0) + debtCashRecoveredToday;
  // Only approved expenses actually left the register -- a pending or
  // rejected expense hasn't (or won't) be paid out, so counting it here
  // would falsely shrink the expected closing balance.
  const regPayments = expenses
    .filter(e => (e.status || 'approved') === 'approved' && e.mode === 'Cash' && e.created_at && e.created_at.split('T')[0] === regDate)
    .reduce((sum, e) => sum + e.amount, 0);
  const expectedClosing = (openingBalance || 0) + regReceipts - regPayments;
  const variance = physicalCount !== null ? physicalCount - expectedClosing : 0;

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] overflow-y-auto animate-in slide-in-from-right">
      <div className="ehi-page-body px-4 pt-4 relative text-[var(--color-foreground)]">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="flex items-center space-x-2 text-[var(--color-light-muted)] w-max p-2 -ml-2 rounded-xl hover:bg-[var(--color-surface-2)] transition-colors focus:outline-none">
          <ArrowLeft size={18} />
          <span className="text-[14px] font-sans font-medium">Accounting</span>
        </button>
      </div>

      {/* TABS HEADER */}
      <div className="relative mb-4">
      <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-hide">
        {['Summary', 'Cash Register', 'Credit Sales', 'Expenses', 'Payment Validation', 'Remittances'].map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t as any)}
            className={`px-4 py-2 text-[13px] font-sans font-medium rounded-full whitespace-nowrap transition-colors focus:outline-none flex items-center ${activeTab === t ? 'bg-[var(--color-accent-cobalt)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
          >
            {t}
            {t === 'Payment Validation' && unconfirmedCount > 0 && (
              <span className="ml-2 bg-[var(--color-accent-amber)] text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
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

             <div className="min-w-[200px] flex-1 bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] p-4 relative overflow-hidden snap-start">
                <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-[var(--color-accent-cobalt)]" />
                <div className="flex items-center space-x-2 mb-2 ml-2">
                  <Plane size={16} className="text-[var(--color-accent-cobalt)]" />
                  <span className="text-[13px] font-sans font-medium text-[var(--color-muted)]">ValueJet POS</span>
                </div>
                <div className="text-[20px] font-bold font-mono text-[var(--color-accent-cobalt)] ml-2 mb-1">{fmt(vjTotal)}</div>
                <div className="text-[12px] font-sans text-[var(--color-light-muted)] ml-2 mb-3">{vjTx.length} Passengers</div>
             </div>

             <div className="min-w-[200px] flex-1 bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] p-4 relative overflow-hidden snap-start">
                <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-[var(--color-success)]" />
                <div className="flex items-center space-x-2 mb-2 ml-2">
                  <TrendingUp size={16} className="text-[var(--color-success)]" />
                  <span className="text-[13px] font-sans font-medium text-[var(--color-muted)]">Field Marketing</span>
                </div>
                <div className="text-[20px] font-bold font-mono text-[var(--color-success)] ml-2 mb-1">{fmt(mktgTotal)}</div>
                <div className="text-[12px] font-sans text-[var(--color-light-muted)] ml-2 mb-3">{mktgTx.length} Customers</div>
             </div>
          </div>

          {/* NET REVENUE BLOCK */}
          <div className="bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] p-5">
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
             <div className="bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] p-5">
               <div className="text-[13px] font-sans font-medium text-[var(--color-muted)] mb-4">Collection Breakdown</div>
               <div className="w-full h-4 flex rounded-full overflow-hidden mb-4">
                 {cashPct > 0 && <div style={{width: `${cashPct}%`}} className="bg-[var(--color-success)]" title={`Cash: ${fmt(cashTotal)}`} />}
                 {transferPct > 0 && <div style={{width: `${transferPct}%`}} className="bg-[var(--color-accent-cobalt)]" title={`Bank Transfer: ${fmt(transferTotal)}`} />}
                 {posPct > 0 && <div style={{width: `${posPct}%`}} className="bg-[var(--color-accent-amber)]" title={`POS / Card: ${fmt(posTotal)}`} />}
                 {debtPct > 0 && <div style={{width: `${debtPct}%`}} className="bg-[var(--color-error)]" title={`On Credit: ${fmt(debtTotal)}`} />}
               </div>
               <div className="grid grid-cols-2 gap-3 text-[12px] font-sans">
                  <div className="flex items-center space-x-2"><div className="w-2 h-2 rounded-full bg-[var(--color-success)]"/> <span className="text-[var(--color-light-muted)]">Cash: {cashPct.toFixed(0)}% ({fmt(cashTotal)})</span></div>
                  <div className="flex items-center space-x-2"><div className="w-2 h-2 rounded-full bg-[var(--color-accent-cobalt)]"/> <span className="text-[var(--color-light-muted)]">Bank Transfer: {transferPct.toFixed(0)}% ({fmt(transferTotal)})</span></div>
                  <div className="flex items-center space-x-2"><div className="w-2 h-2 rounded-full bg-[var(--color-accent-amber)]"/> <span className="text-[var(--color-light-muted)]">POS / Card: {posPct.toFixed(0)}% ({fmt(posTotal)})</span></div>
                  <div className="flex items-center space-x-2"><div className="w-2 h-2 rounded-full bg-[var(--color-error)]"/> <span className="text-[var(--color-light-muted)]">On Credit: {debtPct.toFixed(0)}% ({fmt(debtTotal)})</span></div>
               </div>
             </div>

             <div className="bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] p-5 flex flex-col justify-between relative overflow-hidden">
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
             <div className="bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] p-5 animate-in fade-in zoom-in-95">
               <h3 className="text-[16px] font-sans font-bold text-[var(--color-foreground)] mb-2">Set Opening Balance</h3>
               <p className="text-[13px] font-sans text-[var(--color-muted)] mb-4">Enter the cash carried over from yesterday's closing count.</p>
               <input 
                 type="number"
                 placeholder="e.g. 15000"
                 value={openingInput}
                 onChange={e => setOpeningInput(e.target.value)}
                 className="w-full h-12 bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded-xl px-4 text-[var(--color-foreground)] font-mono text-[16px] focus:outline-none focus:border-[var(--color-accent-cobalt)] focus:ring-1 focus:ring-[var(--color-accent-cobalt)] transition-all mb-4"
               />
               <button 
                 onClick={handleSetOpening}
                 className="w-full h-12 bg-[var(--color-accent-cobalt)] hover:bg-opacity-90 text-white text-[14px] font-sans font-bold rounded-xl transition-all"
               >
                 Confirm Opening Balance
               </button>
             </div>
           )}

           {!showOpeningModal && (
             <>
               <div className="flex items-center justify-between bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] p-2 px-3">
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

               <div className="bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] p-5 space-y-4">
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
                 <div className="bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] p-5">
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
                           type="number"
                           placeholder="Enter actual cash in till"
                           value={physicalInput}
                           onChange={e => setPhysicalInput(e.target.value)}
                           className="w-full h-12 bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded-xl px-4 text-[var(--color-foreground)] font-mono text-[16px] focus:outline-none focus:border-[var(--color-accent-cobalt)] focus:ring-1 focus:ring-[var(--color-accent-cobalt)] transition-all"
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
                         className="w-full h-12 bg-[var(--color-accent-cobalt)] hover:bg-opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[14px] font-sans font-bold rounded-xl transition-all flex items-center justify-center space-x-2"
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

      {activeTab === 'Credit Sales' && (
        <DebtorsTab
          transactions={transactions}
          user={user}
          onUpdateTx={(id, update) => {
            if (onFullUpdateTx) {
              const tx = transactions.find(t => t.id === id);
              if (tx) onFullUpdateTx({ ...tx, ...update });
            }
          }}
        />
      )}
      {activeTab === 'Expenses' && <ExpensesTab expenses={expenses} user={user} onAddExpense={onAddExpense} onUpdateExpense={onUpdateExpense} />}
      {activeTab === 'Payment Validation' && <PaymentValidation transactions={transactions} onUpdateTx={onFullUpdateTx!} user={user} />}
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
