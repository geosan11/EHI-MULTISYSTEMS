import { useState, useEffect, lazy, Suspense, useRef, useCallback, memo, useMemo } from 'react';
import { User, TabView, Transaction, Expense, ExcessBaggageAirline } from '../lib/types';
import { processSyncQueue, writeWithOfflineSupport, cleanupOldQueue } from '../lib/sync';
import { db } from '../lib/db';
import Dexie from 'dexie';
import { refillPoolIfLow } from '../lib/tagPool';
import { getHubCode } from '../lib/helpers';
import { useTheme } from '../lib/useTheme';
import { getAllowedTabs } from '../lib/permissions';
import { Header as HeaderRaw } from './Header';
import { BottomNav as BottomNavRaw } from './BottomNav';
import { SideNav as SideNavRaw } from './SideNav';
import { useToast } from '../lib/ToastContext';
import { supabase, writeAuditLog } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import { Dashboard as DashboardRaw } from './views/Dashboard';
import { CargoForm as CargoFormRaw } from './views/CargoForm';
import { ExcessBaggageForm as ExcessBaggageFormRaw } from './views/ExcessBaggageForm';
import { Analytics as AnalyticsRaw } from './views/Analytics';
import { More as MoreRaw } from './views/More';
import { TransactionLedger as TransactionLedgerRaw } from './views/TransactionLedger';
import { MarketingWorkspace as MarketingWorkspaceRaw } from './views/MarketingWorkspace';
import { PackageForm as PackageFormRaw } from './views/PackageForm';
import { Scanner as ScannerRaw } from './views/Scanner';
import { IncomingToHub as IncomingToHubRaw } from './views/IncomingToHub';
import { OutboundArrivals as OutboundArrivalsRaw } from './views/OutboundArrivals';
import { MyTrips as MyTripsRaw } from './views/MyTrips';
import { ITDashboard as ITDashboardRaw } from './views/ITDashboard';
import { CreditDebit as CreditDebitRaw } from './views/CreditDebit';
import { AirlineLogoManager } from './views/AirlineLogoManager';
import { DataImport } from './views/DataImport';
import { AirlineLedger } from './views/AirlineLedger';
import { WeightManifest } from './views/WeightManifest';

import { ErrorBoundary } from './ErrorBoundary';

const Header = memo(HeaderRaw);
const BottomNav = memo(BottomNavRaw);
const SideNav = memo(SideNavRaw);
const Dashboard = memo(DashboardRaw);
const CargoForm = memo(CargoFormRaw);
const ExcessBaggageForm = memo(ExcessBaggageFormRaw);
const Analytics = memo(AnalyticsRaw);
const More = memo(MoreRaw);
const TransactionLedger = memo(TransactionLedgerRaw);
const MarketingWorkspace = memo(MarketingWorkspaceRaw);
const PackageForm = memo(PackageFormRaw);
const Scanner = memo(ScannerRaw);
const IncomingToHub = memo(IncomingToHubRaw);
const OutboundArrivals = memo(OutboundArrivalsRaw);
const MyTrips = memo(MyTripsRaw);
const ITDashboard = memo(ITDashboardRaw);
const CreditDebit = memo(CreditDebitRaw);

// Keyed per user (not a flat key) so switching users on a shared device
// never restores one person's last tab into another person's session --
// each user's own nav clicks are already role-gated when they happen, so
// replaying their own last tab back to them is always safe.
const CURRENT_TAB_KEY = (userId: string) => `ehi_current_tab_${userId}`;

