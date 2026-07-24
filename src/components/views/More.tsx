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
import { OfficeWorkReconciliation } from './OfficeWorkReconciliation';
import { ContentTypes } from './ContentTypes';
import { ExpenseCategories } from './ExpenseCategories';
import { Banks } from './Banks';
import { SpecialGoodsRates } from './SpecialGoodsRates';
import { MinimumCharges } from './MinimumCharges';
import { FlatTierRates } from './FlatTierRates';
import { SizeTierRates } from './SizeTierRates';
import { RatesList } from './RatesList';
import { CustomerWallets } from './CustomerWallets';
import { GatPrintQueue } from './GatPrintQueue';

import { useState, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { User, TabView, Transaction, Expense, ExcessBaggageAirline, HubShift } from '../../lib/types';
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
  TagIcon,
  BankIcon,
  ListBulletsIcon,
  SparkleIcon,
  ScalesIcon,
  PrinterIcon,
} from '@phosphor-icons/react';
import { ChevronRight } from 'lucide-react';

import { StaffManagement } from './StaffManagement';

// Every sub-view inside More is a URL slug under /more/ -- refresh, browser
// back/forward, and deep-links all work through this instead of 29 separate
// useState(false) flags. Object keys are what the rest of this file uses to
// refer to each screen; values are the literal URL segment after "/more/".
const MORE_SUB_ROUTES = {
  eod: 'eod',
  accounting: 'accounting',
  reports: 'reports',
  settings: 'settings',
  excessBaggageAirlines: 'excess-baggage-airlines',
  contentTypes: 'content-types',
  expenseCategories: 'expense-categories',
  banks: 'banks',
  specialGoodsRates: 'special-goods-rates',
  minimumCharges: 'minimum-charges',
  flatTierRates: 'flat-tier-rates',
  sizeTierRates: 'size-tier-rates',
  ratesList: 'rates-list',
  bankRecon: 'bank-recon',
  fleet: 'fleet',
  forecasting: 'forecasting',
  fraudAlerts: 'fraud-alerts',
  auditLog: 'audit-log',
  ledger: 'ledger',
  gatPrintQueue: 'gat-print-queue',
  podLog: 'pod-log',
  dispatch: 'dispatch',
  airlineCommissions: 'airline-commissions',
  corporateBilling: 'corporate-billing',
  officeReconcile: 'office-reconcile',
  pricing: 'pricing',
  hubCargoRates: 'hub-cargo-rates',
  support: 'support',
  staff: 'staff',
  customerWallets: 'customer-wallets',
} as const;
type MoreSubKey = keyof typeof MORE_SUB_ROUTES;

