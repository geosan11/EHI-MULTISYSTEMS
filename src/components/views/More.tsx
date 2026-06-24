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
import { PODLog } from './PODLog';
import { Dispatch } from './Dispatch';
import { EODReconciliation } from './EODReconciliation';

import { AirlineCommissions } from './AirlineCommissions';

import { useState } from 'react';
import { User, TabView, Transaction, Expense } from '../../lib/types';
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
  History,
  MapPin,
  Cpu,
  Percent
} from 'lucide-react';

export const More = ({ user, transactions, expenses, onLogout, onEOD, onAddTx, onAddExpense, onChangeTab }: { user: User; transactions: Transaction[]; expenses: Expense[]; onLogout: () => void; onEOD: () => void; onAddTx: (tx: Transaction) => void; onAddExpense: (e: Expense) => void; onChangeTab: (t: TabView) => void }) => {
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
  const [podLogView, setPodLogView] = useState(false);
  const [dispatchView, setDispatchView] = useState(false);
  const [airlineCommissionsView, setAirlineCommissionsView] = useState(false);

  // View controllers
  if (eodView) {
    return <EODReconciliation user={user} transactions={transactions} expenses={expenses} onBack={() => setEodView(false)} onEOD={onEOD} />;
  }

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
    return <TransactionLedger user={user} transactions={transactions} expenses={expenses} onBack={() => setLedgerView(false)} onUpdateTx={onAddTx} />;
  }

  if (auditLogView) {
    return <AuditLog onBack={() => setAuditLogView(false)} />;
  }

  if (apiDashboardView) {
    return <APIDashboard onBack={() => setApiDashboardView(false)} />;
  }

  if (podLogView) {
    return <PODLog onBack={() => setPodLogView(false)} />;
  }

  if (dispatchView) {
    return <Dispatch onBack={() => setDispatchView(false)} />;
  }

  if (airlineCommissionsView) {
    return <AirlineCommissions onBack={() => setAirlineCommissionsView(false)} />;
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
        className="w-full bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] transition-colors border border-[rgba(255,255,255,0.07)] hover:border-[var(--color-accent-amber)] rounded p-4 flex items-center space-x-3 cursor-pointer group"
      >
        <FileText size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">EOD Daily Close</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Generate and dispatch end of day reports</div>
        </div>
      </button>

      {/* Bank Reconciliation (NEW Premium Module) */}
      <button 
        onClick={() => { if (canAccessRecon) setBankReconView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${canAccessRecon ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <Layers size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors flex items-center space-x-1.5">
            <span>Bank Reconciliation</span>
            <span className="text-[8px] font-mono bg-[rgba(255,255,255,0.1)] group-hover:bg-amber-500/10 text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] px-1.5 py-0.5 rounded tracking-wide font-black uppercase transition-colors">CSV AUTO</span>
          </div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Match bank deposits with system payment ledgers</div>
        </div>
      </button>

      {/* Fleet Management (NEW Premium Module) */}
      <button 
        onClick={() => { if (canAccessFleetAndForecast) setFleetView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${canAccessFleetAndForecast ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <Truck size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">Fleet Management</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Vehicles registration, service scheduler, fuel expense log</div>
        </div>
      </button>

      {/* Demand Forecasting (NEW Premium Module) */}
      <button 
        onClick={() => { if (canAccessFleetAndForecast) setForecastingView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${canAccessFleetAndForecast ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <Brain size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors flex items-center space-x-1.5">
            <span>Demand Forecasting AI</span>
            <span className="text-[8px] font-mono bg-[rgba(255,255,255,0.1)] group-hover:bg-amber-500/10 text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] px-1.5 py-0.5 rounded tracking-wide font-black uppercase transition-colors">Gemini Intel</span>
          </div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Capacity heatmap and busy periods projections</div>
        </div>
      </button>

      {/* Fraud Safety Feed (NEW Premium Module) */}
      <button 
        onClick={() => { if (canAccessFraud) setFraudAlertsView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${canAccessFraud ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <ShieldAlert size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors flex items-center space-x-2">
            <span>Fraud & Anomalies Feed</span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-muted)] group-hover:bg-amber-400 opacity-75 transition-colors"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-muted)] group-hover:bg-amber-500 transition-colors"></span>
            </span>
          </div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Track sudden debt spikes and duplicated AWBs</div>
        </div>
      </button>

      {/* Base Tracking list (Legacy) */}
      <button 
        onClick={() => { if (canAccessAccounting) setLedgerView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${canAccessAccounting ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <Activity size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">Transaction Ledger</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">{transactions.length} total records logged</div>
        </div>
      </button>

      {/* Accounting (Accessible only to Accountants/Admins/Super Admins) */}
      <button 
        onClick={() => { if (canAccessAccounting) setAccountingView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${canAccessAccounting ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <Database size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">Central Accounting ERP</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Check balance sheets and cash flows dashboard</div>
        </div>
      </button>

      {/* Reports (Accessible only to Accountants/Admins/Super Admins) */}
      <button 
        onClick={() => { if (canAccessAccounting) setReportsView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${canAccessAccounting ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <BarChart size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">Advanced Reports</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Operational audits and trend sheets</div>
        </div>
      </button>

      {/* Proof of Delivery Log */}
      <button 
        onClick={() => { if (canAccessFraud) setPodLogView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${canAccessFraud ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <Shield size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">Proof of Delivery Log</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">GPS trace, signatures and photo evidence</div>
        </div>
      </button>

      {/* Audit Log Trail (NEW Premium Module) */}
      <button 
        onClick={() => { if (canAccessAuditLog) setAuditLogView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${canAccessAuditLog ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <History size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">Revision Audit Log</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Strict NDPR/Financial compliance trace log</div>
        </div>
      </button>

      {/* Dispatch Console */}
      <button 
        onClick={() => { if (canAccessFleetAndForecast) setDispatchView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${canAccessFleetAndForecast ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <MapPin size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">Dispatch & Fleet Tracking</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Live driver tracking on active routes</div>
        </div>
      </button>

      {/* API Dashboard Credentials (NEW Premium Module) */}
      <button 
        onClick={() => { if (isSuperAdmin) setApiDashboardView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${isSuperAdmin ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <Key size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">Partners API Keys & Webhooks</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Key-hashes, scopes limit, and integration documentation</div>
        </div>
      </button>

      {/* Settings Console (Accessible to Super Admins only) */}
      <button 
        onClick={() => { if (isSuperAdmin) setSettingsView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${isSuperAdmin ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <SettingsIcon size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">Platform Settings</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Automation and route pricing configuration</div>
        </div>
      </button>

      {/* Airline Commissions Settings */}
      <button 
        onClick={() => { if (canAccessAccounting) setAirlineCommissionsView(true); }}
        className={`w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center space-x-3 ${canAccessAccounting ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] cursor-pointer group' : 'opacity-40 cursor-not-allowed'}`}
      >
        <Percent size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">Airline Commissions</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Set percentage cuts for partner airlines</div>
        </div>
      </button>

      {/* IT Systems Debugging (Accessible to Admins and Super Admins) */}
      {(user.role === 'admin' || isSuperAdmin) && (
        <button 
          onClick={() => { onChangeTab('IT Debug'); }}
          className="w-full bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] rounded p-4 flex items-center space-x-3 cursor-pointer group"
        >
          <Cpu size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
          <div className="text-left flex-1">
            <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">IT Systems Debugging & Fallbacks</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Check real-time timeouts, database schemas, and offline logs</div>
          </div>
        </button>
      )}

      {/* Sign Out Trigger */}
      <button 
        onClick={() => {
          onLogout();
        }}
        className="w-full mt-4 bg-[var(--color-surface-1)] transition-colors border border-[rgba(255,255,255,0.07)] hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent-amber)] rounded p-4 flex items-center space-x-3 cursor-pointer group"
      >
        <LogOut size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        <div className="text-left flex-1">
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors">Sign Out</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)] opacity-80 group-hover:text-[var(--color-accent-amber)] transition-colors">{user.name} &middot; {user.hub}</div>
        </div>
      </button>

    </div>
  );
};
