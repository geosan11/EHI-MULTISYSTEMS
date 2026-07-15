import { AccountingConsole } from './AccountingConsole';
import { Reports } from './Reports';
import { Settings } from './Settings';
import { BankReconciliation } from './BankReconciliation';
import { Fleet } from './Fleet';
import { Forecasting } from './Forecasting';
import { FraudAlerts } from './FraudAlerts';
import { AuditLog } from './AuditLog';
import { TransactionLedger } from './TransactionLedger';
import { PODLog } from './PODLog';
import { Dispatch } from './Dispatch';
import { EODReconciliation } from './EODReconciliation';
import { SupportTickets } from './SupportTickets';

import { PricingConfiguration } from './PricingConfiguration';
import { HubCargoRates } from './HubCargoRates';
import { AirlineCommissions } from './AirlineCommissions';
import { ExcessBaggageAirlines } from './ExcessBaggageAirlines';
import { CorporateBilling } from './CorporateBilling';

import { useState } from 'react';
import { User, TabView, Transaction, Expense, ExcessBaggageAirline } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { canAccessTab } from '../../lib/permissions';
import {
  FileTextIcon,
  PulseIcon,
  DatabaseIcon,
  ShieldIcon,
  GearIcon,
  SignOutIcon,
  ChartBarIcon,
  StackIcon,
  TruckIcon,
  BrainIcon,
  ShieldWarningIcon,
  CurrencyDollarIcon,
  ClockCounterClockwiseIcon,
  MapPinIcon,
  PercentIcon,
  UsersIcon,
  AirplaneIcon,
  CreditCardIcon,
  TerminalIcon,
  SealCheckIcon,
  CheckCircleIcon,
  UploadSimpleIcon,
  BookOpenIcon,
  ClipboardTextIcon,
  ReceiptIcon,
} from '@phosphor-icons/react';
import { ChevronRight } from 'lucide-react';

import { StaffManagement } from './StaffManagement';

