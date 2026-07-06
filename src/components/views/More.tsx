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
import { SupportTickets } from './SupportTickets';

import { PricingConfiguration } from './PricingConfiguration';
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
  BarChart,
  Layers,
  Truck,
  Brain,
  ShieldAlert,
  Key,
  DollarSign,
  History,
  MapPin,
  Percent,
  Users,
  Plane,
  CreditCard,
  Terminal,
  ChevronRight,
  PackageCheck,
  Upload,
  BookOpen,
  ClipboardList,
} from 'lucide-react';

import { StaffManagement } from './StaffManagement';

export const More = ({ user, transactions, expenses, onLogout, onEOD, onAddTx, onFullUpdateTx, onAddExpense, onUpdateExpense, onChangeTab, dateRange, onDateRangeChange }: { user: User; transactions: Transaction[]; expenses: Expense[]; onLogout: () => void; onEOD?: (summary: any) => void; onAddTx: (tx: Transaction) => void; onFullUpdateTx?: (tx: Transaction) => void; onAddExpense: (e: Expense) => void; onUpdateExpense?: (expenseId: string, decision: 'approved' | 'rejected') => void; onChangeTab: (t: TabView) => void; dateRange?: { start: string; end: string }; onDateRangeChange?: (range: { start: string; end: string }) => void; }) => {
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
  const [pricingView, setPricingView] = useState(false);
  const [supportView, setSupportView] = useState(false);
  const [staffView, setStaffView] = useState(false);

  // View controllers
  if (eodView) {
    return <EODReconciliation user={user} transactions={transactions} expenses={expenses} onBack={() => setEodView(false)} onEOD={onEOD || (() => {})} />;
  }

  if (accountingView) {
    return <AccountingConsole user={user} transactions={transactions} expenses={expenses} onBack={() => setAccountingView(false)} onAddExpense={onAddExpense} onUpdateExpense={onUpdateExpense} onOpenBankRecon={() => setBankReconView(true)} onFullUpdateTx={onFullUpdateTx} />;
  }

  if (reportsView) {
    return <Reports user={user} transactions={transactions} onBack={() => setReportsView(false)} />;
  }

  if (settingsView) {
    return <Settings user={user} onBack={() => setSettingsView(false)} />;
  }

  if (bankReconView) {
    return <BankReconciliation 
      transactions={transactions} 
      onBack={() => setBankReconView(false)} 
      onConfirm={({ matchedIds }) => {
        if (onFullUpdateTx) {
          matchedIds.forEach(id => {
            const tx = transactions.find(t => t.id === id);
            if (tx) {
              onFullUpdateTx({ ...tx, paymentConfirmed: true, confirmedAt: new Date().toLocaleTimeString('en-NG'), confirmedBy: user.name });
            }
          });
        }
      }}
    />;
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
    return <TransactionLedger user={user} transactions={transactions} expenses={expenses} onBack={() => setLedgerView(false)} onUpdateTx={onFullUpdateTx || onAddTx} dateRange={dateRange} onDateRangeChange={onDateRangeChange} />;
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

  if (pricingView) {
    return <PricingConfiguration user={user} onBack={() => setPricingView(false)} />;
  }

  if (supportView) {
    return <SupportTickets user={user} onBack={() => setSupportView(false)} />;
  }

  if (staffView) {
    return <StaffManagement user={user} onBack={() => setStaffView(false)} />;
  }

  // Role checking helpers
  const canAccessAccounting = user.role === 'admin' || user.role === 'super_admin' || user.role === 'accountant';
  const canAccessRecon = user.role === 'super_admin' || user.role === 'accountant';
  const canAccessFleetAndForecast = user.role === 'super_admin' || user.role === 'admin';
  const canAccessFraud = user.role === 'super_admin' || user.role === 'admin' || user.role === 'auditor';
  const canAccessAuditLog = user.role === 'super_admin' || user.role === 'auditor';
  const isSuperAdmin = user.role === 'super_admin';

  const MenuItem = ({
    icon: Icon,
    title,
    subtitle,
    onClick,
    disabled = false,
  }: {
    icon: any;
    title: any;
    subtitle: string;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 py-3.5 border-b border-[var(--color-border)] transition-colors text-left ${
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : 'hover:bg-[var(--color-surface-1)] cursor-pointer group'
      }`}
    >
      <Icon size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors shrink-0" />
      <div className="text-left flex-1 min-w-0">
        <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors flex items-center gap-1.5">
          {title}
        </div>
        <div className="text-[10px] font-mono text-[var(--color-muted)] truncate">{subtitle}</div>
      </div>
      {!disabled && (
        <ChevronRight size={16} strokeWidth={1.5} className="text-[var(--color-muted)] shrink-0" />
      )}
    </button>
  );

  const SectionLabel = ({ label }: { label: string }) => (
    <div className="text-[9px] font-mono text-[var(--color-muted)] tracking-[0.12em] uppercase pt-4 pb-1.5 px-1">
      ▸ {label}
    </div>
  );

  return (
    <div className="p-4 pb-8 select-none">

      {/* Daily Operations */}
      <SectionLabel label="Daily Operations" />
      <div>
        {['super_admin', 'admin', 'cargo_agent', 'office_work'].includes(user.role) && (
          <MenuItem
            icon={PackageCheck}
            title="Incoming to Hub"
            subtitle="Manage arriving cargo"
            onClick={() => onChangeTab('Incoming')}
          />
        )}
        <MenuItem
          icon={FileText}
          title="EOD Daily Close"
          subtitle="Generate and dispatch end of day reports"
          onClick={() => setEodView(true)}
        />
        <MenuItem
          icon={Activity}
          title="Transaction Ledger"
          subtitle={`${transactions.length} entries — view, search and export`}
          onClick={() => setLedgerView(true)}
        />
        {(user.role === 'super_admin' || user.role === 'admin') && (
          <MenuItem
            icon={Plane}
            title="ValueJet POS"
            subtitle="Excess baggage counter — MMA2 terminal"
            onClick={() => onChangeTab('VJ POS')}
          />
        )}
      </div>

      {/* Finance */}
      <SectionLabel label="Finance" />
      <div>
        <MenuItem
          icon={CreditCard}
          title="Credit & Debit"
          subtitle="View receivables and payables (Airline commissions)"
          onClick={() => onChangeTab('Credit & Debit')}
          disabled={!canAccessAccounting}
        />
        <MenuItem
          icon={Layers}
          title={
            <span className="flex items-center gap-1.5">
              Bank Reconciliation
              <span className="text-[8px] font-mono bg-[var(--color-surface-2)] text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] px-1.5 py-0.5 rounded tracking-wide font-black uppercase transition-colors">CSV AUTO</span>
            </span>
          }
          subtitle="Match bank deposits with system payment ledgers"
          onClick={() => { if (canAccessRecon) setBankReconView(true); }}
          disabled={!canAccessRecon}
        />
        <MenuItem
          icon={Database}
          title="Central Accounting ERP"
          subtitle="Check balance sheets and cash flows dashboard"
          onClick={() => { if (canAccessAccounting) setAccountingView(true); }}
          disabled={!canAccessAccounting}
        />
        <MenuItem
          icon={BarChart}
          title="Advanced Reports"
          subtitle="Operational audits and trend sheets"
          onClick={() => { if (canAccessAccounting) setReportsView(true); }}
          disabled={!canAccessAccounting}
        />
        <MenuItem
          icon={Percent}
          title="Airline Commissions"
          subtitle="Set percentage cuts for partner airlines"
          onClick={() => { if (canAccessAccounting) setAirlineCommissionsView(true); }}
          disabled={!canAccessAccounting}
        />
      </div>

      {/* Intelligence */}
      <SectionLabel label="Intelligence" />
      <div>
        <MenuItem
          icon={Brain}
          title={
            <span className="flex items-center gap-1.5">
              Demand Forecasting AI
              <span className="text-[8px] font-mono bg-[var(--color-surface-2)] text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] px-1.5 py-0.5 rounded tracking-wide font-black uppercase transition-colors">Gemini Intel</span>
            </span>
          }
          subtitle="Capacity heatmap and busy periods projections"
          onClick={() => { if (canAccessFleetAndForecast) setForecastingView(true); }}
          disabled={!canAccessFleetAndForecast}
        />
        <MenuItem
          icon={ShieldAlert}
          title={
            <span className="flex items-center gap-2">
              Fraud &amp; Anomalies Feed
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-muted)] group-hover:bg-amber-400 opacity-75 transition-colors"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-muted)] group-hover:bg-amber-500 transition-colors"></span>
              </span>
            </span>
          }
          subtitle="Track sudden debt spikes and duplicated AWBs"
          onClick={() => { if (canAccessFraud) setFraudAlertsView(true); }}
          disabled={!canAccessFraud}
        />
        <MenuItem
          icon={History}
          title="Revision Audit Log"
          subtitle="Strict NDPR/Financial compliance trace log"
          onClick={() => { if (canAccessAuditLog) setAuditLogView(true); }}
          disabled={!canAccessAuditLog}
        />
      </div>

      {/* Fleet & Logistics */}
      <SectionLabel label="Fleet & Logistics" />
      <div>
        <MenuItem
          icon={Truck}
          title="Fleet Management"
          subtitle="Vehicles registration, service scheduler, fuel expense log"
          onClick={() => { if (canAccessFleetAndForecast) setFleetView(true); }}
          disabled={!canAccessFleetAndForecast}
        />
        <MenuItem
          icon={Shield}
          title="Proof of Delivery Log"
          subtitle="GPS trace, signatures and photo evidence"
          onClick={() => { if (canAccessFraud) setPodLogView(true); }}
          disabled={!canAccessFraud}
        />
        <MenuItem
          icon={MapPin}
          title="Dispatch & Fleet Tracking"
          subtitle="Live driver tracking on active routes"
          onClick={() => { if (canAccessFleetAndForecast) setDispatchView(true); }}
          disabled={!canAccessFleetAndForecast}
        />
      </div>

      {/* Data */}
      <SectionLabel label="Data & Records" />
      <div>
        <MenuItem
          icon={BookOpen}
          title="Airline Balance Ledger"
          subtitle="Per-airline running Credit / Debit / Cheque Raise ledger"
          onClick={() => onChangeTab('AirlineLedger')}
          disabled={!canAccessAccounting}
        />
        <MenuItem
          icon={ClipboardList}
          title="Weight Manifest"
          subtitle="Daily dispatch weight tracking per flight and route"
          onClick={() => onChangeTab('WeightManifest')}
          disabled={!['super_admin','admin','cargo_agent','office_work'].includes(user.role)}
        />
        <MenuItem
          icon={Upload}
          title="Import Historical Data"
          subtitle="Bulk import ledger records from CSV spreadsheets"
          onClick={() => onChangeTab('DataImport')}
          disabled={!isSuperAdmin && user.role !== 'admin'}
        />
      </div>

      {/* Administration */}
      <SectionLabel label="Administration" />
      <div>
        <MenuItem
          icon={Plane}
          title="Airline Logos"
          subtitle="Manage uploaded logos for all partner airlines"
          onClick={() => onChangeTab('AirlineLogos')}
          disabled={!isSuperAdmin && user.role !== 'admin'}
        />
        <MenuItem
          icon={Terminal}
          title="IT Debug Console"
          subtitle="Live system logs, debugging and diagnostics"
          onClick={() => onChangeTab('IT Debug')}
          disabled={!isSuperAdmin}
        />
        <MenuItem
          icon={Key}
          title="Partners API Keys & Webhooks"
          subtitle="Key-hashes, scopes limit, and integration documentation"
          onClick={() => { if (isSuperAdmin) setApiDashboardView(true); }}
          disabled={!isSuperAdmin}
        />
        <MenuItem
          icon={DollarSign}
          title="Pricing & Rates Configuration"
          subtitle="B2B client rates and retail standard tariffs"
          onClick={() => { if (isSuperAdmin) setPricingView(true); }}
          disabled={!isSuperAdmin}
        />
        <MenuItem
          icon={SettingsIcon}
          title="Platform Settings"
          subtitle="Automation and route pricing configuration"
          onClick={() => { if (isSuperAdmin) setSettingsView(true); }}
          disabled={!isSuperAdmin}
        />
      </div>

      {/* Support & Account */}
      <SectionLabel label="Support & Account" />
      <div>
        {(user.role === 'super_admin' || user.role === 'admin') && (
          <MenuItem
            icon={Users}
            title="Staff Management"
            subtitle="Add staff, assign hubs, set roles, deactivate accounts"
            onClick={() => setStaffView(true)}
          />
        )}
        <MenuItem
          icon={ShieldAlert}
          title="Help Desk & Issue Resolution"
          subtitle="Report operational complaints or bugs"
          onClick={() => setSupportView(true)}
        />

        <button
          onClick={onLogout}
          className="w-full mt-2 flex items-center gap-3 py-3.5 cursor-pointer group text-left"
        >
          <LogOut size={18} strokeWidth={1.5} className="text-[var(--color-error)] shrink-0" />
          <div className="text-left flex-1">
            <div className="text-[13px] font-bold font-sans text-[var(--color-error)]">Sign Out</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)] opacity-80">{user.name} &middot; {user.hub}</div>
          </div>
        </button>
      </div>

    </div>
  );
};