export const More = ({ user, transactions, expenses, onLogout, onEOD, onAddTx, onFullUpdateTx, onAddExpense, onUpdateExpense, onChangeTab, dateRange, onDateRangeChange, excessBaggageAirlines, activeShift, todayShifts, onStartShift, onEndShift }: { user: User; transactions: Transaction[]; expenses: Expense[]; onLogout: () => void; onEOD?: (summary: any) => void; onAddTx: (tx: Transaction) => void; onFullUpdateTx?: (tx: Transaction) => void; onAddExpense: (e: Expense) => void; onUpdateExpense?: (expenseId: string, decision: 'approved' | 'rejected') => void; onChangeTab: (t: TabView) => void; dateRange?: { start: string; end: string }; onDateRangeChange?: (range: { start: string; end: string }) => void; excessBaggageAirlines: ExcessBaggageAirline[]; activeShift?: HubShift | null; todayShifts?: HubShift[]; onStartShift?: () => void; onEndShift?: () => void; }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const activeSub: MoreSubKey | null = useMemo(() => {
    const m = location.pathname.match(/^\/more\/([^/]+)/);
    if (!m) return null;
    const slug = m[1];
    const entry = Object.entries(MORE_SUB_ROUTES).find(([, s]) => s === slug);
    return (entry ? entry[0] : null) as MoreSubKey | null;
  }, [location.pathname]);
  const openSub = useCallback((key: MoreSubKey) => navigate('/more/' + MORE_SUB_ROUTES[key]), [navigate]);
  const closeSub = useCallback(() => navigate('/more'), [navigate]);

  // Only remaining piece of view-local state -- not a "which screen" flag,
  // just data carried across the ContentTypes -> SpecialGoodsRates handoff
  // (see onManageRates/onBack below).
  const [specialGoodsPreset, setSpecialGoodsPreset] = useState<string | undefined>(undefined);

  // View controllers
  if (activeSub === 'eod') {
    return <EODReconciliation user={user} transactions={transactions} expenses={expenses} onBack={closeSub} onEOD={onEOD || (() => {})} />;
  }

  if (activeSub === 'accounting') {
    return <AccountingConsole user={user} transactions={transactions} expenses={expenses} onBack={closeSub} onAddExpense={onAddExpense} onUpdateExpense={onUpdateExpense} onOpenBankRecon={() => openSub('bankRecon')} onFullUpdateTx={onFullUpdateTx} onAddTx={onAddTx} />;
  }

  if (activeSub === 'reports') {
    return <Reports user={user} transactions={transactions} onBack={closeSub} />;
  }

  if (activeSub === 'settings') {
    return <Settings user={user} onBack={closeSub} onOpenAirlineCommissions={() => openSub('airlineCommissions')} />;
  }

  if (activeSub === 'bankRecon') {
    return <BankReconciliation
      transactions={transactions}
      onBack={closeSub}
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

  if (activeSub === 'fleet') {
    return <Fleet onBack={closeSub} />;
  }

  if (activeSub === 'forecasting') {
    return <Forecasting onBack={closeSub} />;
  }

  if (activeSub === 'fraudAlerts') {
    return <FraudAlerts user={user} onBack={closeSub} />;
  }

  if (activeSub === 'customerWallets') {
    return <CustomerWallets user={user} onBack={closeSub} />;
  }

  if (activeSub === 'ledger') {
    return (
      <TransactionLedger
        user={user}
        transactions={transactions}
        expenses={expenses}
        onBack={closeSub}
        onUpdateTx={onFullUpdateTx || onAddTx}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        activeShift={activeShift}
        shifts={todayShifts}
        onStartShift={onStartShift}
        onEndShift={onEndShift}
      />
    );
  }

  if (activeSub === 'gatPrintQueue') {
    return <GatPrintQueue user={user} onBack={closeSub} />;
  }

  if (activeSub === 'auditLog') {
    return <AuditLog onBack={closeSub} />;
  }

  if (activeSub === 'podLog') {
    return <PODLog user={user} onBack={closeSub} />;
  }

  if (activeSub === 'dispatch') {
    return <Dispatch onBack={closeSub} />;
  }

  if (activeSub === 'airlineCommissions') {
    return <AirlineCommissions onBack={closeSub} />;
  }

  if (activeSub === 'corporateBilling') {
    return <CorporateBilling user={user} onBack={closeSub} />;
  }

  if (activeSub === 'officeReconcile') {
    return <OfficeWorkReconciliation user={user} onBack={closeSub} />;
  }

  if (activeSub === 'pricing') {
    return <PricingConfiguration user={user} onBack={closeSub} />;
  }

  if (activeSub === 'hubCargoRates') {
    return <HubCargoRates user={user} onBack={closeSub} />;
  }

  if (activeSub === 'excessBaggageAirlines') {
    return <ExcessBaggageAirlines onBack={closeSub} />;
  }

  if (activeSub === 'contentTypes') {
    return <ContentTypes onBack={closeSub} onManageRates={(contentTypeId, rateType) => {
      if (rateType === 'flat') { openSub('flatTierRates'); }
      else if (rateType === 'size') { openSub('sizeTierRates'); }
      else { setSpecialGoodsPreset(contentTypeId); openSub('specialGoodsRates'); }
    }} />;
  }

  if (activeSub === 'specialGoodsRates') {
    return <SpecialGoodsRates user={user} onBack={() => { setSpecialGoodsPreset(undefined); closeSub(); }} presetContentTypeId={specialGoodsPreset} />;
  }

  if (activeSub === 'minimumCharges') {
    return <MinimumCharges onBack={closeSub} />;
  }

  if (activeSub === 'flatTierRates') {
    return <FlatTierRates user={user} onBack={closeSub} />;
  }

  if (activeSub === 'sizeTierRates') {
    return <SizeTierRates user={user} onBack={closeSub} />;
  }

  if (activeSub === 'ratesList') {
    return <RatesList
      onBack={closeSub}
      onOpenConfig={(target) => {
        if (target === 'pricing') openSub('pricing');
        else if (target === 'hubRates') openSub('hubCargoRates');
        else if (target === 'excessBaggage') openSub('excessBaggageAirlines');
        else if (target === 'contentTypes') openSub('contentTypes');
        else if (target === 'specialGoods') openSub('specialGoodsRates');
        else if (target === 'minimumCharges') openSub('minimumCharges');
        else if (target === 'airlineCommissions') openSub('airlineCommissions');
      }}
    />;
  }

  if (activeSub === 'expenseCategories') {
    return <ExpenseCategories onBack={closeSub} />;
  }

  if (activeSub === 'banks') {
    return <Banks onBack={closeSub} />;
  }

  if (activeSub === 'support') {
    return <SupportTickets user={user} onBack={closeSub} />;
  }

  if (activeSub === 'staff') {
    return <StaffManagement user={user} onBack={closeSub} />;
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
            onClick={() => openSub('eod')}
          />
        )}
        {canAccessTab(user, 'More:TransactionLedger', excessBaggageAirlines) && (
          <MenuItem
            icon={PulseIcon}
            title="Transaction Ledger"
            subtitle={`${transactions.length} entries — view, search and export`}
            onClick={() => openSub('ledger')}
          />
        )}
        {canAccessTab(user, 'More:GatPrintQueue', excessBaggageAirlines) && (
          <MenuItem
            icon={PrinterIcon}
            title="GAT Print Queue"
            subtitle="Batch-print tags & receipts for GAT sales"
            onClick={() => openSub('gatPrintQueue')}
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
          icon={ListBulletsIcon}
          title="Rates Directory"
          subtitle="View every configured rate — read-only, edit from each config screen"
          onClick={() => { if (canAccessTab(user, 'More:RatesList', excessBaggageAirlines)) openSub('ratesList'); }}
          disabled={!canAccessTab(user, 'More:RatesList', excessBaggageAirlines)}
        />
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
          onClick={() => { if (canAccessTab(user, 'More:BankReconciliation', excessBaggageAirlines)) openSub('bankRecon'); }}
          disabled={!canAccessTab(user, 'More:BankReconciliation', excessBaggageAirlines)}
        />
        <MenuItem
          icon={DatabaseIcon}
          title="Central Accounting ERP"
          subtitle="Check balance sheets and cash flows dashboard"
          onClick={() => { if (canAccessTab(user, 'More:AccountingConsole', excessBaggageAirlines)) openSub('accounting'); }}
          disabled={!canAccessTab(user, 'More:AccountingConsole', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ChartBarIcon}
          title="Advanced Reports"
          subtitle="Operational audits and trend sheets"
          onClick={() => { if (canAccessTab(user, 'More:Reports', excessBaggageAirlines)) openSub('reports'); }}
          disabled={!canAccessTab(user, 'More:Reports', excessBaggageAirlines)}
        />
        <MenuItem
          icon={AirplaneIcon}
          title="Airline Sales & Weight Breakdown"
          subtitle="View total sales (₦) and total weight (KG) per airline by date & time range"
          onClick={() => onChangeTab('AirlinePerformance')}
          disabled={!canAccessTab(user, 'More:AirlinePerformance', excessBaggageAirlines)}
        />
        <MenuItem
          icon={PercentIcon}
          title="Airline Commissions"
          subtitle="Set percentage cuts for partner airlines"
          onClick={() => { if (canAccessTab(user, 'More:AirlineCommissions', excessBaggageAirlines)) openSub('airlineCommissions'); }}
          disabled={!canAccessTab(user, 'More:AirlineCommissions', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ReceiptIcon}
          title="Corporate Client Billing"
          subtitle="Generate a shipment statement for a corporate account"
          onClick={() => { if (canAccessTab(user, 'More:CorporateBilling', excessBaggageAirlines)) openSub('corporateBilling'); }}
          disabled={!canAccessTab(user, 'More:CorporateBilling', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ReceiptIcon}
          title="Office Work Reconciliation"
          subtitle="Link & reprice mis-entered corporate debts"
          onClick={() => { if (canAccessTab(user, 'More:OfficeWorkReconcile', excessBaggageAirlines)) openSub('officeReconcile'); }}
          disabled={!canAccessTab(user, 'More:OfficeWorkReconcile', excessBaggageAirlines)}
        />
        <MenuItem
          icon={CurrencyDollarIcon}
          title="Customer Credit Wallets"
          subtitle="Manage customer advance balances, top-ups, and credit history"
          onClick={() => { if (canAccessTab(user, 'More:CustomerWallets', excessBaggageAirlines)) openSub('customerWallets'); }}
          disabled={!canAccessTab(user, 'More:CustomerWallets', excessBaggageAirlines)}
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
          onClick={() => { if (canAccessTab(user, 'More:Forecasting', excessBaggageAirlines)) openSub('forecasting'); }}
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
          onClick={() => { if (canAccessTab(user, 'More:FraudAlerts', excessBaggageAirlines)) openSub('fraudAlerts'); }}
          disabled={!canAccessTab(user, 'More:FraudAlerts', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ClockCounterClockwiseIcon}
          title="Revision Audit Log"
          subtitle="Strict NDPR/Financial compliance trace log"
          onClick={() => { if (canAccessTab(user, 'More:AuditLog', excessBaggageAirlines)) openSub('auditLog'); }}
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
          onClick={() => { if (canAccessTab(user, 'More:Fleet', excessBaggageAirlines)) openSub('fleet'); }}
          disabled={!canAccessTab(user, 'More:Fleet', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ShieldIcon}
          title="Proof of Delivery Log"
          subtitle="GPS trace, signatures and photo evidence"
          onClick={() => { if (canAccessTab(user, 'More:PODLog', excessBaggageAirlines)) openSub('podLog'); }}
          disabled={!canAccessTab(user, 'More:PODLog', excessBaggageAirlines)}
        />
        <MenuItem
          icon={MapPinIcon}
          title="Dispatch & Fleet Tracking"
          subtitle="Live driver tracking on active routes"
          onClick={() => { if (canAccessTab(user, 'More:Dispatch', excessBaggageAirlines)) openSub('dispatch'); }}
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
          onClick={() => { if (canAccessTab(user, 'More:PricingConfiguration', excessBaggageAirlines)) openSub('pricing'); }}
          disabled={!canAccessTab(user, 'More:PricingConfiguration', excessBaggageAirlines)}
        />
        <MenuItem
          icon={CurrencyDollarIcon}
          title="Hub Cargo Rates"
          subtitle="Per-hub, per-airline rate overrides on the standard tariff"
          onClick={() => { if (canAccessTab(user, 'More:HubCargoRates', excessBaggageAirlines)) openSub('hubCargoRates'); }}
          disabled={!canAccessTab(user, 'More:HubCargoRates', excessBaggageAirlines)}
        />
        <MenuItem
          icon={AirplaneIcon}
          title="Excess Baggage Airlines"
          subtitle="Add airlines and set their free allowance / rate per KG"
          onClick={() => { if (canAccessTab(user, 'More:ExcessBaggageAirlines', excessBaggageAirlines)) openSub('excessBaggageAirlines'); }}
          disabled={!canAccessTab(user, 'More:ExcessBaggageAirlines', excessBaggageAirlines)}
        />
        <MenuItem
          icon={TagIcon}
          title="Content Types"
          subtitle="Cargo/package content categories staff pick from at intake"
          onClick={() => { if (canAccessTab(user, 'More:ContentTypes', excessBaggageAirlines)) openSub('contentTypes'); }}
          disabled={!canAccessTab(user, 'More:ContentTypes', excessBaggageAirlines)}
        />
        <MenuItem
          icon={SparkleIcon}
          title="Special Goods Rates"
          subtitle="Per-airline, weight-tiered rates for flagged content types"
          onClick={() => { if (canAccessTab(user, 'More:SpecialGoodsRates', excessBaggageAirlines)) openSub('specialGoodsRates'); }}
          disabled={!canAccessTab(user, 'More:SpecialGoodsRates', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ScalesIcon}
          title="Minimum Charges"
          subtitle="Flat weight-bracket floor per airline + route"
          onClick={() => { if (canAccessTab(user, 'More:MinimumCharges', excessBaggageAirlines)) openSub('minimumCharges'); }}
          disabled={!canAccessTab(user, 'More:MinimumCharges', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ReceiptIcon}
          title="Flat Tier Rates"
          subtitle="Flat weight-bracket pricing (Bumper & Burnet)"
          onClick={() => { if (canAccessTab(user, 'More:FlatTierRates', excessBaggageAirlines)) openSub('flatTierRates'); }}
          disabled={!canAccessTab(user, 'More:FlatTierRates', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ReceiptIcon}
          title="Size Tier Rates"
          subtitle="Flat screen-size-bracket pricing (Plasma TV)"
          onClick={() => { if (canAccessTab(user, 'More:SizeTierRates', excessBaggageAirlines)) openSub('sizeTierRates'); }}
          disabled={!canAccessTab(user, 'More:SizeTierRates', excessBaggageAirlines)}
        />
        <MenuItem
          icon={ReceiptIcon}
          title="Expense Categories"
          subtitle="Categories staff log expenses against, plus monthly budgets"
          onClick={() => { if (canAccessTab(user, 'More:ExpenseCategories', excessBaggageAirlines)) openSub('expenseCategories'); }}
          disabled={!canAccessTab(user, 'More:ExpenseCategories', excessBaggageAirlines)}
        />
        <MenuItem
          icon={BankIcon}
          title="Banks"
          subtitle="Bank list used in Transfer/POS payment dropdowns"
          onClick={() => { if (canAccessTab(user, 'More:Banks', excessBaggageAirlines)) openSub('banks'); }}
          disabled={!canAccessTab(user, 'More:Banks', excessBaggageAirlines)}
        />
        <MenuItem
          icon={GearIcon}
          title="Platform Settings"
          subtitle="Automation and route pricing configuration"
          onClick={() => { if (canAccessTab(user, 'More:Settings', excessBaggageAirlines)) openSub('settings'); }}
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
            onClick={() => openSub('staff')}
          />
        )}
        {canAccessTab(user, 'More:SupportTickets', excessBaggageAirlines) && (
          <MenuItem
            icon={ShieldWarningIcon}
            title="Help Desk & Issue Resolution"
            subtitle="Report operational complaints or bugs"
            onClick={() => openSub('support')}
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
