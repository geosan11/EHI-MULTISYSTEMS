import { AccountingConsole } from './AccountingConsole';
import { Reports } from './Reports';
import { Settings } from './Settings';
import { BankReconciliation } from './BankReconciliation';
import { Fleet } from './Fleet';
import { Forecasting } from './Forecasting';
import { FraudAlerts } from './FraudAlerts';
import { AuditLog } from './AuditLog';
import { APIDashboard } from './APIDashboard';
import { TransactionLedger } from './TransactionLedger';

import { useState } from 'react';
import { User, Transaction, Expense } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { 
  FileText, 
  Activity, 
  Database, 
  Shield, 
  Settings as SettingsIcon, 
  LogOut, 
  ArrowLeft, 
  BarChart, 
  Layers, 
  Truck, 
  Brain, 
  ShieldAlert, 
  Key, 
  History 
} from 'lucide-react';

export const More = ({ user, transactions, expenses, onLogout, onEOD, onAddTx, onAddExpense }: { user: User; transactions: Transaction[]; expenses: Expense[]; onLogout: () => void; onEOD: () => void; onAddTx: (tx: Transaction) => void; onAddExpense: (e: Expense) => void }) => {
  const [eodView, setEodView] = useState(false);
  const [accountingView, setAccountingView] = useState(false);
  const [reportsView, setReportsView] = useState(false);
  const [settingsView, setSettingsView] = useState(false);
  
  // Premium Enterprise modules views states
  const [bankReconView, setBankReconView] = useState(false);
  const [fleetView, setFleetView] = useState(false);
  const [forecastingView, setForecastingView] = useState(false);
  const [fraudAlertsView, setFraudAlertsView] = useState(false);
  const [auditLogView, setAuditLogView] = useState(false);
  const [apiDashboardView, setApiDashboardView] = useState(false);
  const [ledgerView, setLedgerView] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);

  const buildEODData = () => {
    const cargoTx = transactions.filter(t => t.type === 'cargo');
    const mktgTx  = transactions.filter(t => t.type === 'marketing');
    const vjTx    = transactions.filter(t => t.type === 'baggage');
    return {
      date:           new Date().toLocaleDateString('en-GB'),
      hubName:        user.hub,
      lockedBy:       user.name,
      lockedAt:       new Date().toLocaleTimeString('en-GB'),
      cargoTotal:     cargoTx.reduce((s, t) => s + t.amount, 0),
      mktgTotal:      mktgTx.reduce((s, t)  => s + t.amount, 0),
      vjTotal:        vjTx.reduce((s, t)    => s + t.amount, 0),
      grossTotal:     transactions.reduce((s, t) => s + t.amount, 0),
      cashTotal:      transactions.filter(t => t.mode === 'Cash')
                        .reduce((s, t) => s + t.amount, 0),
      transferTotal:  transactions
                        .filter(t => t.mode === 'Transfer' || t.mode === 'Transfer-as-Cash')
                        .reduce((s, t) => s + t.amount, 0),
      debtTotal:      transactions.filter(t => t.mode === 'Debt')
                        .reduce((s, t) => s + t.amount, 0),
      totalExpenses:  expenses.reduce((s, e) => s + e.amount, 0),
      netCashToRemit: transactions.filter(t => t.mode === 'Cash')
                        .reduce((s, t) => s + t.amount, 0)
                      - expenses.reduce((s, e) => s + e.amount, 0),
      cargoCount: cargoTx.length,
      mktgCount:  mktgTx.length,
      vjCount:    vjTx.length,
      transactions,
      expenses,
    };
  };

  const handleLockEOD = async () => {
    setIsGenerating(true);
    try {
      const { downloadEODReport } = await import('./EODReport');
      await downloadEODReport(buildEODData());
      setTimeout(() => {
        setIsGenerating(false);
        setEodView(false);
        onEOD();
      }, 800);
    } catch (err) {
      console.error(err);
      setIsGenerating(false);
    }
  };

  // View controllers
  if (accountingView) {
    return <AccountingConsole user={user} transactions={transactions} expenses={expenses} onBack={() => setAccountingView(false)} onAddExpense={onAddExpense} onOpenBankRecon={() => setBankReconView(true)} />;
  }

  if (reportsView) {
    return <Reports user={user} transactions={transactions} onBack={() => setReportsView(false)} />;
  }

  if (settingsView) {
    return <Settings user={user} onBack={() => setSettingsView(false)} />;
  }

  if (bankReconView) {
    return <BankReconciliation transactions={transactions} onBack={() => setBankReconView(false)} />;
  }

  if (fleetView) {
    return <Fleet onBack={() => setFleetView(false)} />;
  }

  if (forecastingView) {
    return <Forecasting onBack={() => setForecastingView(false)} />;
  }

  if (fraudAlertsView) {
    return <FraudAlerts onBack={() => setFraudAlertsView(false)} />;
  }

  if (ledgerView) {
    return <TransactionLedger user={user} transactions={transactions} onBack={() => setLedgerView(false)} onUpdateTx={onAddTx} />;
  }

  if (auditLogView) {
    return <AuditLog onBack={() => setAuditLogView(false)} />;
  }

  if (apiDashboardView) {
    return <APIDashboard onBack={() => setApiDashboardView(false)} />;
  }

  if (eodView) {
    const cargoTx = transactions.filter(t => t.type === 'cargo');
    const mktgTx = transactions.filter(t => t.type === 'marketing');
    const vjTx = transactions.filter(t => t.type === 'baggage');

    const cargoTotal = cargoTx.reduce((sum, t) => sum + t.amount, 0);
    const mktgTotal = mktgTx.reduce((sum, t) => sum + t.amount, 0);
    const vjTotal = vjTx.reduce((sum, t) => sum + t.amount, 0);
    const gt = cargoTotal + mktgTotal + vjTotal;

    const cashTotal = transactions.reduce((sum, t) => sum + (t.mode === 'Cash' ? t.amount : 0), 0);
    const transferTotal = transactions.reduce((sum, t) => sum + (t.mode === 'Transfer' || t.mode === 'Transfer-as-Cash' ? t.amount : 0), 0);

    return (
      <div className="flex flex-col h-full bg-[var(--color-obsidian)] p-4 relative text-[var(--color-foreground)] animate-in slide-in-from-right overflow-y-auto pb-[60px]">
        <button onClick={() => setEodView(false)} className="flex items-center space-x-2 text-[var(--color-light-muted)] mb-4 w-max p-2 -ml-2 rounded hover:bg-[var(--color-surface-2)]">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>

        <div className="text-[9px] font-mono text-[var(--color-accent-amber)] tracking-[0.1em] uppercase mb-4">▸ EOD DAILY CLOSE</div>
        <div className="text-[12px] font-mono text-white mb-6 bg-[rgba(255,255,255,0.05)] px-3 py-2 rounded max-w-max border border-[rgba(255,255,255,0.1)]">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}
        </div>
        
        <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded overflow-hidden flex flex-col mb-8">
          <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-[rgba(245,158,11,0.05)]">
            <span className="text-[11px] font-mono text-[var(--color-muted)]">Cargo Station</span>
            <span className="text-[14px] font-bold font-mono text-[var(--color-accent-amber)]">{fmt(cargoTotal)}</span>
          </div>
          <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-[rgba(16,185,129,0.05)]">
            <span className="text-[11px] font-mono text-[var(--color-muted)]">Field Marketing</span>
            <span className="text-[14px] font-bold font-mono text-[var(--color-success)]">{fmt(mktgTotal)}</span>
          </div>
          <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-[rgba(59,130,246,0.05)]">
            <span className="text-[11px] font-mono text-[var(--color-muted)]">ValueJet Baggage</span>
            <span className="text-[14px] font-bold font-mono text-[var(--color-accent-cobalt)]">{fmt(vjTotal)}</span>
          </div>
          <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-[rgba(16,185,129,0.05)]">
            <span className="text-[11px] font-bold font-mono text-white">Grand Total</span>
            <span className="text-[16px] font-bold font-mono text-[var(--color-success)]">{fmt(gt)}</span>
          </div>
          <div className="p-4 flex flex-col space-y-2 bg-[var(--color-surface-1)]">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-mono text-[var(--color-muted)]">Cash</span>
              <span className="text-[12px] font-mono text-white">{fmt(cashTotal)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-mono text-[var(--color-muted)]">Transfer</span>
              <span className="text-[12px] font-mono text-white">{fmt(transferTotal)}</span>
            </div>
          </div>
          <div className="p-3 border-t border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] flex justify-between items-center">
            <span className="text-[10px] font-mono text-[var(--color-muted)]">Total Transactions</span>
            <span className="text-[11px] font-bold font-mono text-white">{transactions.length}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            onClick={async () => {
              const { printEODReport } = await import('./EODReport');
              const cargoTx = transactions.filter(t => t.type === 'cargo');
              const mktgTx = transactions.filter(t => t.type === 'marketing');
              const vjTx = transactions.filter(t => t.type === 'baggage');
              await printEODReport({
                date: new Date().toLocaleDateString('en-GB'),
                hubName: user.hub,
                lockedBy: user.name,
                lockedAt: new Date().toLocaleTimeString('en-GB'),
                cargoTotal: cargoTx.reduce((s, t) => s + t.amount, 0),
                mktgTotal: mktgTx.reduce((s, t) => s + t.amount, 0),
                vjTotal: vjTx.reduce((s, t) => s + t.amount, 0),
                grossTotal: transactions.reduce((s, t) => s + t.amount, 0),
                cashTotal: transactions.filter(t => t.mode === 'Cash').reduce((s, t) => s + t.amount, 0),
                transferTotal: transactions.filter(t => t.mode === 'Transfer').reduce((s, t) => s + t.amount, 0),
                debtTotal: transactions.filter(t => t.mode === 'Debt').reduce((s, t) => s + t.amount, 0),
                totalExpenses: expenses.reduce((s, e) => s + e.amount, 0),
                netCashToRemit: transactions.filter(t => t.mode === 'Cash').reduce((s, t) => s + t.amount, 0) - expenses.reduce((s, e) => s + e.amount, 0),
                cargoCount: cargoTx.length, mktgCount: mktgTx.length, vjCount: vjTx.length,
                transactions, expenses,
              });
            }}
            className="flex-1 py-3 border border-[rgba(245,158,11,0.4)] text-[var(--color-accent-amber)] text-[11px] font-bold font-mono rounded cursor-pointer"
            style={{ background: 'transparent' }}
          >
            🖨 PRINT
          </button>
          <button
            onClick={handleLockEOD}
            disabled={isGenerating}
            className="flex-[2] py-3 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[12px] font-bold font-mono rounded disabled:opacity-60 cursor-pointer"
          >
            {isGenerating ? 'GENERATING...' : '⬇ DOWNLOAD REPORT'}
          </button>
        </div>
      </div>
    );
  }

  // Role checking helpers
  const canAccessAccounting = user.role === 'admin' || user.role === 'super_admin' || user.role === 'accountant';
  const canAccessRecon = user.role === 'super_admin' || user.role === 'accountant';
  const canAccessFleetAndForecast = user.role === 'super_admin' || user.role === 'admin';
  const canAccessFraud = user.role === 'super_admin' || user.role === 'admin' || user.role === 'auditor';
  const canAccessAuditLog = user.role === 'super_admin' || user.role === 'auditor';
  const isSuperAdmin = user.role === 'super_admin';

  return (
    <div className="p-4 space-y-3 pb-8 select-none">
      
      {/* EOD Button */}
      <button 
        onClick={() => setEodView(true)}
        className="w-full bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] transition-colors border border-[rgba(245,158,11,0.2)] rounded p-4 flex items-center justify-between"
      >
        <div className="flex items-center space-x-3">
          <FileText size={18} className="text-[var(--color-accent-amber)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">EOD Daily Close</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Generate and dispatch end of day reports</div>
          </div>
        </div>
      </button>

      {/* Bank Reconciliation (NEW Premium Module) */}
      <button 
        onClick={() => { if (canAccessRecon) setBankReconView(true); }}
        className={`w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between transition-colors ${canAccessRecon ? 'hover:border-[var(--color-accent-cobalt)] hover:bg-[var(--color-surface-2)] cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
      >
        <div className="flex items-center space-x-3">
          <Layers size={18} className="text-[var(--color-accent-cobalt)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white flex items-center space-x-1.5">
              <span>Bank Reconciliation</span>
              <span className="text-[8px] font-mono bg-blue-500/10 text-[var(--color-accent-cobalt)] px-1.5 py-0.5 rounded tracking-wide font-black uppercase">CSV AUTO</span>
            </div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Match bank deposits with system payment ledgers</div>
          </div>
        </div>
      </button>

      {/* Fleet Management (NEW Premium Module) */}
      <button 
        onClick={() => { if (canAccessFleetAndForecast) setFleetView(true); }}
        className={`w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between transition-colors ${canAccessFleetAndForecast ? 'hover:border-purple-400 hover:bg-[var(--color-surface-2)] cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
      >
        <div className="flex items-center space-x-3">
          <Truck size={18} className="text-purple-400" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">Fleet Management</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Vehicles registration, service scheduler, fuel expense log</div>
          </div>
        </div>
      </button>

      {/* Demand Forecasting (NEW Premium Module) */}
      <button 
        onClick={() => { if (canAccessFleetAndForecast) setForecastingView(true); }}
        className={`w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between transition-colors ${canAccessFleetAndForecast ? 'hover:border-[var(--color-accent-amber)] hover:bg-[var(--color-surface-2)] cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
      >
        <div className="flex items-center space-x-3">
          <Brain size={18} className="text-[var(--color-accent-amber)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white flex items-center space-x-1.5">
              <span>Demand Forecasting AI</span>
              <span className="text-[8px] font-mono bg-amber-500/10 text-[var(--color-accent-amber)] px-1.5 py-0.5 rounded tracking-wide font-black uppercase">Gemini Intel</span>
            </div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Capacity heatmap and busy periods projections</div>
          </div>
        </div>
      </button>

      {/* Fraud Safety Feed (NEW Premium Module) */}
      <button 
        onClick={() => { if (canAccessFraud) setFraudAlertsView(true); }}
        className={`w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between transition-colors ${canAccessFraud ? 'hover:border-[var(--color-error)] hover:bg-[var(--color-surface-2)] cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
      >
        <div className="flex items-center space-x-3">
          <ShieldAlert size={18} className="text-[var(--color-error)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white flex items-center space-x-2">
              <span>Fraud & Anomalies Feed</span>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
            </div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Track sudden debt spikes and duplicated AWBs</div>
          </div>
        </div>
      </button>

      {/* Base Tracking list (Legacy) */}
      <button 
        onClick={() => { if (canAccessAccounting) setLedgerView(true); }}
        className={`w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between transition-colors ${canAccessAccounting ? 'hover:border-[var(--color-accent-amber)] hover:bg-[var(--color-surface-2)] cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
      >
        <div className="flex items-center space-x-3">
          <Activity size={18} className="text-[var(--color-accent-amber)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">Transaction Ledger</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">{transactions.length} total records logged</div>
          </div>
        </div>
      </button>

      {/* Accounting (Accessible only to Accountants/Admins/Super Admins) */}
      <button 
        onClick={() => { if (canAccessAccounting) setAccountingView(true); }}
        className={`w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between transition-colors ${canAccessAccounting ? 'hover:border-[var(--color-success)] hover:bg-[var(--color-surface-2)] cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
      >
        <div className="flex items-center space-x-3">
          <Database size={18} className="text-[var(--color-success)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">Central Accounting ERP</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Check balance sheets and cash flows dashboard</div>
          </div>
        </div>
      </button>

      {/* Reports (Accessible only to Accountants/Admins/Super Admins) */}
      <button 
        onClick={() => { if (canAccessAccounting) setReportsView(true); }}
        className={`w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between transition-colors ${canAccessAccounting ? 'hover:border-[var(--color-success)] hover:bg-[var(--color-surface-2)] cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
      >
        <div className="flex items-center space-x-3">
          <BarChart size={18} className="text-[var(--color-success)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">Advanced Reports</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Operational audits and trend sheets</div>
          </div>
        </div>
      </button>

      {/* Audit Log Trail (NEW Premium Module) */}
      <button 
        onClick={() => { if (canAccessAuditLog) setAuditLogView(true); }}
        className={`w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between transition-colors ${canAccessAuditLog ? 'hover:border-purple-550 hover:bg-[var(--color-surface-2)] cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
      >
        <div className="flex items-center space-x-3">
          <History size={18} className="text-purple-400" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">Revision Audit Log</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Strict NDPR/Financial compliance trace log</div>
          </div>
        </div>
      </button>

      {/* API Dashboard Credentials (NEW Premium Module) */}
      <button 
        onClick={() => { if (isSuperAdmin) setApiDashboardView(true); }}
        className={`w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between transition-colors ${isSuperAdmin ? 'hover:border-blue-400 hover:bg-[var(--color-surface-2)] cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
      >
        <div className="flex items-center space-x-3">
          <Key size={18} className="text-[var(--color-accent-cobalt)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">Partners API Keys & Webhooks</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Key-hashes, scopes limit, and integration documentation</div>
          </div>
        </div>
      </button>

      {/* Settings Console (Accessible to Super Admins only) */}
      <button 
        onClick={() => { if (isSuperAdmin) setSettingsView(true); }}
        className={`w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between transition-colors ${isSuperAdmin ? 'hover:border-[var(--color-accent-amber)] hover:bg-[var(--color-surface-2)] cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
      >
        <div className="flex items-center space-x-3">
          <SettingsIcon size={18} className="text-[var(--color-accent-amber)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">Platform Settings</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Automation and route pricing configuration</div>
          </div>
        </div>
      </button>

      {/* Sign Out Trigger */}
      <button 
        onClick={() => {
          onLogout();
        }}
        className="w-full mt-4 bg-[var(--color-surface-1)] hover:bg-[rgba(239,68,68,0.1)] transition-colors border border-[rgba(255,255,255,0.07)] hover:border-[rgba(239,68,68,0.3)] rounded p-4 flex items-center space-x-3 cursor-pointer"
      >
        <LogOut size={18} className="text-[var(--color-error)]" />
        <div className="text-left">
          <div className="text-[13px] font-bold font-sans text-[var(--color-error)]">Sign Out</div>
          <div className="text-[10px] font-mono text-[var(--color-error)] opacity-80">{user.name} &middot; {user.hub}</div>
        </div>
      </button>

    </div>
  );
};
