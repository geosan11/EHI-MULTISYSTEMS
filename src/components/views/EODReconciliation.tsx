import { useState, useMemo } from 'react';
import { User, Transaction, Expense } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { ArrowLeft, Check, AlertTriangle, Printer, Lock, ChevronRight } from 'lucide-react';
import { LoadingState } from './LoadingState';
import { supabase, writeAuditLog } from '../../lib/supabase';

interface Props {
  user: User;
  transactions: Transaction[];
  expenses: Expense[];
  onBack: () => void;
  onEOD: () => void;
}

export const EODReconciliation = ({ user, transactions, expenses, onBack, onEOD }: Props) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [isGenerating, setIsGenerating] = useState(false);

  // Filter to only include today's transactions
  const todaysTx = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return transactions.filter(t => {
      let d = new Date();
      if (t.created_at) d = new Date(t.created_at);
      return d >= today;
    });
  }, [transactions]);

  const todaysExp = useMemo(() => expenses, [expenses]);

  // System Totals
  const expectedTotals = useMemo(() => {
    const cargoTx = todaysTx.filter(t => t.type === 'cargo');
    const mktgTx  = todaysTx.filter(t => t.type === 'marketing');
    const vjTx    = todaysTx.filter(t => t.type === 'baggage');

    const cargoTotal = cargoTx.reduce((s, t) => s + t.amount, 0);
    const mktgTotal = mktgTx.reduce((s, t)  => s + t.amount, 0);
    const vjTotal = vjTx.reduce((s, t)    => s + t.amount, 0);
    const grossTotal = cargoTotal + mktgTotal + vjTotal;

    const cashTotal = todaysTx.filter(t => t.mode === 'Cash').reduce((s, t) => s + t.amount, 0);
    const transferTotal = todaysTx.filter(t => t.mode === 'Transfer' || t.mode === 'POS').reduce((s, t) => s + t.amount, 0);
    const posTotal = todaysTx.filter(t => t.mode === 'POS').reduce((s, t) => s + t.amount, 0);
    const debtTotal = todaysTx.filter(t => t.mode === 'Debt').reduce((s, t) => s + t.amount, 0);
    const expensesTotal = todaysExp.filter(e => !e.mode || e.mode === 'Cash').reduce((s, e) => s + e.amount, 0);
    
    // Net expected cash
    const netExpectedCash = cashTotal - expensesTotal;

    return {
      cargoTotal, mktgTotal, vjTotal, grossTotal,
      cashTotal, transferTotal, posTotal, debtTotal, expensesTotal, netExpectedCash,
      cargoCount: cargoTx.length, mktgCount: mktgTx.length, vjCount: vjTx.length
    };
  }, [transactions, expenses]);

  // Actual Counted
  const [countedCash, setCountedCash] = useState<number | ''>('');
  const [countedTransfer, setCountedTransfer] = useState<number | ''>(expectedTotals.transferTotal);
  const [countedPOS, setCountedPOS] = useState<number | ''>(expectedTotals.posTotal);
  
  // Variances
  const cashVariance = (countedCash === '' ? 0 : countedCash) - expectedTotals.netExpectedCash;
  const transferVariance = (countedTransfer === '' ? 0 : countedTransfer) - expectedTotals.transferTotal;
  const posVariance = (countedPOS === '' ? 0 : countedPOS) - expectedTotals.posTotal;

  // Reason
  const [varianceReason, setVarianceReason] = useState('');
  const needsReason = cashVariance !== 0 || transferVariance !== 0 || posVariance !== 0;

  // Remittance
  const [managerName, setManagerName] = useState('');

  // Denominations
  const [denoms, setDenoms] = useState({
    n1000: '', n500: '', n200: '', n100: '', n50: '', n20: '', n10: ''
  });
  const [showDenoms, setShowDenoms] = useState(false);

  const denomTotal = 
    (Number(denoms.n1000) * 1000) +
    (Number(denoms.n500) * 500) +
    (Number(denoms.n200) * 200) +
    (Number(denoms.n100) * 100) +
    (Number(denoms.n50) * 50) +
    (Number(denoms.n20) * 20) +
    (Number(denoms.n10) * 10);

  const handleApplyDenoms = () => {
    setCountedCash(denomTotal);
    setShowDenoms(false);
  };

  const generateEODData = () => ({
    date: new Date().toLocaleDateString('en-GB'),
    hubName: user.hub,
    lockedBy: user.name,
    lockedAt: new Date().toLocaleTimeString('en-GB'),
    cargoTotal: expectedTotals.cargoTotal,
    mktgTotal: expectedTotals.mktgTotal,
    vjTotal: expectedTotals.vjTotal,
    grossTotal: expectedTotals.grossTotal,
    cashTotal: expectedTotals.cashTotal,
    transferTotal: expectedTotals.transferTotal,
    posTotal: expectedTotals.posTotal,
    debtTotal: expectedTotals.debtTotal,
    totalExpenses: expectedTotals.expensesTotal,
    netCashToRemit: expectedTotals.netExpectedCash,
    countedCash: Number(countedCash) || 0,
    countedTransfer: Number(countedTransfer) || 0,
    countedPOS: Number(countedPOS) || 0,
    varianceReason: needsReason ? varianceReason : '',
    managerName,
    denoms: denomTotal > 0 ? denoms : undefined,
    cargoCount: expectedTotals.cargoCount,
    mktgCount: expectedTotals.mktgCount,
    vjCount: expectedTotals.vjCount,
    transactions,
    expenses,
  });

  const handlePrint = async () => {
    setIsGenerating(true);
    try {
      const { printEODReport } = await import('./EODReport');
      await printEODReport(generateEODData());
      setIsGenerating(false);
    } catch (err) {
      console.error(err);
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    setIsGenerating(true);
    try {
      const { downloadEODReport } = await import('./EODReport');
      await downloadEODReport(generateEODData());
      setIsGenerating(false);
    } catch (err) {
      console.error(err);
      setIsGenerating(false);
    }
  };

  const [showLockConfirm, setShowLockConfirm] = useState(false);

  const handleLockEOD = async () => {
    setIsGenerating(true);
    const date = new Date().toISOString().split('T')[0];
    await supabase.from('eod_records').upsert({
      hub: user.hub,
      hub_id: user.hub_id || null,
      date,
      locked_by: user.name,
      cargo_total: expectedTotals.cargoTotal,
      vj_total: expectedTotals.vjTotal,
      marketing_total: expectedTotals.mktgTotal,
      gross_total: expectedTotals.grossTotal,
      cash_total: expectedTotals.cashTotal,
      transfer_total: expectedTotals.transferTotal,
      pos_total: expectedTotals.posTotal,
      debt_total: expectedTotals.debtTotal,
      expense_total: expectedTotals.expensesTotal,
      net_cash: expectedTotals.netExpectedCash,
      status: 'locked'
    }, { onConflict: 'hub_id,date' });
    // Write to audit trail
    writeAuditLog({
      user_id: user.id,
      user_name: user.name,
      action: 'EOD_LOCK',
      description: `EOD locked by ${user.name} at ${user.hub} — gross ₦${expectedTotals.grossTotal.toLocaleString()} on ${date}`,
      hub: user.hub,
      hub_id: user.hub_id,
      new_values: { gross_total: expectedTotals.grossTotal, net_cash: expectedTotals.netExpectedCash, date },
    }).catch(() => {});

    // Send EOD summary to manager (fetch phone from settings or user's own phone)
    const managerPhone = localStorage.getItem('ehi_manager_phone') || '';
    if (managerPhone) {
      fetch('/api/notify/eod-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          managerPhone,
          hubName: user.hub,
          date,
          cargoTotal:    expectedTotals.cargoTotal,
          vjTotal:       expectedTotals.vjTotal,
          mktTotal:      expectedTotals.mktgTotal,
          grossTotal:    expectedTotals.grossTotal,
          cashTotal:     expectedTotals.cashTotal,
          transferTotal: expectedTotals.transferTotal,
          posTotal:      expectedTotals.posTotal,
          debtTotal:     expectedTotals.debtTotal,
          lockedBy:      user.name,
        }),
      }).catch(() => {});
    }

    setIsGenerating(false);
    onEOD();
  };

  const inputClass = "ehi-input";

  const renderStep1 = () => (
    <div className="animate-in fade-in space-y-4">
      <div className="text-[12px] font-mono text-[var(--color-muted)] mb-4">Review System Expected Totals</div>
      
      <div className="ehi-card overflow-hidden flex flex-col">
        <div className="p-3 border-b border-[var(--color-border)] flex justify-between items-center bg-[rgba(245,158,11,0.05)]">
          <span className="text-[11px] font-mono text-[var(--color-muted)]">Cargo Station</span>
          <span className="text-[14px] font-bold font-mono text-[var(--color-accent-amber)]">{fmt(expectedTotals.cargoTotal)}</span>
        </div>
        <div className="p-3 border-b border-[var(--color-border)] flex justify-between items-center bg-[rgba(16,185,129,0.05)]">
          <span className="text-[11px] font-mono text-[var(--color-muted)]">Field Marketing</span>
          <span className="text-[14px] font-bold font-mono text-[var(--color-success)]">{fmt(expectedTotals.mktgTotal)}</span>
        </div>
        <div className="p-3 border-b border-[var(--color-border)] flex justify-between items-center bg-[rgba(59,130,246,0.05)]">
          <span className="text-[11px] font-mono text-[var(--color-muted)]">ValueJet Baggage</span>
          <span className="text-[14px] font-bold font-mono text-[var(--color-accent-cobalt)]">{fmt(expectedTotals.vjTotal)}</span>
        </div>
        <div className="p-3 border-b border-[var(--color-border)] flex justify-between items-center bg-[rgba(255,255,255,0.02)]">
          <span className="text-[11px] font-bold font-mono text-[var(--color-foreground)]">Gross Total</span>
          <span className="text-[14px] font-bold font-mono text-[var(--color-foreground)]">{fmt(expectedTotals.grossTotal)}</span>
        </div>
      </div>

      <div className="ehi-card space-y-3">
        <div className="ehi-label">Expected Channels</div>
        <div className="flex justify-between items-center">
          <span className="text-[12px] font-mono text-[var(--color-muted)]">Cash Received</span>
          <span className="text-[14px] font-mono text-[var(--color-foreground)]">{fmt(expectedTotals.cashTotal)}</span>
        </div>
        <div className="flex justify-between items-center text-[var(--color-error)]">
          <span className="text-[12px] font-mono">Less: Cash Expenses</span>
          <span className="text-[14px] font-mono">-{fmt(expectedTotals.expensesTotal)}</span>
        </div>
        <div className="flex justify-between items-center pt-2 border-t border-[var(--color-border)]">
          <span className="text-[12px] font-bold font-mono text-[var(--color-foreground)]">Net Cash Expected</span>
          <span className="text-[16px] font-bold font-mono text-[var(--color-success)]">{fmt(expectedTotals.netExpectedCash)}</span>
        </div>
        
        <div className="flex justify-between items-center mt-4 pt-4 border-t border-[var(--color-border)]">
          <span className="text-[12px] font-mono text-[var(--color-muted)]">Transfer</span>
          <span className="text-[14px] font-mono text-[var(--color-foreground)]">{fmt(expectedTotals.transferTotal)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[12px] font-mono text-[var(--color-muted)]">POS Terminal</span>
          <span className="text-[14px] font-mono text-[var(--color-foreground)]">{fmt(expectedTotals.posTotal)}</span>
        </div>
        <div className="flex justify-between items-center opacity-60">
          <span className="text-[12px] font-mono text-[var(--color-muted)]">Debt (Credit)</span>
          <span className="text-[14px] font-mono text-[var(--color-foreground)]">{fmt(expectedTotals.debtTotal)}</span>
        </div>
      </div>

      <button onClick={() => setStep(2)} className="w-full h-12 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded font-bold font-mono flex justify-center items-center">
        NEXT: COUNT FUNDS <ChevronRight size={16} className="ml-2" />
      </button>
    </div>
  );

  const renderStep2 = () => (
    <div className="animate-in slide-in-from-right space-y-6">
      <div className="text-[12px] font-mono text-[var(--color-muted)]">Count physical funds and confirm terminal totals.</div>
      
      {showDenoms ? (
        <div className="ehi-card space-y-4">
          <div className="flex justify-between items-center border-b border-[var(--color-surface-2)] pb-2 mb-2">
            <span className="text-[12px] font-mono text-[var(--color-foreground)]">Cash Denominations</span>
            <button onClick={() => setShowDenoms(false)} className="text-[10px] text-[var(--color-accent-amber)] font-mono">CLOSE</button>
          </div>
          {Object.keys(denoms).map((k) => {
            const val = k.replace('n', '');
            return (
              <div key={k} className="flex items-center space-x-3">
                <div className="w-16 text-right text-[12px] font-mono text-[var(--color-muted)]">₦{val} x</div>
                <input 
                  type="number" 
                  value={denoms[k as keyof typeof denoms]} 
                  onChange={e => setDenoms({...denoms, [k]: e.target.value})}
                  className="ehi-input"
                  placeholder="0"
                />
              </div>
            );
          })}
          <div className="flex justify-between items-center pt-2 border-t border-[var(--color-surface-2)]">
            <span className="text-[12px] font-mono">Total Counted:</span>
            <span className="text-[16px] font-bold font-mono text-[var(--color-success)]">{fmt(denomTotal)}</span>
          </div>
          <button onClick={handleApplyDenoms} className="w-full h-10 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[12px] font-bold font-mono hover:bg-[var(--color-surface-2)] transition-colors">
            APPLY TO CASH COUNT
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="ehi-label">Physical Cash Counted</label>
            <div className="relative">
              <input 
                type="number" 
                value={countedCash}
                onChange={e => setCountedCash(e.target.value === '' ? '' : Number(e.target.value))}
                className={inputClass}
                placeholder="Enter physical cash in till..."
              />
              <button 
                onClick={() => setShowDenoms(true)}
                className="absolute right-2 top-2 h-8 px-3 bg-[var(--color-surface-2)] border border-[var(--color-surface-2)] rounded text-[10px] font-mono hover:bg-[var(--color-muted)] transition-colors"
              >
                USE DENOMS
              </button>
            </div>
          </div>
          <div>
            <label className="ehi-label">Bank Transfer Verified</label>
            <input 
              type="number" 
              value={countedTransfer}
              onChange={e => setCountedTransfer(e.target.value === '' ? '' : Number(e.target.value))}
              className={inputClass}
            />
            <div className="text-[10px] text-[var(--color-muted)] font-mono mt-1">Expected: {fmt(expectedTotals.transferTotal)}</div>
          </div>
          <div>
            <label className="ehi-label">POS Z-Report Total</label>
            <input 
              type="number" 
              value={countedPOS}
              onChange={e => setCountedPOS(e.target.value === '' ? '' : Number(e.target.value))}
              className={inputClass}
            />
            <div className="text-[10px] text-[var(--color-muted)] font-mono mt-1">Expected: {fmt(expectedTotals.posTotal)}</div>
          </div>
        </div>
      )}

      {!showDenoms && (
        <div className="flex gap-3">
          <button onClick={() => setStep(1)} className="ehi-btn-secondary ehi-btn">BACK</button>
          <button 
            onClick={() => setStep(3)} 
            disabled={countedCash === ''}
            className="flex-[2] h-12 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded font-bold font-mono disabled:opacity-50"
          >
            NEXT: RECONCILE
          </button>
        </div>
      )}
    </div>
  );

  const VarianceRow = ({ label, expected, actual, variance }: { label: string, expected: number, actual: number, variance: number }) => (
    <div className="py-2 border-b border-[var(--color-border)]">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[12px] font-mono text-[var(--color-muted)]">{label}</span>
        <span className="text-[12px] font-mono">Exp: {fmt(expected)}</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-[14px] font-mono font-bold text-[var(--color-foreground)]">Act: {fmt(actual)}</span>
        {variance === 0 ? (
          <span className="text-[12px] font-mono text-[var(--color-success)] bg-[rgba(16,185,129,0.1)] px-2 py-0.5 rounded flex items-center">
            <Check size={12} className="mr-1" /> Balanced
          </span>
        ) : variance < 0 ? (
          <span className="text-[12px] font-mono text-[var(--color-error)] bg-[rgba(239,68,68,0.1)] px-2 py-0.5 rounded flex items-center">
            Short {fmt(Math.abs(variance))}
          </span>
        ) : (
          <span className="text-[12px] font-mono text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.1)] px-2 py-0.5 rounded flex items-center">
            Over {fmt(variance)}
          </span>
        )}
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="animate-in slide-in-from-right space-y-6">
      <div className="text-[12px] font-mono text-[var(--color-muted)]">Variance Report</div>
      
      <div className="ehi-card p-4">
        <VarianceRow label="Net Cash" expected={expectedTotals.netExpectedCash} actual={Number(countedCash)} variance={cashVariance} />
        <VarianceRow label="Transfer" expected={expectedTotals.transferTotal} actual={Number(countedTransfer)} variance={transferVariance} />
        <VarianceRow label="POS" expected={expectedTotals.posTotal} actual={Number(countedPOS)} variance={posVariance} />
        
        {needsReason && (
          <div className="mt-4 pt-4 border-t border-[var(--color-surface-2)]">
            <label className="block text-[11px] font-mono text-[var(--color-error)] mb-2 uppercase tracking-wider flex items-center">
              <AlertTriangle size={14} className="mr-1" /> Reason for Variance Required
            </label>
            <textarea 
              value={varianceReason}
              onChange={e => setVarianceReason(e.target.value)}
              className="ehi-input"
              placeholder="Explain shortages or overages..."
            />
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button onClick={() => setStep(2)} className="ehi-btn-secondary ehi-btn">BACK</button>
        <button 
          onClick={() => setStep(4)} 
          disabled={needsReason && varianceReason.trim().length < 5}
          className="flex-[2] h-12 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded font-bold font-mono disabled:opacity-50"
        >
          NEXT: REMIT
        </button>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="animate-in slide-in-from-right space-y-6">
      <div className="text-[12px] font-mono text-[var(--color-muted)]">Final Remittance</div>
      
      <div className="bg-[rgba(16,185,129,0.05)] border border-[var(--color-success)] rounded p-6 text-center space-y-2">
        <div className="ehi-label">Physical Cash to Remit</div>
        <div className="text-[32px] font-bold font-mono text-[var(--color-success)]">{fmt(Number(countedCash))}</div>
        <div className="text-[12px] font-mono text-[var(--color-muted)] pt-2 border-t border-[var(--color-border)] mx-auto w-3/4">
          Ensure exact physical match before locking.
        </div>
      </div>

      <div>
        <label className="ehi-label">Manager Receiving (Optional)</label>
        <input 
          type="text" 
          value={managerName}
          onChange={e => setManagerName(e.target.value)}
          className={inputClass}
          placeholder="e.g. Mr. Tunji"
        />
      </div>

      <div className="flex flex-col gap-3 pt-4">
        <div className="flex gap-3">
          <button 
            onClick={handlePrint}
            disabled={isGenerating}
            className="flex-1 py-3 border border-[rgba(245,158,11,0.4)] text-[var(--color-accent-amber)] text-[11px] font-bold font-mono rounded cursor-pointer flex items-center justify-center bg-transparent hover:bg-[rgba(245,158,11,0.05)]"
          >
            🖨 PRINT
          </button>
          <button 
            onClick={handleDownload}
            disabled={isGenerating}
            className="ehi-btn-secondary ehi-btn"
          >
            {isGenerating ? 'GENERATING...' : '⬇ DOWNLOAD REPORT'}
          </button>
        </div>
        <button
          onClick={() => setShowLockConfirm(true)}
          className="ehi-btn-destructive ehi-btn"
        >
          <Lock size={16} className="mr-2" /> LOCK SYSTEM (EOD)
        </button>
        <button onClick={() => setStep(3)} className="w-full mt-2 h-10 text-[var(--color-muted)] text-[11px] font-bold font-mono underline hover:text-[var(--color-foreground)]">GO BACK</button>
      </div>

      {showLockConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="ehi-card max-w-xs w-full p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[rgba(239,68,68,0.15)] flex items-center justify-center shrink-0">
                <Lock size={18} className="text-[var(--color-error)]" />
              </div>
              <div>
                <p className="text-[14px] font-bold text-[var(--color-foreground)]">Lock End of Day?</p>
                <p className="text-[11px] text-[var(--color-muted)] mt-0.5">This cannot be undone. All entries will be frozen.</p>
              </div>
            </div>
            <div className="bg-[rgba(239,68,68,0.05)] border border-[rgba(239,68,68,0.2)] rounded-lg p-3">
              <p className="text-[11px] font-mono text-[var(--color-muted)]">Net cash to remit: <span className="text-[var(--color-foreground)] font-bold">{fmt(Number(countedCash))}</span></p>
              <p className="text-[11px] font-mono text-[var(--color-muted)] mt-1">Hub: <span className="text-[var(--color-foreground)]">{user.hub}</span></p>
              <p className="text-[11px] font-mono text-[var(--color-muted)] mt-1">Agent: <span className="text-[var(--color-foreground)]">{user.name}</span></p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLockConfirm(false)}
                className="flex-1 h-11 border border-[var(--color-border)] rounded-lg text-[12px] font-bold text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowLockConfirm(false); handleLockEOD(); }}
                className="flex-1 h-11 bg-[var(--color-error)] text-white rounded-lg text-[12px] font-bold hover:bg-red-700 transition-colors"
              >
                Yes, Lock EOD
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const stepNames = ['Review', 'Count', 'Reconcile', 'Remit'];

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] overflow-y-auto">
      {/* Sticky header */}
      <div className="ehi-view-header">
        <button onClick={onBack} className="flex items-center space-x-2 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● EOD RECONCILIATION</span>
        <div className="w-16" />
      </div>

      {/* Constrained content */}
      <div className="ehi-page-body px-4 py-4 pb-24 relative text-[var(--color-foreground)] animate-in slide-in-from-right">
        <div className="text-[15px] font-bold font-mono text-[var(--color-foreground)] mb-4 tracking-wide">
          Daily Close — {user.hub}
        </div>

      <div className="flex items-center justify-between mb-8 relative">
        <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-[var(--color-surface-2)] -z-10" />
        {[1, 2, 3, 4].map(s => (
          <div key={s} className="flex flex-col items-center bg-[var(--color-obsidian)] px-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono border ${s === step ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] border-[var(--color-accent-amber)]' : s < step ? 'bg-[rgba(245,158,11,0.2)] text-[var(--color-accent-amber)] border-[var(--color-accent-amber)]' : 'bg-[var(--color-surface-card)] text-[var(--color-muted)] border-[var(--color-surface-2)]'}`}>
              {s < step ? <Check size={12} /> : s}
            </div>
            <span className={`text-[9px] font-mono mt-1 ${s === step ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-muted)]'}`}>{stepNames[s-1]}</span>
          </div>
        ))}
      </div>

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
      
      {isGenerating && (
        <LoadingState fullScreen message="GENERATING REPORT..." />
      )}
      </div>{/* end ehi-page-body */}
    </div>
  );
};