export const EHIApp = ({ user, onLogout }: { user: User; onLogout: () => void }) => {
  const getDefaultTab = (role: string): TabView => {
    if (role === 'office_work') return 'Cargo';
    if (role === 'marketing_agent') return 'Marketing';
    if (role === 'driver') return 'MyTrips';
    if (role === 'baggage_agent' && user.assigned_airline) return `Baggage:${user.assigned_airline}`;
    return 'Tower';
  };
  // Restores the tab the user was last on instead of always landing back on
  // the dashboard -- this matters a lot more now that the app auto-reloads
  // on every new deploy (see main.tsx's controllerchange listener): without
  // this, that silent reload would yank anyone mid-task back to Tower.
  const [currentTab, setCurrentTab] = useState<TabView>(() => {
    try {
      const saved = localStorage.getItem(CURRENT_TAB_KEY(user.id));
      if (saved) return saved as TabView;
    } catch { /* ignore -- fall through to role default */ }
    return getDefaultTab(user.role);
  });

  useEffect(() => {
    try {
      localStorage.setItem(CURRENT_TAB_KEY(user.id), currentTab);
    } catch { /* ignore -- non-fatal, just won't restore next time */ }
  }, [currentTab, user.id]);
  const [streamLedger, setStreamLedger] = useState<'cargo' | 'baggage' | 'marketing' | null>(null);
  const [globalDateRange, setGlobalDateRange] = useState({
    start: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [initError, setInitError] = useState(false);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  // Drives one nav tab per active row -- fetched once here and passed down
  // to SideNav/BottomNav/More/the tab dispatch below, so every one of them
  // stays in sync with whatever's configured in ExcessBaggageAirlines.tsx
  // without each fetching (and possibly disagreeing) independently.
  const [excessBaggageAirlines, setExcessBaggageAirlines] = useState<ExcessBaggageAirline[]>(() => {
    try {
      const cached = localStorage.getItem('ehi_excess_baggage_airlines');
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });

  useEffect(() => {
    supabase.from('excess_baggage_airlines').select('*').eq('active', true).order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (data && !error) {
          setExcessBaggageAirlines(data);
          localStorage.setItem('ehi_excess_baggage_airlines', JSON.stringify(data));
        }
      });
  }, []);

  const { theme, toggle } = useTheme();
  const { showToast } = useToast();

  const pendingTxRef = useRef<Transaction[]>([]);
  const pendingExpenseRef = useRef<Expense[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transactionsRef = useRef<Transaction[]>([]);

  // Keep a ref mirror of transactions for synchronous dedup checks in realtime handlers
  useEffect(() => { transactionsRef.current = transactions; }, [transactions]);

  useEffect(() => {
    cleanupOldQueue();
    const handleOnline = async () => {
      setIsOffline(false);
      const count = await processSyncQueue();
      if (count > 0) {
        showToast({ message: `${count} transaction(s) synced to server`, type: 'success' });
        setPendingSyncCount(0);
      }

      // Top up this user's tag-number pools (src/lib/tagPool.ts) the
      // moment connectivity returns, rather than waiting for whichever
      // form they next happen to open -- keeps a busy hub's pools full
      // through the next connectivity gap instead of only reacting to one
      // once it's already been hit. Scoped to whichever streams this
      // user's role can actually reach (getAllowedTabs is the single
      // source of truth for that, same as the nav itself uses).
      const hubCode = getHubCode(user.hub_code || user.hub);
      const allowedTabs = getAllowedTabs(user, excessBaggageAirlines);
      if (allowedTabs.includes('Cargo')) refillPoolIfLow(`${hubCode}-CG`);
      if (allowedTabs.includes('Marketing')) refillPoolIfLow(`${hubCode}-MK`);
      if (allowedTabs.includes('Packages')) refillPoolIfLow(`${hubCode}-PKG`);
      allowedTabs.forEach(tab => {
        if (!tab.startsWith('Baggage:')) return;
        const airlineName = tab.slice('Baggage:'.length);
        const airline = excessBaggageAirlines.find(a => a.name === airlineName);
        if (airline) refillPoolIfLow(`${hubCode}-${airline.tag_code}`);
      });
    };
    const handleOffline = () => setIsOffline(true);

    // The 'online' event only fires on an offline->online transition. If the
    // app was closed with items still queued and reopens while already
    // online, that transition never happens and queued records would sit
    // unsynced indefinitely. Run once on mount, then retry periodically as
    // a backstop in case a sync attempt failed for a transient reason.
    if (navigator.onLine) handleOnline();
    const syncInterval = window.setInterval(() => {
      if (navigator.onLine) handleOnline();
    }, 60000);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Dashboard empty state CTA buttons dispatch this event. getAllowedTabs
    // (src/lib/permissions.ts) is the single source of truth for which tabs
    // this user can reach -- their super-admin-set view_overrides if set,
    // else the normal role-derived default.
    const handleEhiNav = (e: Event) => {
      const requested = (e as CustomEvent).detail as TabView;
      const allowed = getAllowedTabs(user, excessBaggageAirlines);

      if (allowed.includes(requested) || requested === 'More') {
        setCurrentTab(requested);
      }
    };
    window.addEventListener('ehi-nav', handleEhiNav);

    return () => {
      window.clearInterval(syncInterval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('ehi-nav', handleEhiNav);
    };
  }, [showToast, user.role, user.assigned_airline, user.view_overrides, excessBaggageAirlines]);

  const flushPendingTx = useCallback(() => {
    if (pendingTxRef.current.length === 0) return;
    setTransactions(prev => {
      const existingIds = new Set(prev.map(t => t.id));
      const fresh = pendingTxRef.current.filter(t => !existingIds.has(t.id));
      if (fresh.length === 0) return prev;
      return [...fresh, ...prev];
    });
    pendingTxRef.current = [];
  }, []);

  // Fetch Initial Data
  // Hoisted into a stable callback (rather than declared inline inside the
  // effect below) so the tab-switch effect further down can trigger the
  // exact same cargo/baggage/marketing/package/expense fetch without
  // duplicating the query logic.
  const fetchEpochRef = useRef(0);
  const fetchInitial = useCallback(async () => {
    // globalDateRange changes on every filter click -- without this guard,
    // quickly clicking through Today -> Yesterday -> 7 days can let an
    // older, slower request resolve AFTER a newer one and overwrite the
    // whole ledger with the wrong date range's data, with no visible error.
    // fetchEpochRef replaces what used to be an effect-local `active` flag
    // so the same guard works when this is called from multiple effects.
    const myEpoch = ++fetchEpochRef.current;
    setInitError(false);
    try {
        const isAdmin = ['super_admin','admin','accountant','auditor'].includes(user.role);
        // Deliberately narrower than isAdmin -- pickup PIN visibility is
        // specifically admin/super_admin/accountant, not auditor.
        const canSeePin = ['admin', 'super_admin', 'accountant'].includes(user.role);

        const addHubFilter = (q: any) =>
          (!isAdmin && user.hub_id) ? q.eq('hub_id', user.hub_id) : q;

        const startDate = new Date(globalDateRange.start);
        startDate.setHours(0,0,0,0);
        const endDate = new Date(globalDateRange.end);
        endDate.setHours(23,59,59,999);
        
        const startISO = startDate.toISOString();
        const endISO = endDate.toISOString();

        const [cargoRes, baggageRes, mktRes, packageRes, expRes, profilesRes] = await Promise.all([
          addHubFilter(supabase.from('cargo_entries').select('entry_ref,consignee_name,airline,awb_tag_number,total_pcs,total_kg,route,content_type,amount,receipt_mode,pickup_pin,status,created_at,commission_rate,bank,hub_id,remark,amount_paid,payment_history,payment_confirmed,pos_approval_code,confirmed_by,confirmed_at,consignee_phone,client_type,corporate_client_id,bank_reference,bank_sender,bank_alert_text,entered_by,wallet_id,wallet_deduction_amount').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(5000)),
          addHubFilter(supabase.from('manifests').select('transaction_id,passenger_name,flight_no,destination,excess_kg,amount,payment_mode,created_at,bank,hub_id,total_kg,pnr,passenger_phone,total_pcs,amount_paid,payment_history,airline,payment_confirmed,pos_approval_code,confirmed_by,confirmed_at,bank_reference,bank_sender,bank_alert_text,entered_by,wallet_id,wallet_deduction_amount').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(5000)),
          addHubFilter(supabase.from('marketing_entries').select('entry_ref,awb_tag_number,customer_name,route,qty_big_bag,qty_med_bag,qty_small_bag,bb_kg,mb_kg,sb_kg,amount_paid,payment_mode,created_at,hub_id,bank,entered_by,debt_amount_paid,payment_history,payment_confirmed,pos_approval_code,confirmed_by,confirmed_at,bank_reference,bank_sender,bank_alert_text,wallet_id,wallet_deduction_amount').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(5000)),
          addHubFilter(supabase.from('package_entries').select('entry_ref,customer_name,destination,content_type,total_pcs,total_kg,contents,status,amount,payment_mode,bank,payment_narration,debt_paid,debt_paid_at,amount_paid,payment_history,created_at,hub_id,payment_confirmed,pos_approval_code,confirmed_by,confirmed_at,entered_by,wallet_id,wallet_deduction_amount').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(5000)),
          addHubFilter(supabase.from('expenses').select('*').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(5000)),
          supabase.from('user_profiles').select('id,name')
        ]);

        if (fetchEpochRef.current !== myEpoch) return;
        if (cargoRes.error) console.error('Cargo fetch error:', cargoRes.error);
        if (baggageRes.error) console.error('Baggage fetch error:', baggageRes.error);
        if (mktRes.error) console.error('Marketing fetch error:', mktRes.error);
        if (packageRes.error) console.error('Package fetch error:', packageRes.error);

        const profileLookup: Record<string, string> = {};
        if (profilesRes.data) {
          profilesRes.data.forEach(p => {
            if (p.id) profileLookup[p.id] = p.name || '';
          });
        }

        const allTx: Transaction[] = [];

        if (cargoRes.data) {
          cargoRes.data.forEach(r => {
            const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
            allTx.push({
              id: r.entry_ref || r.id,
              name: r.consignee_name || 'Cargo',
              detail: `${r.airline || ''} · ${r.awb_tag_number || ''} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg · ${r.route || ''} · ${r.content_type || 'Package'}`,
              amount: r.amount || 0,
              mode: r.receipt_mode === 'Debt' && (r.amount_paid || 0) >= (r.amount || 0) ? 'Debt Paid' : (r.receipt_mode || 'Cash'),
              time: new Date(r.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
              type: 'cargo',
              status: r.status || 'Intake',
              awb_tag_number: r.awb_tag_number,
              kg: r.total_kg,
              pieces: r.total_pcs,
              pickupPin: r.pickup_pin || undefined,
              created_at: r.created_at,
              airline: r.airline,
              commissionRate: r.commission_rate ?? undefined,
              bank: r.bank,
              route: r.route,
              hub_id: r.hub_id,
              contentType: r.content_type,
              remarks: r.remark || undefined,
              enteredByName: enteredByName || undefined,
              amountPaid: r.amount_paid || 0,
              paymentHistory: r.payment_history || [],
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code || undefined,
              confirmedBy: r.confirmed_by || undefined,
              confirmedAt: r.confirmed_at || undefined,
              consigneePhone: r.consignee_phone || undefined,
              clientType: r.client_type || undefined,
              corporate_client_id: r.corporate_client_id || undefined,
              bankReference: r.bank_reference || undefined,
              bankSender: r.bank_sender || undefined,
              bankAlertText: r.bank_alert_text || undefined,
              wallet_id: r.wallet_id || undefined,
              wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
            });
          });
        }

        if (baggageRes.data) {
          baggageRes.data.forEach(r => {
            const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
            allTx.push({
              id: r.transaction_id || r.id,
              name: r.passenger_name || 'Baggage Passenger',
              detail: `${r.flight_no || ''} · ${r.destination || ''} · ${r.total_pcs || 1}pcs · +${r.excess_kg || 0}kg excess`,
              amount: r.amount || 0,
              mode: r.payment_mode === 'Debt' && (r.amount_paid || 0) >= (r.amount || 0) ? 'Debt Paid' : (r.payment_mode || 'POS'),
              time: new Date(r.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
              type: 'baggage',
              status: 'Delivered',
              created_at: r.created_at,
              bank: r.bank,
              hub_id: r.hub_id,
              airline: r.airline,
              destination: r.destination,
              excessKg: r.excess_kg,
              totalKg: r.total_kg,
              flight: r.flight_no,
              pnr: r.pnr || undefined,
              kg: r.excess_kg,
              pieces: r.total_pcs,
              enteredByName: enteredByName || undefined,
              amountPaid: r.amount_paid || 0,
              paymentHistory: r.payment_history || [],
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code || undefined,
              confirmedBy: r.confirmed_by || undefined,
              confirmedAt: r.confirmed_at || undefined,
              bankReference: r.bank_reference || undefined,
              bankSender: r.bank_sender || undefined,
              bankAlertText: r.bank_alert_text || undefined,
              wallet_id: r.wallet_id || undefined,
              wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
            });
          });
        }

        if (mktRes.data) {
          mktRes.data.forEach((r: any) => {
            const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
            allTx.push({
              id: r.entry_ref || r.id,
              awb_tag_number: r.awb_tag_number || undefined,
              name: r.customer_name || 'Customer',
              detail: `${r.route || ''} · ${r.qty_big_bag || 0}BB ${r.qty_med_bag || 0}MB ${r.qty_small_bag || 0}SB`,
              amount: r.amount_paid || 0,
              mode: r.payment_mode === 'Debt' && (r.debt_amount_paid || 0) >= (r.amount_paid || 0) ? 'Debt Paid' : (r.payment_mode || 'Cash'),
              time: new Date(r.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
              type: 'marketing',
              status: 'Intake',
              created_at: r.created_at,
              bank: r.bank,
              hub_id: r.hub_id,
              route: r.route,
              enteredByName: enteredByName || undefined,
              amountPaid: r.debt_amount_paid || 0,
              paymentHistory: r.payment_history || [],
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code || undefined,
              confirmedBy: r.confirmed_by || undefined,
              confirmedAt: r.confirmed_at || undefined,
              bankReference: r.bank_reference || undefined,
              bankSender: r.bank_sender || undefined,
              bankAlertText: r.bank_alert_text || undefined,
            });
          });
        }

        if (packageRes.data) {
          packageRes.data.forEach((r: any) => {
            const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
            allTx.push({
              id: r.entry_ref || r.id,
              name: r.customer_name || 'Customer',
              detail: `${r.destination || ''} · ${r.content_type || 'Package'} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg${r.contents ? ` · ${r.contents}` : ''}`,
              amount: r.amount || 0,
              mode: r.payment_mode === 'Debt' && (r.debt_paid === true || (r.amount_paid || 0) >= (r.amount || 0)) ? 'Debt Paid' : (r.payment_mode || 'Cash'),
              time: new Date(r.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
              type: 'package',
              status: r.status || 'Intake',
              created_at: r.created_at,
              bank: r.bank,
              hub_id: r.hub_id,
              destination: r.destination,
              contentType: r.content_type,
              pieces: r.total_pcs || undefined,
              kg: r.total_kg || undefined,
              contents: r.contents || undefined,
              paymentNarration: r.payment_narration || undefined,
              debtPaid: r.debt_paid ?? undefined,
              debtPaidAt: r.debt_paid_at || undefined,
              enteredByName: enteredByName || undefined,
              amountPaid: r.amount_paid || 0,
              paymentHistory: r.payment_history || [],
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code || undefined,
              confirmedBy: r.confirmed_by || undefined,
              confirmedAt: r.confirmed_at || undefined,
              wallet_id: r.wallet_id || undefined,
              wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
            });
          });
        }

        if (expRes.data) {
          const fetchedExpenses = expRes.data.map((e: any) => ({
            id: e.id,
            type: e.category || 'General',
            amount: e.amount,
            description: e.description,
            time: e.created_at,
            created_at: e.created_at,
            status: e.status || 'pending',
            mode: e.mode || undefined,
            bank: e.bank || undefined,
            logged_by: e.logged_by || undefined,
            approvedBy: e.approved_by || undefined,
            approvedAt: e.approved_at || undefined,
            rejectedBy: e.rejected_by || undefined,
            rejectedAt: e.rejected_at || undefined,
          }));
          setExpenses(prev => {
            // Same reasoning as the transactions merge below: a date-range
            // change can refire this fetch before an optimistically-added
            // expense (handleAddExpense) has actually landed in Supabase.
            // Without this, that expense would silently vanish from the UI.
            const stillPending = pendingExpenseRef.current.filter(
              p => !fetchedExpenses.some((f: any) => f.id === p.id)
            );
            pendingExpenseRef.current = stillPending;
            const combined = [...stillPending, ...fetchedExpenses];
            const unique = combined.filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);
            return unique.sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime());
          });
        }

        allTx.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        
        setTransactions(prev => {
          // Respect the date filter while keeping locally pending transactions.
          const localOnly = pendingTxRef.current.filter(p => !allTx.some(t => t.id === p.id));
          const combined = [...localOnly, ...allTx];
          const unique = combined.filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);
          return unique.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        });
      } catch (err) {
        if (fetchEpochRef.current !== myEpoch) return;
        console.error("Failed to fetch initial tx:", err);
        setInitError(true);
      }
  }, [globalDateRange, user.role, user.hub_id]);

  useEffect(() => {
    if (isOffline) return;
    fetchInitial();
  }, [isOffline, retryTrigger, fetchInitial]);

  // The realtime channels below (cargoChannel/baggageChannel/marketingChannel)
  // are only subscribed while currentTab actually needs them, and
  // package_entries has no realtime channel at all -- so an entry inserted
  // elsewhere while its channel wasn't open is otherwise never pushed into
  // local state until a manual reload or a date-range change re-runs
  // fetchInitial. Refetch when navigating into a tab that needs fresh data,
  // so anything missed while on an unrelated tab shows up immediately,
  // without refetching on every single tab click (e.g. Settings, Profile).
  const prevTabRef = useRef(currentTab);
  useEffect(() => {
    const prevTab = prevTabRef.current;
    prevTabRef.current = currentTab;
    if (isOffline || prevTab === currentTab) return;

    const isDataTab =
      currentTab === 'Cargo' ||
      currentTab === 'Marketing' ||
      currentTab === 'Packages' ||
      currentTab.startsWith('Baggage:') ||
      ['Tower', 'Scan', 'More'].includes(currentTab);

    if (isDataTab) fetchInitial();
  }, [currentTab, isOffline, fetchInitial]);

  // Supabase real-time
  useEffect(() => {
    if (isOffline) return;

    const isAdmin = ['super_admin','admin','accountant','auditor'].includes(user.role);
    const canSeePin = ['admin', 'super_admin', 'accountant'].includes(user.role);
    // Postgres changes filter — non-admins only receive their own hub's rows
    const hubFilter = (!isAdmin && user.hub_id) ? `hub_id=eq.${user.hub_id}` : undefined;

    // Only open the channels this role actually has a use for. Every user
    // was previously opening all 3 channels regardless of role, which at
    // scale (Supabase Pro includes 500 concurrent Realtime connections)
    // means a driver or single-stream agent spends 3 connections for data
    // Dashboard.tsx's own showCargo/showVJ/showMktg logic already hides
    // from them. Mirrors that exact same gating so nobody's visible data
    // changes — this only removes waste, not functionality.

    // perf(realtime): To reduce Postgres connection count on a Nano-tier project 
    // close to its connection ceiling, admin-tier users now only subscribe to 
    // channels relevant to their active tab (currentTab). Aggregate views like 
    // Tower, Scan, and More hold all channels, while type-specific views hold one.
    // Non-admin roles retain their original scale-readiness behavior.
    let needsCargo = ['cargo_agent', 'office_work', 'auditor'].includes(user.role);
    let needsBaggage = user.role === 'baggage_agent';
    let needsMarketing = user.role === 'marketing_agent';

    if (isAdmin) {
      const isAggregateView = ['Tower', 'Scan', 'More'].includes(currentTab);
      needsCargo = isAggregateView || currentTab === 'Cargo';
      needsBaggage = isAggregateView || currentTab.startsWith('Baggage:');
      needsMarketing = isAggregateView || currentTab === 'Marketing';
    } else {
      // Preserve the exact existing logic for non-admins if they weren't explicitly matched above
      // (Actually, the previous code was `isAdmin || user.role === '...'`)
      // So this matches the exact previous logic for non-admins.
    }

    // Guard against pushing a row that already exists locally (e.g. our own insert)
    const pushUnique = (tx: Transaction) => {
      const exists =
        pendingTxRef.current.some(p => p.id === tx.id) ||
        transactionsRef.current.some(p => p.id === tx.id);
      if (exists) return;
      pendingTxRef.current.push(tx);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flushPendingTx, 300);
    };

    const cargoChannel = needsCargo ? supabase
      .channel('ehi-cargo-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cargo_entries', filter: hubFilter },
        payload => {
          const r = payload.new as any;
          pushUnique({
            id: r.entry_ref || r.id,
            name: r.consignee_name || 'Cargo',
            detail: `${r.airline || ''} · ${r.awb_tag_number || ''} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg · ${r.route || ''} · ${r.content_type || 'Package'}`,
            amount: r.amount || 0,
            mode: r.receipt_mode || 'Cash',
            time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
            type: 'cargo',
            status: r.status || 'Intake',
            awb_tag_number: r.awb_tag_number,
            kg: r.total_kg,
            pieces: r.total_pcs,
            created_at: r.created_at,
            hub_id: r.hub_id,
            route: r.route,
            airline: r.airline,
            // Realtime sends the full row regardless of the original
            // query's column list, so gate this client-side too --
            // canSeePin is already in scope from the fetchInitial closure.
            pickupPin: canSeePin ? (r.pickup_pin || undefined) : undefined,
            consigneePhone: r.consignee_phone || undefined,
            clientType: r.client_type || undefined,
          });
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cargo_entries', filter: hubFilter },
        payload => {
          const r = payload.new as any;
          setTransactions(prev => prev.map(t =>
            t.id === (r.entry_ref || r.id) ? {
              ...t,
              status: r.status || t.status,
              mode: r.receipt_mode || t.mode,
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code,
              bank: r.bank ?? t.bank,
              confirmedBy: r.confirmed_by ?? t.confirmedBy,
              confirmedAt: r.confirmed_at ?? t.confirmedAt
            } : t
          ));
        }
      )
      .subscribe() : null;

    const baggageChannel = needsBaggage ? supabase
      .channel('ehi-baggage-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'manifests', filter: hubFilter },
        payload => {
          const r = payload.new as any;
          pushUnique({
            id: r.transaction_id || r.id,
            name: r.passenger_name || 'Baggage Passenger',
            detail: `${r.flight_no || ''} · ${r.destination || ''} · +${r.excess_kg || 0}kg excess`,
            amount: r.amount || 0,
            mode: r.payment_mode || 'POS',
            time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
            type: 'baggage',
            status: 'Delivered',
            created_at: r.created_at,
            hub_id: r.hub_id,
            airline: r.airline,
            destination: r.destination,
            excessKg: r.excess_kg,
            totalKg: r.total_kg,
            flight: r.flight_no,
            kg: r.excess_kg,
            pieces: r.total_pcs,
          });
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'manifests', filter: hubFilter },
        payload => {
          const r = payload.new as any;
          setTransactions(prev => prev.map(t =>
            t.id === (r.transaction_id || r.id) ? {
              ...t,
              mode: r.payment_mode || t.mode,
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code
            } : t
          ));
        }
      )
      .subscribe() : null;

    const marketingChannel = needsMarketing ? supabase
      .channel('ehi-marketing-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'marketing_entries', filter: hubFilter },
        payload => {
          const r = payload.new as any;
          pushUnique({
            id: r.entry_ref || r.id,
            awb_tag_number: r.awb_tag_number || undefined,
            name: r.customer_name || 'Customer',
            detail: `${r.route || ''} · ${r.qty_big_bag || 0}BB ${r.qty_med_bag || 0}MB ${r.qty_small_bag || 0}SB`,
            amount: r.amount_paid || 0,
            mode: r.payment_mode || 'Cash',
            time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
            type: 'marketing',
            status: 'Intake',
            created_at: r.created_at,
            hub_id: r.hub_id,
            route: r.route,
          });
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'marketing_entries', filter: hubFilter },
        payload => {
          const r = payload.new as any;
          setTransactions(prev => prev.map(t =>
            t.id === (r.entry_ref || r.id) ? {
              ...t,
              mode: r.payment_mode || t.mode,
              paymentConfirmed: r.payment_confirmed,
              status: r.status || t.status,
            } : t
          ));
        }
      )
      .subscribe() : null;

    return () => {
      if (cargoChannel) supabase.removeChannel(cargoChannel);
      if (baggageChannel) supabase.removeChannel(baggageChannel);
      if (marketingChannel) supabase.removeChannel(marketingChannel);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [isOffline, flushPendingTx, user.hub_id, user.role, currentTab]);

  const handleAddTx = useCallback(async (tx: Transaction) => {
    setTransactions(prev => {
      const idx = prev.findIndex(t => t.id === tx.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = tx;
        return next;
      }
      return [tx, ...prev];
    });
    const tableName = tx.type === 'marketing' ? 'marketing_entries'
      : tx.type === 'cargo' ? 'cargo_entries'
      : tx.type === 'baggage' ? 'manifests'
      : tx.type === 'package' ? 'package_entries'
      : 'shipments';
    
    let hubId = user.hub_id;
    if (!hubId) {
      // Fallback: fetch hub_id from db based on user.hub
      const { data: hubData } = await supabase.from('hubs').select('id').eq('name', user.hub).single();
      if (hubData) {
        hubId = hubData.id;
      }
    }

    // Map internal Transaction type to Supabase table schema
    let payload: any = { id: tx.id };
    
    if (tx.type === 'marketing') {
      const parts = tx.detail.split(' · ');
      const route = (tx as any).route || parts[0] || '';
      const bagsStr = parts[1] || '';
      // Read direct fields first (faster, no regex needed)
      const bb = (tx as any)._bb ?? parseInt(bagsStr.match(/(\d+)\s*BB/)?.[1] || '0');
      const mb = (tx as any)._mb ?? parseInt(bagsStr.match(/(\d+)\s*MB/)?.[1] || '0');
      const sb = (tx as any)._sb ?? parseInt(bagsStr.match(/(\d+)\s*SB/)?.[1] || '0');

      payload = {
        id: tx.id,
        entry_ref: tx.id,
        // The tag/AWB number printed on the physical bag and encoded in its
        // QR code -- distinct from entry_ref (an internal id the customer
        // never sees). Without this, the public tracking page had no
        // column to look it up by at all.
        awb_tag_number: (tx as any).awb_tag_number || undefined,
        customer_name: tx.name,
        route: route,
        qty_big_bag: bb,
        qty_med_bag: mb,
        qty_small_bag: sb,
        bb_kg: (tx as any)._bbKg ?? 0,
        mb_kg: (tx as any)._mbKg ?? 0,
        sb_kg: (tx as any)._sbKg ?? 0,
        amount_paid: tx.amount,
        payment_mode: tx.mode,
        bank: tx.bank,
        hub_id: hubId,
        entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined, // Ensure valid UUID
        created_at: new Date().toISOString()
      };
    } else if (tx.type === 'cargo') {
      const parts = tx.detail.split(' · ');
      // parts[0] = airline (already in tx.airline, skip)
      const awbFromDetail = parts[1] || '';
      const pcsStr = parts[2] || '';
      const kgStr = parts[3] || '';
      const route = parts[4] || '';
      const content = parts[5] || '';
      
      payload = {
        id: tx.id,
        entry_ref: tx.id,
        consignee_name: tx.name,
        route: (tx as any).route || route,
        total_pcs: (tx as any).pieces != null ? (tx as any).pieces : (parseInt(pcsStr) || 1),
        total_kg: (tx as any).kg != null ? Math.round((tx as any).kg) : (Math.round(parseFloat(kgStr) || 0)),
        content_type: (tx as any).contentType ?? content,
        awb_tag_number: (tx as any).awb_tag_number || awbFromDetail,
        amount: tx.amount,
        receipt_mode: tx.mode,
        bank: tx.bank,
        hub_id: hubId,
        airline: (tx as any).airline || parts[0] || 'Unknown',
        commission_rate: (tx as any).commissionRate ?? null,
        remark: (tx as any).remarks || null,
        pickup_pin: (tx as any).pickupPin || null,
        consignee_phone: tx.consigneePhone || null,
        client_type: tx.clientType || null,
        corporate_client_id: (tx as any).corporate_client_id || null,
        entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined,
        created_at: new Date().toISOString()
      };
    } else if (tx.type === 'baggage') {
      const excessKg  = Math.round(tx.excessKg || (tx as any).excessKg || 0);
      const totalKg   = Math.round(tx.totalKg  || (tx as any).totalKg  || excessKg);
      const dest      = tx.destination || (tx as any).destination || '';
      const flightNo  = tx.flight      || (tx as any).flight      || tx.detail?.split(' · ')[0] || '';
      const pnr       = tx.pnr         || (tx as any).pnr         || null;
      const pcs       = tx.pieces      || (tx as any).pieces      || 1;

      payload = {
        id: tx.id,
        transaction_id: tx.id,
        passenger_name: tx.name,
        passenger_phone: (tx as any).phone || null,
        airline: tx.airline || 'ValueJet',
        flight_no: flightNo,
        destination: dest,
        pnr: pnr,
        total_pcs: pcs,
        excess_kg: excessKg,
        total_kg: totalKg,
        amount: tx.amount,
        payment_mode: tx.mode,
        bank: tx.bank,
        hub_id: hubId,
        entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined,
        created_at: new Date().toISOString()
      };
    } else if (tx.type === 'package') {
      payload = {
        id: tx.id,
        entry_ref: tx.id,
        customer_name: tx.name,
        destination: tx.destination || '',
        content_type: (tx as any).contentType || 'Package',
        total_pcs: tx.pieces || 1,
        total_kg: tx.kg || 0,
        contents: (tx as any).contents || null,
        status: tx.status || 'Intake',
        amount: tx.amount,
        // payment_mode's CHECK constraint doesn't allow 'Debt Paid' (that's
        // an in-app-only completion label, same as handleUpdateTx already
        // handles for cargo/manifests/marketing) -- write the base 'Debt'
        // value instead so a debt marked paid here doesn't fail this upsert.
        payment_mode: tx.mode === 'Debt Paid' ? 'Debt' : tx.mode,
        bank: tx.bank,
        payment_narration: tx.paymentNarration,
        debt_paid: (tx as any).debtPaid ?? false,
        debt_paid_at: (tx as any).debtPaidAt || null,
        amount_paid: tx.amountPaid,
        payment_history: tx.paymentHistory,
        hub_id: hubId,
        hub: user.hub,
        entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined,
        // This upserts on entry_ref, so a debt-paid update (which spreads the
        // existing tx and calls onAddTx again) must not stamp a fresh
        // timestamp here -- that would move the row's created_at to the
        // payment date, making it vanish from the day it was actually
        // created in any day-scoped query. tx.created_at is always already
        // set (PackageForm stamps it once at creation), so just carry it
        // through instead of regenerating it.
        created_at: tx.created_at || new Date().toISOString()
      };
    } else {
      payload = { ...tx, created_at: new Date().toISOString(), hub_id: hubId };
    }

    const { offline, error } = await writeWithOfflineSupport(tableName as any, payload);
    
    if (offline) {
      setPendingSyncCount(prev => prev + 1);
      showToast({ message: error ? `Error: ${error}` : 'Saved offline — syncs when reconnected', type: 'warning' });
    }
    // Write audit log
    writeAuditLog({
      user_id: user.id,
      user_name: user.name,
      action: 'CREATE',
      table_name: tableName,
      record_id: tx.id,
      description: `New ${tx.type} entry: ${tx.name} — ₦${tx.amount.toLocaleString()}`,
      hub: user.hub,
      hub_id: user.hub_id,
      new_values: { amount: tx.amount, mode: tx.mode, type: tx.type },
    }).catch(() => {});
  }, [user.hub_id, user.id, showToast]);

  const handleUpdateTx = useCallback(async (tx: Transaction) => {
    // Captured before the optimistic update below so a corporate debt
    // payment (see decrement_corporate_debt call further down) can compute
    // the actual delta just paid, not the whole entry's amount -- payments
    // are recorded one at a time via DebtorsTab, so this only decrements the
    // client's aggregate balance by what was newly paid in this update.
    const prevAmountPaid = transactionsRef.current.find(t => t.id === tx.id)?.amountPaid || 0;
    setTransactions(prev => prev.map(t => t.id === tx.id ? tx : t));

    const table = tx.type === 'cargo' ? 'cargo_entries'
                : tx.type === 'baggage' ? 'manifests'
                : tx.type === 'package' ? 'package_entries'
                : 'marketing_entries';

    // Each table uses different column names — cargo_entries uses receipt_mode,
    // manifests and marketing_entries use payment_mode. Do not unify these.
    const idCol      = table === 'manifests' ? 'transaction_id' : 'entry_ref';
    const modeCol    = table === 'cargo_entries' ? 'receipt_mode' : 'payment_mode';

    // cargo_entries.receipt_mode / manifests.payment_mode / marketing_entries.payment_mode
    // all have a CHECK constraint limited to the base payment methods --
    // none of them allow 'Debt Paid'. DebtorsTab sets tx.mode to 'Debt Paid'
    // as a client-side completion label when a debt is fully settled, which
    // made every full debt payoff across all three entry types fail this
    // update with a constraint-violation 400. The payoff itself is already
    // captured by amountPaid below, so write the base 'Debt' mode to the DB
    // column and keep 'Debt Paid' as the in-app label only.
    const dbMode = tx.mode === 'Debt Paid' ? 'Debt' : tx.mode;
    const updatePayload: Record<string, any> = {
      [modeCol]: dbMode,
      bank: tx.bank,
      status: tx.status,
    };
    if (tx.paymentConfirmed !== undefined) updatePayload.payment_confirmed = tx.paymentConfirmed;
    if (tx.posApprovalCode)               updatePayload.pos_approval_code  = tx.posApprovalCode;
    if (tx.confirmedBy)                   updatePayload.confirmed_by        = tx.confirmedBy;
    if (tx.confirmedAt)                   updatePayload.confirmed_at        = tx.confirmedAt;
    // Set when a Transfer is confirmed via a matched bank alert
    // (PaymentValidation.tsx) -- previously only ever held in optimistic
    // local state with no column to persist to, so it vanished on refetch.
    if (tx.bankReference)                 updatePayload.bank_reference      = tx.bankReference;
    if (tx.bankSender)                    updatePayload.bank_sender         = tx.bankSender;
    if (tx.bankAlertText)                 updatePayload.bank_alert_text     = tx.bankAlertText;
    // marketing_entries already has an amount_paid column holding the sale
    // amount itself (see 20260710_debt_payment_columns.sql) -- debt
    // repayment tracking for that table lives in debt_amount_paid instead
    // so it doesn't clobber the real sale amount.
    const amountPaidCol = table === 'marketing_entries' ? 'debt_amount_paid' : 'amount_paid';
    if (tx.amountPaid !== undefined)     updatePayload[amountPaidCol] = tx.amountPaid;
    if (tx.paymentHistory !== undefined) updatePayload.payment_history = tx.paymentHistory;

    // Main transaction amount -- previously never written here, so editing
    // "Amount" in the ledger's Edit modal looked saved locally (the
    // optimistic setTransactions above) but silently reverted on the next
    // fetch. marketing_entries stores its sale amount in amount_paid (see
    // the comment above); cargo_entries/manifests use amount directly.
    if (table === 'marketing_entries') {
      updatePayload.amount_paid = tx.amount;
    } else {
      updatePayload.amount = tx.amount;
    }

    // Editable shipment/customer details -- the ledger's Edit modal used to
    // only expose payment fields, so a misspelled name or a typo'd
    // weight/route had nowhere to be corrected.
    if (tx.type === 'cargo') {
      updatePayload.consignee_name = tx.name;
      updatePayload.route = tx.route;
      updatePayload.total_pcs = tx.pieces;
      updatePayload.total_kg = tx.kg;
      updatePayload.content_type = tx.contentType;
      updatePayload.airline = tx.airline;
      if ((tx as any).remarks !== undefined) updatePayload.remark = (tx as any).remarks;
      if ((tx as any).pickupPin !== undefined) updatePayload.pickup_pin = (tx as any).pickupPin;
      if (tx.consigneePhone !== undefined) updatePayload.consignee_phone = tx.consigneePhone;
    } else if (tx.type === 'baggage') {
      updatePayload.passenger_name = tx.name;
      updatePayload.flight_no = tx.flight;
      updatePayload.destination = tx.destination;
      updatePayload.total_pcs = tx.pieces || 1;
      const excess = Math.round(tx.excessKg || (tx as any).excessKg || tx.kg || 0);
      updatePayload.excess_kg = excess;
      updatePayload.total_kg = Math.round(tx.totalKg || (tx as any).totalKg || excess);
      if (tx.pnr !== undefined) updatePayload.pnr = tx.pnr;
      if ((tx as any).phone !== undefined || tx.consigneePhone !== undefined) {
        updatePayload.passenger_phone = (tx as any).phone || tx.consigneePhone;
      }
    } else if (tx.type === 'marketing') {
      updatePayload.customer_name = tx.name;
      updatePayload.route = tx.route;
      const bb = (tx as any)._bb;
      const mb = (tx as any)._mb;
      const sb = (tx as any)._sb;
      if (bb !== undefined) updatePayload.qty_big_bag = bb;
      if (mb !== undefined) updatePayload.qty_med_bag = mb;
      if (sb !== undefined) updatePayload.qty_small_bag = sb;
    } else if (tx.type === 'package') {
      updatePayload.customer_name = tx.name;
      updatePayload.destination = tx.destination;
      updatePayload.content_type = tx.contentType;
      updatePayload.total_pcs = tx.pieces || 1;
      updatePayload.total_kg = tx.kg || 0;
      updatePayload.contents = (tx as any).contents || null;
      if (tx.paymentNarration !== undefined) updatePayload.payment_narration = tx.paymentNarration;
    }

    // Update local IndexedDB mirror table so offline queries adopt changes immediately
    try {
      const existingRecord = await (db[table] as Dexie.Table).get(tx.id);
      if (existingRecord) {
        existingRecord.data = { ...existingRecord.data, ...updatePayload };
        await (db[table] as Dexie.Table).put(existingRecord);
      }
    } catch (err) {
      console.warn('Failed local DB update', err);
    }

    const { error } = await supabase.from(table).update(updatePayload).eq(idCol, tx.id);
    if (error) {
      showToast({ message: `Saved offline — update queued: ${error.message}`, type: 'warning' });
      try {
        await db.sync_queue.add({
          table_name: table,
          record_id: tx.id,
          action: 'UPDATE',
          payload: { ...updatePayload, id: tx.id },
          synced: 0,
          created_at: new Date().toISOString(),
        });
        setPendingSyncCount(prev => prev + 1);
      } catch (qErr) {
        console.error('Failed to queue update', qErr);
      }
    }
    // A B2B corporate shipment's debt being paid down (via DebtorsTab,
    // the only place that happens today) should reduce the client's
    // monthly aggregate the same way finalizing a new shipment increments
    // it -- previously nothing did this, so PricingConfiguration's "owed"
    // figure only ever went up. Only the newly-paid delta is decremented,
    // since payments are recorded one at a time.
    if (!error && tx.type === 'cargo' && tx.corporate_client_id && (tx.amountPaid || 0) > prevAmountPaid) {
      supabase.rpc('decrement_corporate_debt', {
        p_client_id: tx.corporate_client_id,
        p_amount: (tx.amountPaid || 0) - prevAmountPaid,
      }).then(({ error: rpcError }) => {
        if (rpcError) console.error('decrement_corporate_debt failed:', rpcError);
      });
    }
    if (!error && tx.paymentConfirmed) {
      writeAuditLog({
        user_id: user.id,
        user_name: user.name,
        action: 'PAYMENT_CONFIRM',
        table_name: table,
        record_id: tx.id,
        description: `Payment confirmed for ${tx.name} — ₦${tx.amount?.toLocaleString()} (${tx.mode})`,
        hub: user.hub,
        hub_id: user.hub_id,
        new_values: { payment_confirmed: true, mode: tx.mode },
      }).catch(() => {});
    }
  }, [showToast, user.hub, user.hub_id, user.id, user.name]);

  const handleAddExpense = useCallback(async (expense: Expense) => {
    setExpenses(prev => [expense, ...prev]);
    pendingExpenseRef.current.push(expense);
    const today = new Date().toISOString().split('T')[0];
    // expense.time may be "14:30" (no date) — only use it as a date if it looks like one
    const parsedDate = /^\d{4}-\d{2}-\d{2}/.test(expense.time) ? expense.time.split(' ')[0] : today;
    const payload = {
      id: expense.id,
      category: expense.type,
      amount: expense.amount,
      description: expense.description,
      date: parsedDate,
      time: expense.time,
      hub: user.hub,
      hub_id: user.hub_id || null,
      logged_by: user.name,
      logged_by_id: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : null,
      status: expense.status || 'pending',
      requires_approval: expense.amount > 20000,
      mode: expense.mode || 'Cash',
      bank: expense.bank || null
    };
    const { offline, error } = await writeWithOfflineSupport('expenses', payload);
    if (offline) {
      setPendingSyncCount(prev => prev + 1);
      showToast({ message: 'Expense saved offline — syncs when reconnected', type: 'warning' });
    } else if (error) {
      showToast({ message: `Failed to save expense: ${error}`, type: 'error' });
    }
  }, [user.hub, user.hub_id, user.id, user.name, showToast]);

  const handleUpdateExpense = useCallback(async (expenseId: string, decision: 'approved' | 'rejected') => {
    const nowIso = new Date().toISOString();
    const patch = decision === 'approved'
      ? { status: 'approved' as const, approvedBy: user.name, approvedAt: nowIso }
      : { status: 'rejected' as const, rejectedBy: user.name, rejectedAt: nowIso };

    setExpenses(prev => prev.map(e => e.id === expenseId ? { ...e, ...patch } : e));

    const { error } = await supabase.from('expenses').update(
      decision === 'approved'
        ? { status: 'approved', approved_by: user.name, approved_at: nowIso }
        : { status: 'rejected', rejected_by: user.name, rejected_at: nowIso }
    ).eq('id', expenseId);

    if (error) {
      showToast({ message: `Failed to save decision: ${error.message}`, type: 'error' });
    }
  }, [user.name, showToast]);

  const handleToggleWifi = useCallback(() => {
    setIsOffline(prev => {
      const offline = !prev;
      if (!offline && pendingSyncCount > 0) {
        showToast({ message: `${pendingSyncCount} transaction(s) synced to Supabase`, type: 'success' });
        setPendingSyncCount(0);
      }
      return offline;
    });
  }, [pendingSyncCount, showToast]);

  const handleShowCargoHistory = useCallback(() => setStreamLedger('cargo'), []);
  const handleShowMarketingHistory = useCallback(() => setStreamLedger('marketing'), []);
  const handleShowBaggageHistory = useCallback(() => setStreamLedger('baggage'), []);
  const handleCloseLedger = useCallback(() => setStreamLedger(null), []);
  const handleEOD = useCallback(async (summary: { 
    hub: string; hub_id: string; date: string; 
    cashTotal: number; posTotal: number; transferTotal: number; grandTotal: number;
    managerPhone?: string;
  }) => {
    try {
      if (summary.managerPhone) {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token || '';
        await fetch('/api/notify/whatsapp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            to: summary.managerPhone,
            message: `EOD REPORT — ${summary.hub}\nDate: ${summary.date}\nCash: ₦${summary.cashTotal.toLocaleString()}\nPOS: ₦${summary.posTotal.toLocaleString()}\nTransfer: ₦${summary.transferTotal.toLocaleString()}\nTOTAL: ₦${summary.grandTotal.toLocaleString()}\n\nLocked by ${user.name}`
          })
        });
      }
      showToast({ message: 'EOD locked — manager notified', type: 'success' });
    } catch (err) {
      showToast({ message: 'EOD locked but notification failed', type: 'warning' });
    }
  }, [user.name, showToast]);

  const filteredLedgerTransactions = useMemo(() => {
    if (!streamLedger) return [];
    return transactions.filter(t => t.type === streamLedger);
  }, [transactions, streamLedger]);

  return (
    <div style={{
      display: 'flex',
      height: '100dvh',
      width: '100vw',
      maxWidth: '100vw',
      background: 'var(--color-background)',
      overflowX: 'clip',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <SideNav
        user={user}
        currentTab={currentTab}
        onChangeTab={setCurrentTab}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={toggle}
        excessBaggageAirlines={excessBaggageAirlines}
      />

      <div
        className="ehi-main-content"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {/* Header — mobile only */}
        <Header
          user={user}
          isOffline={isOffline}
          pendingCount={pendingSyncCount}
          onToggleWifi={handleToggleWifi}
          onLogout={onLogout}
          theme={theme}
          onToggleTheme={toggle}
        />

        <main
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          <div
            className="mx-auto w-full flex-1 flex flex-col"
            style={{ maxWidth: 'var(--content-max-width)' }}
          >
            <ErrorBoundary>
              {initError && (
                <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
                  <div className="text-[var(--color-error)] font-mono text-[13px] text-center">
                    Failed to load data. Check your internet connection.
                  </div>
                  <button
                    onClick={() => setRetryTrigger(p => p + 1)}
                    className="px-6 py-2 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg text-[12px] font-bold"
                  >
                    Retry
                  </button>
                </div>
              )}
              {currentTab === 'Tower' && (
                (user.role === 'super_admin' || user.role === 'admin' || user.role === 'accountant') ? (
                  <Analytics user={user} transactions={transactions} expenses={expenses} />
                ) : (
                  <Dashboard user={user} transactions={transactions} />
                )
              )}
              {currentTab === 'Cargo' && (
                <CargoForm
                  onAddTx={handleAddTx}
                  user={user}
                  transactions={transactions}
                  onShowHistory={handleShowCargoHistory}
                />
              )}
              {currentTab === 'Marketing' && (
                <MarketingWorkspace
                  user={user}
                  transactions={transactions}
                  expenses={expenses}
                  onAddTx={handleAddTx}
                  onAddExpense={handleAddExpense}
                  onShowHistory={handleShowMarketingHistory}
                />
              )}
              {currentTab.startsWith('Baggage:') && (
                (() => {
                  const airlineName = currentTab.slice('Baggage:'.length);
                  const airline = excessBaggageAirlines.find(a => a.name === airlineName);
                  if (!airline) {
                    return (
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="animate-spin text-[var(--color-muted)]" size={24} />
                      </div>
                    );
                  }
                  return (
                    <ExcessBaggageForm
                      airline={airline}
                      onAddTx={handleAddTx}
                      user={user}
                      onShowHistory={handleShowBaggageHistory}
                      transactions={transactions}
                    />
                  );
                })()
              )}
              {currentTab === 'Packages' && (
                <PackageForm
                  user={user}
                  transactions={transactions}
                  expenses={expenses}
                  onAddTx={handleAddTx}
                  onAddExpense={handleAddExpense}
                />
              )}
              {currentTab === 'Scan' && <Scanner transactions={transactions} user={user} showToast={showToast} />}
              {currentTab === 'Incoming' && <IncomingToHub user={user} onBack={() => setCurrentTab('More')} />}
              {currentTab === 'OutboundArrivals' && <OutboundArrivals user={user} onBack={() => setCurrentTab('More')} />}
              {currentTab === 'MyTrips' && <MyTrips user={user} />}
              {currentTab === 'IT Debug' && <ITDashboard user={user} onBack={() => setCurrentTab('More')} />}
              {currentTab === 'Credit & Debit' && <CreditDebit user={user} transactions={transactions} onBack={() => setCurrentTab('More')} />}
              {currentTab === 'AirlineLogos' && <AirlineLogoManager user={user} onBack={() => setCurrentTab('More')} />}
              {currentTab === 'DataImport' && <DataImport user={user} onBack={() => setCurrentTab('More')} />}
              {currentTab === 'AirlineLedger' && <AirlineLedger user={user} onBack={() => setCurrentTab('More')} />}
              {currentTab === 'WeightManifest' && <WeightManifest user={user} onBack={() => setCurrentTab('More')} />}
              {currentTab === 'More' && (
                <More 
                   user={user} 
                   transactions={transactions} 
                   expenses={expenses}
                   onLogout={onLogout} 
                   onAddTx={handleAddTx}
                   onFullUpdateTx={handleUpdateTx}
                   onChangeTab={setCurrentTab}
                   onAddExpense={handleAddExpense}
                   onUpdateExpense={handleUpdateExpense}
                   dateRange={globalDateRange}
                   onDateRangeChange={setGlobalDateRange}
                   onEOD={handleEOD}
                   excessBaggageAirlines={excessBaggageAirlines}
                />
              )}
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <div className="ehi-bottomnav-wrapper fixed bottom-0 left-0 right-0 w-full z-50" style={{ overflow: 'visible', background: 'transparent' }}>
        <BottomNav user={user} currentTab={currentTab} onChangeTab={setCurrentTab} />
      </div>

      {/* Per-stream view-only ledger overlay */}
      {streamLedger && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-obsidian)]">
          <TransactionLedger
            user={user}
            transactions={filteredLedgerTransactions}
            onBack={handleCloseLedger}
            onUpdateTx={handleUpdateTx}
            defaultTypeFilter={streamLedger}
            viewOnly={user.role !== 'super_admin' && !user.can_print_ledger}
            dateRange={globalDateRange}
            onDateRangeChange={setGlobalDateRange}
          />
        </div>
      )}
    </div>
  );
};