export const More = ({ user, transactions, expenses, onLogout, onEOD, onAddTx, onFullUpdateTx, onAddExpense, onUpdateExpense, onChangeTab, dateRange, onDateRangeChange, excessBaggageAirlines }: { user: User; transactions: Transaction[]; expenses: Expense[]; onLogout: () => void; onEOD?: (summary: any) => void; onAddTx: (tx: Transaction) => void; onFullUpdateTx?: (tx: Transaction) => void; onAddExpense: (e: Expense) => void; onUpdateExpense?: (expenseId: string, decision: 'approved' | 'rejected') => void; onChangeTab: (t: TabView) => void; dateRange?: { start: string; end: string }; onDateRangeChange?: (range: { start: string; end: string }) => void; excessBaggageAirlines: ExcessBaggageAirline[]; }) => {
  const [eodView, setEodView] = useState(false);
  const [accountingView, setAccountingView] = useState(false);
  const [reportsView, setReportsView] = useState(false);
  const [settingsView, setSettingsView] = useState(false);
  const [excessBaggageAirlinesView, setExcessBaggageAirlinesView] = useState(false);

  // Premium Enterprise modules views states
  const [bankReconView, setBankReconView] = useState(false);
  const [fleetView, setFleetView] = useState(false);
  const [forecastingView, setForecastingView] = useState(false);
  const [fraudAlertsView, setFraudAlertsView] = useState(false);
  const [auditLogView, setAuditLogView] = useState(false);
  const [ledgerView, setLedgerView] = useState(false);
  const [podLogView, setPodLogView] = useState(false);
  const [dispatchView, setDispatchView] = useState(false);
  const [airlineCommissionsView, setAirlineCommissionsView] = useState(false);
  const [corporateBillingView, setCorporateBillingView] = useState(false);
  const [pricingView, setPricingView] = useState(false);
  const [hubCargoRatesView, setHubCargoRatesView] = useState(false);
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
      user={user}
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

  if (podLogView) {
    return <PODLog user={user} onBack={() => setPodLogView(false)} />;
  }

  if (dispatchView) {
    return <Dispatch onBack={() => setDispatchView(false)} />;
  }

  if (airlineCommissionsView) {
    return <AirlineCommissions onBack={() => setAirlineCommissionsView(false)} />;
  }

  if (corporateBillingView) {
    return <CorporateBilling user={user} onBack={() => setCorporateBillingView(false)} />;
  }

  if (pricingView) {
    return <PricingConfiguration user={user} onBack={() => setPricingView(false)} />;
  }

  if (hubCargoRatesView) {
    return <HubCargoRates user={user} onBack={() => setHubCargoRatesView(false)} />;
  }

  if (excessBaggageAirlinesView) {
    return <ExcessBaggageAirlines onBack={() => setExcessBaggageAirlinesView(false)} />;
  }

  if (supportView) {
    return <SupportTickets user={user} onBack={() => setSupportView(false)} />;
  }

  if (staffView) {
    return <StaffManagement user={user} onBack={() => setStaffView(false)} />;
  }


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
      <Icon size={18} weight="regular" className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors shrink-0" />
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
        {canAccessTab(user, 'Incoming', excessBaggageAirlines) && (
          <MenuItem
            icon={SealCheckIcon}
            title="Incoming to Hub"
            subtitle="Manage arriving cargo"
            onClick={() => onChangeTab('Incoming')}
          />
        )}
        {canAccessTab(user, 'OutboundArrivals', excessBaggageAirlines) && (
          <MenuItem
            icon={CheckCircleIcon}
            title="Outbound Arrivals"
            subtitle="Confirm dispatched shipments arrived"
            onClick={() => onChangeTab('OutboundArrivals')}
          />
        )}
        {canAccessTab(user, 'More:EODClose', excessBaggageAirlines) && (
          <MenuItem
            icon={FileTextIcon}
            title="EOD Daily Close"
            subtitle="Generate and dispatch end of day reports"
            onClick={() => setEodView(true)}
          />
        )}
        {canAccessTab(user, 'More:TransactionLedger', excessBaggageAirlines) && (
          <MenuItem
            icon={PulseIcon}
            title="Transaction Ledger"
            subtitle={`${transactions.length} entries — view, search and export`}
            onClick={() => setLedgerView(true)}
          />
        )}
        {excessBaggageAirlines.filter(a => canAccessTab(user, `Baggage:${a.name}`, excessBaggageAirlines)).map(a => (
          <MenuItem
            key={a.id}
            icon={AirplaneIcon}
            title={`${a.name} POS`}
            subtitle="Excess baggage counter"
            onClick={() => onChangeTab(`Baggage:${a.name}`)}
          />
        ))}
        {canAccessTab(user, 'Packages', excessBaggageAirlines) && (
          <MenuItem
            icon={TruckIcon}
            title="Package & Parcel Desk"
            subtitle="Flat-fee package and parcel counter"
            onClick={() => onChangeTab('Packages')}
          />
        )}
      </div>

      {/* Finance */}
      <SectionLabel label="Finance" />
      <div>
        <MenuItem
          icon={CreditCardIcon}
          title="Credit & Debit"
          subtitle="View receivables and payables (Airline commissions)"
          onClick={() => onChangeTab('Credit & Debit')}
          disabled={!canAccessTab(user, 'Credit & Debit', excessBaggageAirlines)}
        />
        <MenuItem
          icon={StackIcon}
          title={
            <span className="flex items-center gap-1.5">
              Bank Reconciliation
              <span className="text-[8px] font-mono bg-[var(--color-surface-2)] text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] px-1.5 py-0.5 rounded tracking-wide font-black uppercase transition-colors">CSV AUTO</span>
            </span>
          }
          subtitle="Match bank deposits with system payment ledgers"
          onClick={() => { if (canAccessTab(user, 'More:BankReconciliation', excessBaggageAirlines)) setBankReconView(true); }}
          disabled={!canAccessTab(user, 'More:BankReconciliation', excessBaggageAirlines)}
        />
        <MenuItem
          icon={DatabaseIcon}
          title="Central Accounting ERP"
          subtitle="Check balance sheets and cash flows dashboard"
          onClick={() => { if (canAccessTab(user, 'More:AccountingConsole', excessBaggageAirlines)) setAccountingView(true); }}
          disabled={!canAccessTab(user, 'More:AccountingConsole', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ChartBarIcon}
          title="Advanced Reports"
          subtitle="Operational audits and trend sheets"
          onClick={() => { if (canAccessTab(user, 'More:Reports', excessBaggageAirlines)) setReportsView(true); }}
          disabled={!canAccessTab(user, 'More:Reports', excessBaggageAirlines)}
        />
        <MenuItem
          icon={PercentIcon}
          title="Airline Commissions"
          subtitle="Set percentage cuts for partner airlines"
          onClick={() => { if (canAccessTab(user, 'More:AirlineCommissions', excessBaggageAirlines)) setAirlineCommissionsView(true); }}
          disabled={!canAccessTab(user, 'More:AirlineCommissions', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ReceiptIcon}
          title="Corporate Client Billing"
          subtitle="Generate a shipment statement for a corporate account"
          onClick={() => { if (canAccessTab(user, 'More:CorporateBilling', excessBaggageAirlines)) setCorporateBillingView(true); }}
          disabled={!canAccessTab(user, 'More:CorporateBilling', excessBaggageAirlines)}
        />
      </div>

      {/* Intelligence */}
      <SectionLabel label="Intelligence" />
      <div>
        <MenuItem
          icon={BrainIcon}
          title={
            <span className="flex items-center gap-1.5">
              Demand Forecasting AI
              <span className="text-[8px] font-mono bg-[var(--color-surface-2)] text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] px-1.5 py-0.5 rounded tracking-wide font-black uppercase transition-colors">Gemini Intel</span>
            </span>
          }
          subtitle="Capacity heatmap and busy periods projections"
          onClick={() => { if (canAccessTab(user, 'More:Forecasting', excessBaggageAirlines)) setForecastingView(true); }}
          disabled={!canAccessTab(user, 'More:Forecasting', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ShieldWarningIcon}
          title={
            <span className="flex items-center gap-2">
              Fraud &amp; Anomalies Feed
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-muted)] group-hover:bg-[var(--color-accent-amber)] opacity-75 transition-colors"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-muted)] group-hover:bg-[var(--color-accent-amber)] transition-colors"></span>
              </span>
            </span>
          }
          subtitle="Track sudden debt spikes and duplicated AWBs"
          onClick={() => { if (canAccessTab(user, 'More:FraudAlerts', excessBaggageAirlines)) setFraudAlertsView(true); }}
          disabled={!canAccessTab(user, 'More:FraudAlerts', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ClockCounterClockwiseIcon}
          title="Revision Audit Log"
          subtitle="Strict NDPR/Financial compliance trace log"
          onClick={() => { if (canAccessTab(user, 'More:AuditLog', excessBaggageAirlines)) setAuditLogView(true); }}
          disabled={!canAccessTab(user, 'More:AuditLog', excessBaggageAirlines)}
        />
      </div>

      {/* Fleet & Logistics */}
      <SectionLabel label="Fleet & Logistics" />
      <div>
        <MenuItem
          icon={TruckIcon}
          title="Fleet Management"
          subtitle="Vehicles registration, service scheduler, fuel expense log"
          onClick={() => { if (canAccessTab(user, 'More:Fleet', excessBaggageAirlines)) setFleetView(true); }}
          disabled={!canAccessTab(user, 'More:Fleet', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ShieldIcon}
          title="Proof of Delivery Log"
          subtitle="GPS trace, signatures and photo evidence"
          onClick={() => { if (canAccessTab(user, 'More:PODLog', excessBaggageAirlines)) setPodLogView(true); }}
          disabled={!canAccessTab(user, 'More:PODLog', excessBaggageAirlines)}
        />
        <MenuItem
          icon={MapPinIcon}
          title="Dispatch & Fleet Tracking"
          subtitle="Live driver tracking on active routes"
          onClick={() => { if (canAccessTab(user, 'More:Dispatch', excessBaggageAirlines)) setDispatchView(true); }}
          disabled={!canAccessTab(user, 'More:Dispatch', excessBaggageAirlines)}
        />
      </div>

      {/* Data */}
      <SectionLabel label="Data & Records" />
      <div>
        <MenuItem
          icon={BookOpenIcon}
          title="Airline Balance Ledger"
          subtitle="Per-airline running Credit / Debit / Cheque Raise ledger"
          onClick={() => onChangeTab('AirlineLedger')}
          disabled={!canAccessTab(user, 'AirlineLedger', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ClipboardTextIcon}
          title="Weight Manifest"
          subtitle="Daily dispatch weight tracking per flight and route"
          onClick={() => onChangeTab('WeightManifest')}
          disabled={!canAccessTab(user, 'WeightManifest', excessBaggageAirlines)}
        />
        <MenuItem
          icon={UploadSimpleIcon}
          title="Import Historical Data"
          subtitle="Bulk import ledger records from CSV spreadsheets"
          onClick={() => onChangeTab('DataImport')}
          disabled={!canAccessTab(user, 'DataImport', excessBaggageAirlines)}
        />
      </div>

      {/* Administration */}
      <SectionLabel label="Administration" />
      <div>
        <MenuItem
          icon={AirplaneIcon}
          title="Airline Logos"
          subtitle="Manage uploaded logos for all partner airlines"
          onClick={() => onChangeTab('AirlineLogos')}
          disabled={!canAccessTab(user, 'AirlineLogos', excessBaggageAirlines)}
        />
        <MenuItem
          icon={TerminalIcon}
          title="IT Debug Console"
          subtitle="Live system logs, debugging and diagnostics"
          onClick={() => onChangeTab('IT Debug')}
          disabled={!canAccessTab(user, 'IT Debug', excessBaggageAirlines)}
        />
        <MenuItem
          icon={CurrencyDollarIcon}
          title="Pricing & Rates Configuration"
          subtitle="B2B client rates and retail standard tariffs"
          onClick={() => { if (canAccessTab(user, 'More:PricingConfiguration', excessBaggageAirlines)) setPricingView(true); }}
          disabled={!canAccessTab(user, 'More:PricingConfiguration', excessBaggageAirlines)}
        />
        <MenuItem
          icon={CurrencyDollarIcon}
          title="Hub Cargo Rates"
          subtitle="Per-hub, per-airline rate overrides on the standard tariff"
          onClick={() => { if (canAccessTab(user, 'More:HubCargoRates', excessBaggageAirlines)) setHubCargoRatesView(true); }}
          disabled={!canAccessTab(user, 'More:HubCargoRates', excessBaggageAirlines)}
        />
        <MenuItem
          icon={AirplaneIcon}
          title="Excess Baggage Airlines"
          subtitle="Add airlines and set their free allowance / rate per KG"
          onClick={() => { if (canAccessTab(user, 'More:ExcessBaggageAirlines', excessBaggageAirlines)) setExcessBaggageAirlinesView(true); }}
          disabled={!canAccessTab(user, 'More:ExcessBaggageAirlines', excessBaggageAirlines)}
        />
        <MenuItem
          icon={GearIcon}
          title="Platform Settings"
          subtitle="Automation and route pricing configuration"
          onClick={() => { if (canAccessTab(user, 'More:Settings', excessBaggageAirlines)) setSettingsView(true); }}
          disabled={!canAccessTab(user, 'More:Settings', excessBaggageAirlines)}
        />
      </div>

      {/* Support & Account */}
      <SectionLabel label="Support & Account" />
      <div>
        {canAccessTab(user, 'More:StaffManagement', excessBaggageAirlines) && (
          <MenuItem
            icon={UsersIcon}
            title="Staff Management"
            subtitle="Add staff, assign hubs, set roles, deactivate accounts"
            onClick={() => setStaffView(true)}
          />
        )}
        {canAccessTab(user, 'More:SupportTickets', excessBaggageAirlines) && (
          <MenuItem
            icon={ShieldWarningIcon}
            title="Help Desk & Issue Resolution"
            subtitle="Report operational complaints or bugs"
            onClick={() => setSupportView(true)}
          />
        )}

        <button
          onClick={onLogout}
          className="w-full mt-2 flex items-center gap-3 py-3.5 cursor-pointer group text-left"
        >
          <SignOutIcon size={18} weight="regular" className="text-[var(--color-error)] shrink-0" />
          <div className="text-left flex-1">
            <div className="text-[13px] font-bold font-sans text-[var(--color-error)]">Sign Out</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)] opacity-80">{user.name} &middot; {user.hub}</div>
          </div>
        </button>
      </div>

    </div>
  );
};
