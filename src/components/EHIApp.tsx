import { useState, useEffect, lazy, Suspense, useRef, useCallback, memo, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { User, TabView, Transaction, Expense, ExcessBaggageAirline, CustomerWallet, HubShift, ShiftDepartment } from '../lib/types';
import { processSyncQueue, writeWithOfflineSupport, cleanupOldQueue, getUnsyncedLocalTransactions } from '../lib/sync';
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
import { GatWorkspace as GatWorkspaceRaw } from './views/GatWorkspace';
import { Scanner as ScannerRaw } from './views/Scanner';
import { IncomingToHub as IncomingToHubRaw } from './views/IncomingToHub';
import { OutboundArrivals as OutboundArrivalsRaw } from './views/OutboundArrivals';
import { MyTrips as MyTripsRaw } from './views/MyTrips';
import { ITDashboard as ITDashboardRaw } from './views/ITDashboard';
import { CreditDebit as CreditDebitRaw } from './views/CreditDebit';
import { AirlineLogoManager } from './views/AirlineLogoManager';
import { AirlinePerformance } from './views/AirlinePerformance';
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
const GatWorkspace = memo(GatWorkspaceRaw);
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

// URL <-> TabView mapping. App.tsx already renders EHIApp inside its own
// <BrowserRouter><Routes><Route path="/*" .../></Routes></BrowserRouter> --
// no router setup needed here, just consuming the context it already
// provides via useNavigate/useLocation below.
const TAB_PATHS: Partial<Record<TabView, string>> = {
  'Tower':              '/tower',
  'Cargo':              '/cargo',
  'Marketing':          '/marketing',
  'Packages':           '/packages',
  'Scan':               '/scan',
  'Incoming':           '/incoming',
  'IncomingToHub':      '/incoming-to-hub',
  'OutboundArrivals':   '/outbound-arrivals',
  'More':               '/more',
  'MyTrips':            '/my-trips',
  'IT Debug':           '/it-debug',
  'Credit & Debit':     '/credit-debit',
  'AirlineLogos':       '/airline-logos',
  'DataImport':         '/data-import',
  'AirlineLedger':      '/airline-ledger',
  'WeightManifest':     '/weight-manifest',
  'AirlinePerformance': '/airline-performance',
  'GAT':                '/gat',
  // Baggage:{name} and More:{name} are handled by prefix -- see tabToPath/pathToTab below.
};

function tabToPath(tab: TabView): string {
  if (tab.startsWith('Baggage:')) return '/baggage/' + encodeURIComponent(tab.slice('Baggage:'.length));
  if (tab.startsWith('More:'))    return '/more/'    + encodeURIComponent(tab.slice('More:'.length));
  return TAB_PATHS[tab] || '/tower';
}

function pathToTab(pathname: string): TabView {
  // Longest-prefix match against TAB_PATHS, then Baggage: parameterized.
  // Slug must be non-empty for Baggage -- an empty one falls through to the
  // plain TAB_PATHS lookup below instead of an invalid 'Baggage:' tab.
  if (pathname.startsWith('/baggage/')) {
    const slug = decodeURIComponent(pathname.slice('/baggage/'.length).split('/')[0]);
    if (slug) return ('Baggage:' + slug) as TabView;
  }
  // Every /more or /more/<sub-view> path renders the SAME top-level <More>
  // component -- this only needs to know "show More"; which sub-screen is
  // showing is derived independently inside More.tsx from location.pathname
  // itself (see MORE_SUB_ROUTES/activeSub there), which stays mounted and
  // re-reads the URL on every navigation without EHIApp's involvement.
  // Do NOT try to encode the sub-view into currentTab here the way Baggage
  // does: the render switch below matches currentTab === 'More' by exact
  // equality (not startsWith, unlike the Baggage: branch), and `More:<slug>`
  // is a different, unrelated namespace already used for permission-check
  // IDs (canAccessTab(user, 'More:EODClose', ...) in permissions.ts) that
  // are never assigned to currentTab. Producing More:<slug> here broke
  // every single More sub-screen: the instant a sub-route was entered,
  // currentTab became e.g. 'More:eod', matched no render branch at all, and
  // <More> unmounted -- so clicking ANY More-menu item blanked the whole
  // content area, not just refresh/deep-link.
  if (pathname === '/more' || pathname.startsWith('/more/')) return 'More';
  const hit = Object.entries(TAB_PATHS).find(([, p]) => pathname === p || pathname.startsWith(p + '/'));
  return (hit ? hit[0] : 'Tower') as TabView;
}

export const EHIApp = ({ user, onLogout }: { user: User; onLogout: () => void }) => {
  const getDefaultTab = (role: string): TabView => {
    if (role === 'office_work') return 'Cargo';
    if (role === 'marketing_agent') return 'Marketing';
    if (role === 'driver') return 'MyTrips';
    if (role === 'baggage_agent' && user.assigned_airline) return `Baggage:${user.assigned_airline}`;
    return 'Tower';
  };
  const navigate = useNavigate();
  const location = useLocation();
  // The tab is now URL-derived (see TAB_PATHS/tabToPath/pathToTab above) so
  // refresh preserves the view via the URL itself, back/forward work, and
  // every screen has a shareable link. setCurrentTab's signature is
  // unchanged -- every existing caller (SideNav, BottomNav, the 'ehi-nav'
  // window event, onBack={() => setCurrentTab('More')} etc.) keeps working.
  const currentTab: TabView = useMemo(() => pathToTab(location.pathname), [location.pathname]);
  const setCurrentTab = useCallback((tab: TabView) => {
    const path = tabToPath(tab);
    if (path !== location.pathname) navigate(path);
  }, [navigate, location.pathname]);

  // Bare "/" (fresh load, bookmark, PWA icon launch) has no tab encoded in
  // the URL yet -- redirect once to the remembered tab, falling back to the
  // role default, same fallback order the old useState initializer used.
  // This is what used to live inside that initializer; preserved here so a
  // fresh "/" load still restores the last-visited tab instead of always
  // bouncing to Tower.
  useEffect(() => {
    if (location.pathname !== '/' && location.pathname !== '') return;
    let target: TabView | null = null;
    try {
      const saved = localStorage.getItem(CURRENT_TAB_KEY(user.id));
      if (saved) target = saved as TabView;
    } catch { /* ignore -- fall through to role default */ }
    if (!target) target = getDefaultTab(user.role);
    navigate(tabToPath(target), { replace: true });
  }, [location.pathname, navigate, user]);

  useEffect(() => {
    try {
      localStorage.setItem(CURRENT_TAB_KEY(user.id), currentTab);
    } catch { /* ignore -- non-fatal, just won't restore next time */ }
  }, [currentTab, user.id]);
  // GAT needs a two-dimensional filter (both cargo AND package streams,
  // scoped to the GAT terminal tag) -- every other per-tab History button
  // needs just one stream and no terminal scope.
  type StreamLedgerScope =
    | { streams: ('cargo' | 'baggage' | 'marketing' | 'package')[]; terminal?: 'MMA2' | 'GAT' }
    | null;
  const [streamLedger, setStreamLedger] = useState<StreamLedgerScope>(null);
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

  // Global Customer Wallets state and real-time synchronization
  const [customerWallets, setCustomerWallets] = useState<CustomerWallet[]>([]);
  // Every shift touched in the last 24h (open or closed), not just the
  // single open one -- lets the ledger render both "Day started" and
  // "Day ended" markers, and survives a reload (unlike keeping only an
  // in-memory "active shift", which would be lost the moment a shift
  // closes and would otherwise erase all trace it ever happened).
  const [todayShifts, setTodayShifts] = useState<HubShift[]>([]);
  // Derived, not separate state -- each department (Cargo, Package,
  // Marketing, Baggage, GAT, plus 'all' for the unfiltered Master Ledger)
  // can have its own open shift simultaneously, so "the active shift" is a
  // map, not a single value. Recomputes automatically whenever todayShifts
  // changes (fetch, Start/End Day, or the realtime hub_shifts channel
  // below), so there's nothing extra to keep in sync by hand.
  const activeShiftsByDept = useMemo(() => {
    const map: Partial<Record<ShiftDepartment, HubShift>> = {};
    for (const s of todayShifts) if (s.status === 'open') map[s.department] = s;
    return map;
  }, [todayShifts]);

  useEffect(() => {
    let active = true;
    const fetchWallets = async () => {
      try {
        const { data } = await supabase.from('customer_wallets').select('*').order('updated_at', { ascending: false });
        if (active && data) setCustomerWallets(data as CustomerWallet[]);
      } catch (err) {}
    };
    fetchWallets();

    const channel = supabase
      .channel('customer_wallets_realtime_global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_wallets' }, () => {
        fetchWallets();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions' }, () => {
        fetchWallets();
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Keep a ref mirror of transactions for synchronous dedup checks in realtime handlers
  useEffect(() => { transactionsRef.current = transactions; }, [transactions]);

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

        // Admins see all hubs. All other staff now see transactions from all hubs in
        // their state (e.g. Lagos HQ + Lagos Cargo) via the backend RLS policies.
        // We remove the strict frontend .eq('hub_id', user.hub_id) filter so Supabase
        // can return the full state-wide ledger.
        const addHubFilter = (q: any) => q;
        const startDate = new Date(globalDateRange.start);
        startDate.setHours(0,0,0,0);
        const endDate = new Date(globalDateRange.end);
        endDate.setHours(23,59,59,999);
        const startISO = startDate.toISOString();
        const endISO = endDate.toISOString();

        const fetchShifts = async (): Promise<HubShift[]> => {
          if (!user.hub_id) return [];
          const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
          // A shift open longer than 24h (staff forgot to close it, an
          // overnight/weekend hub) must still come back here regardless of
          // its age -- a plain `started_at >= dayAgo` filter would drop it
          // entirely on a fresh page load, leaving activeShift stuck at
          // null even though the DB still has the row open (its unique
          // partial index in 20260818_explicit_shifts.sql guarantees at
          // most one), making End Shift unreachable and Start Shift hit
          // the "already open" conflict with no visible way to resolve it.
          const { data } = await supabase
            .from('hub_shifts')
            .select('*')
            .eq('hub_id', user.hub_id)
            .or(`started_at.gte.${dayAgo},status.eq.open`)
            .order('started_at', { ascending: false });
          return (data || []) as HubShift[];
        };

        const [shifts, cargoRes, baggageRes, mktRes, packageRes, expRes, profilesRes] = await Promise.all([
          fetchShifts(),
          addHubFilter(supabase.from('cargo_entries').select('entry_ref,consignee_name,airline,awb_tag_number,total_pcs,total_kg,size_inches,route,content_type,amount,receipt_mode,pickup_pin,status,created_at,commission_rate,bank,hub_id,terminal,remark,amount_paid,payment_history,payment_confirmed,pos_approval_code,confirmed_by,confirmed_at,consignee_phone,client_type,corporate_client_id,bank_reference,bank_sender,bank_alert_text,entered_by,last_edited_by,last_edited_at,wallet_id,wallet_deduction_amount,retrieved,retrieved_amount,retrieved_pieces,retrieved_kg,retrieval_note,retrieved_at,retrieved_by,retrieval_approved,retrieval_approved_by,retrieval_approved_at,is_debt_clearance,related_tx_id').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(5000)),
          addHubFilter(supabase.from('manifests').select('transaction_id,passenger_name,flight_no,destination,excess_kg,amount,payment_mode,created_at,bank,hub_id,total_kg,pnr,passenger_phone,total_pcs,amount_paid,payment_history,airline,payment_confirmed,pos_approval_code,confirmed_by,confirmed_at,bank_reference,bank_sender,bank_alert_text,entered_by,last_edited_by,last_edited_at,wallet_id,wallet_deduction_amount,retrieved,retrieved_amount,retrieved_pieces,retrieved_kg,retrieval_note,retrieved_at,retrieved_by,retrieval_approved,retrieval_approved_by,retrieval_approved_at,is_debt_clearance,related_tx_id,remark').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(5000)),
          addHubFilter(supabase.from('marketing_entries').select('entry_ref,awb_tag_number,customer_name,route,qty_big_bag,qty_med_bag,qty_small_bag,bb_kg,mb_kg,sb_kg,amount_paid,payment_mode,created_at,hub_id,bank,entered_by,last_edited_by,last_edited_at,debt_amount_paid,payment_history,payment_confirmed,pos_approval_code,confirmed_by,confirmed_at,bank_reference,bank_sender,bank_alert_text,wallet_id,wallet_deduction_amount,retrieved,retrieved_amount,retrieved_pieces,retrieved_kg,retrieval_note,retrieved_at,retrieved_by,retrieval_approved,retrieval_approved_by,retrieval_approved_at,is_debt_clearance,related_tx_id,remark,customer_phone').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(5000)),
          addHubFilter(supabase.from('package_entries').select('entry_ref,customer_name,destination,content_type,total_pcs,total_kg,contents,status,amount,payment_mode,bank,payment_narration,debt_paid,debt_paid_at,amount_paid,payment_history,created_at,hub_id,terminal,payment_confirmed,pos_approval_code,confirmed_by,confirmed_at,entered_by,last_edited_by,last_edited_at,wallet_id,wallet_deduction_amount,retrieved,retrieved_amount,retrieved_pieces,retrieved_kg,retrieval_note,retrieved_at,retrieved_by,retrieval_approved,retrieval_approved_by,retrieval_approved_at,is_debt_clearance,related_tx_id,remark,customer_phone').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(5000)),
          addHubFilter(supabase.from('expenses').select('*').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(5000)),
          supabase.from('user_profiles').select('id,name')
        ]);

        if (fetchEpochRef.current !== myEpoch) return;
        setTodayShifts(shifts);

        const profileLookup: Record<string, string> = {};
        if (profilesRes.data) {
          profilesRes.data.forEach(p => {
            if (p.id) profileLookup[p.id] = p.name || '';
          });
        }

        const allTx: Transaction[] = [];

        const { transactions: localUnsyncedTxs } = await getUnsyncedLocalTransactions();
        localUnsyncedTxs.forEach(t => allTx.push(t));

        if (cargoRes.data) {
          cargoRes.data.forEach(r => {
            const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
            allTx.push({
              id: r.entry_ref || r.id,
              name: r.consignee_name || 'Cargo',
              detail: `${r.airline || ''} · ${r.awb_tag_number || ''} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg · ${r.route || ''} · ${r.content_type || 'Package'}${r.size_inches ? ` · ${r.size_inches}in` : ''}`,
              amount: r.amount || 0,
              mode: r.receipt_mode === 'Debt' && (r.amount_paid || 0) >= (r.amount || 0) ? 'Debt Paid' : (r.receipt_mode || 'Cash'),
              time: new Date(r.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
              type: 'cargo',
              status: r.status || 'Intake',
              awb_tag_number: r.awb_tag_number,
              kg: r.total_kg,
              sizeInches: r.size_inches ?? undefined,
              pieces: r.total_pcs,
              pickupPin: r.pickup_pin || undefined,
              created_at: r.created_at,
              airline: r.airline,
              commissionRate: r.commission_rate ?? undefined,
              bank: r.bank,
              route: r.route,
              hub_id: r.hub_id,
              terminal: r.terminal,
              contentType: r.content_type,
              remarks: r.remark || undefined,
              enteredByName: enteredByName || undefined,
              editedBy: r.last_edited_by || undefined,
              editedAt: r.last_edited_at || undefined,
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
              retrieved: r.retrieved ?? undefined,
              retrievalNote: r.retrieval_note ?? undefined,
              retrievedAt: r.retrieved_at ?? undefined,
              retrievedBy: r.retrieved_by ?? undefined,
              retrievalApproved: r.retrieval_approved ?? undefined,
              retrievalApprovedBy: r.retrieval_approved_by ?? undefined,
              retrievalApprovedAt: r.retrieval_approved_at ?? undefined,
              // Was never selected/mapped back -- a debt-clearance shadow
              // entry's "COLLECTION" badge and link to the original debt
              // only survived until the next refetch, after which it was
              // visually indistinguishable from a brand-new cargo intake.
              is_debt_clearance: r.is_debt_clearance || undefined,
              related_tx_id: r.related_tx_id || undefined,
              raw: r,
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
              editedBy: r.last_edited_by || undefined,
              editedAt: r.last_edited_at || undefined,
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
              retrieved: r.retrieved ?? undefined,
              retrievalNote: r.retrieval_note ?? undefined,
              retrievedAt: r.retrieved_at ?? undefined,
              retrievedBy: r.retrieved_by ?? undefined,
              retrievalApproved: r.retrieval_approved ?? undefined,
              retrievalApprovedBy: r.retrieval_approved_by ?? undefined,
              retrievalApprovedAt: r.retrieval_approved_at ?? undefined,
              // Not previously set for baggage -- DebtorsTab's balance calc
              // and TransactionLedger's handleClearDebt both read
              // (t.raw as any)?.retrieved_amount, which silently resolved to
              // undefined (treated as 0) without this, so a partial baggage
              // retrieval would never reduce the computed remaining balance.
              // is_debt_clearance/related_tx_id: same COLLECTION-badge gap
              // fixed for cargo above, now closed for baggage too (see
              // 20260909_debt_clearance_columns_all_departments.sql).
              is_debt_clearance: r.is_debt_clearance || undefined,
              related_tx_id: r.related_tx_id || undefined,
              // remark: same cargo_entries-only gap as above -- see
              // 20260910_remark_column_all_departments.sql.
              remarks: r.remark || undefined,
              raw: r,
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
              editedBy: r.last_edited_by || undefined,
              editedAt: r.last_edited_at || undefined,
              amountPaid: r.debt_amount_paid || 0,
              paymentHistory: r.payment_history || [],
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code || undefined,
              confirmedBy: r.confirmed_by || undefined,
              confirmedAt: r.confirmed_at || undefined,
              bankReference: r.bank_reference || undefined,
              bankSender: r.bank_sender || undefined,
              bankAlertText: r.bank_alert_text || undefined,
              // Was missing here (unlike cargo/baggage/package's identical
              // mapping just above/below) despite being selected -- a
              // marketing sale partly paid via wallet showed the correct
              // wallet badge only in the instant of creation (optimistic
              // local state) and lost it on every subsequent refetch.
              wallet_id: r.wallet_id || undefined,
              wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
              retrieved: r.retrieved ?? undefined,
              retrievalNote: r.retrieval_note ?? undefined,
              retrievedAt: r.retrieved_at ?? undefined,
              retrievedBy: r.retrieved_by ?? undefined,
              retrievalApproved: r.retrieval_approved ?? undefined,
              retrievalApprovedBy: r.retrieval_approved_by ?? undefined,
              retrievalApprovedAt: r.retrieval_approved_at ?? undefined,
              // Was captured client-side but had no column to land in --
              // see MarketingWorkspace.tsx's own comment on this same gap.
              consigneePhone: r.customer_phone || undefined,
              // COLLECTION-badge gap fix, see cargo's own comment above.
              is_debt_clearance: r.is_debt_clearance || undefined,
              related_tx_id: r.related_tx_id || undefined,
              remarks: r.remark || undefined,
              raw: r,
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
              terminal: r.terminal,
              destination: r.destination,
              contentType: r.content_type,
              pieces: r.total_pcs || undefined,
              kg: r.total_kg || undefined,
              contents: r.contents || undefined,
              paymentNarration: r.payment_narration || undefined,
              debtPaid: r.debt_paid ?? undefined,
              debtPaidAt: r.debt_paid_at || undefined,
              enteredByName: enteredByName || undefined,
              editedBy: r.last_edited_by || undefined,
              editedAt: r.last_edited_at || undefined,
              amountPaid: r.amount_paid || 0,
              paymentHistory: r.payment_history || [],
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code || undefined,
              confirmedBy: r.confirmed_by || undefined,
              confirmedAt: r.confirmed_at || undefined,
              wallet_id: r.wallet_id || undefined,
              wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
              retrieved: r.retrieved ?? undefined,
              retrievalNote: r.retrieval_note ?? undefined,
              retrievedAt: r.retrieved_at ?? undefined,
              retrievedBy: r.retrieved_by ?? undefined,
              retrievalApproved: r.retrieval_approved ?? undefined,
              retrievalApprovedBy: r.retrieval_approved_by ?? undefined,
              retrievalApprovedAt: r.retrieval_approved_at ?? undefined,
              // Was captured client-side but had no column to land in --
              // see PackageForm.tsx's own comment on this same gap.
              consigneePhone: r.customer_phone || undefined,
              // COLLECTION-badge gap fix, see cargo's own comment above.
              is_debt_clearance: r.is_debt_clearance || undefined,
              related_tx_id: r.related_tx_id || undefined,
              remarks: r.remark || undefined,
              raw: r,
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
            hub_id: e.hub_id,
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

  // Maps a shift department to the Transaction.type(s) its sales_summary
  // should be computed from at End Day. 'all' (the Master Ledger's
  // hub-wide shift) keeps summing every type, unchanged from before this
  // department split. 'gat' isn't a Transaction.type at all -- it's cargo
  // and package rows tagged terminal='GAT' (see TerminalSwitch.tsx).
  const shiftDeptMatchesTx = useCallback((department: ShiftDepartment, t: Transaction): boolean => {
    if (department === 'all') return true;
    if (department === 'gat') return (t.type === 'cargo' || t.type === 'package') && (t as any).terminal === 'GAT';
    return t.type === department;
  }, []);

  const handleStartShift = useCallback(async (department: ShiftDepartment) => {
    if (!user.hub_id) return;
    // Client-side guard against the common case (double-click, a stale
    // shift the user forgot to close). The real guard is the partial
    // unique index on hub_shifts(hub_id, department) WHERE status = 'open'
    // (20260818_explicit_shifts.sql, 20260833_department_scoped_shifts.sql)
    // -- this just gives a friendly message instead of a raw
    // constraint-violation error for the race case.
    if (activeShiftsByDept[department]) {
      showToast({ message: `A ${department === 'all' ? '' : department + ' '}shift is already open for your hub.`, type: 'warning' });
      return;
    }
    try {
      const { data, error } = await supabase
        .from('hub_shifts')
        .insert({
          hub_id: user.hub_id,
          department,
          opened_by: user.name,
        })
        .select()
        .single();

      if (error) throw error;
      const newShift = data as HubShift;
      setTodayShifts(prev => [newShift, ...prev]);
      showToast({ message: 'Shift started successfully!', type: 'success' });
    } catch (e: any) {
      // Postgres unique_violation -- another device/tab won the race.
      const message = e?.code === '23505'
        ? 'A shift is already open for your hub (started elsewhere just now).'
        : `Failed to start shift: ${e.message}`;
      showToast({ message, type: 'error' });
    }
  }, [activeShiftsByDept, user.hub_id, user.name, showToast]);

  const handleEndShift = useCallback(async (department: ShiftDepartment) => {
    const shift = activeShiftsByDept[department];
    if (!shift) return;
    try {
      // Calculate sales summary since shift start, scoped to THIS hub AND
      // this department only. transactionsRef.current can legitimately
      // contain sibling-hub rows now (see addHubFilter above, removed in
      // favor of state-wide RLS visibility) -- without the hub_id check,
      // closing a shift at one hub could roll another hub's sales into
      // this hub's locked snapshot.
      const shiftTx = transactionsRef.current.filter(t =>
        t.hub_id === shift.hub_id &&
        new Date(t.created_at || t.time) >= new Date(shift.started_at) &&
        shiftDeptMatchesTx(department, t)
      );

      const salesSummary = {
        totalTxCount: shiftTx.length,
        totalSales: shiftTx.reduce((acc, t) => acc + t.amount, 0),
        cashSales: shiftTx.filter(t => t.mode === 'Cash').reduce((acc, t) => acc + t.amount, 0),
        transferSales: shiftTx.filter(t => t.mode === 'Transfer').reduce((acc, t) => acc + t.amount, 0),
        posSales: shiftTx.filter(t => t.mode === 'POS').reduce((acc, t) => acc + t.amount, 0),
        debtSales: shiftTx.filter(t => t.mode === 'Debt').reduce((acc, t) => acc + t.amount, 0),
        // Frozen line-item snapshot -- so a past shift's "Shift Transaction
        // History" (Analytics.tsx) reads what was actually true at close
        // time instead of live-re-querying, which could drift from the
        // summary figures above if entries are edited/retrieved afterward.
        transactions: shiftTx.map(t => ({
          type: t.type, created_at: t.created_at, name: t.name, amount: t.amount, mode: t.mode,
        })),
      };

      const { data, error } = await supabase
        .from('hub_shifts')
        .update({
          status: 'closed',
          ended_at: new Date().toISOString(),
          closed_by: user.name,
          sales_summary: salesSummary
        })
        .eq('id', shift.id)
        .select()
        .single();

      if (error) throw error;
      const closedShift = data as HubShift;
      setTodayShifts(prev => prev.map(s => s.id === closedShift.id ? closedShift : s));
      showToast({ message: 'Shift ended and sales summary generated!', type: 'success' });
    } catch (e: any) {
      showToast({ message: `Failed to end shift: ${e.message}`, type: 'error' });
    }
  }, [activeShiftsByDept, user.name, shiftDeptMatchesTx, showToast]);

  const handleForceSync = useCallback(async () => {
    setIsOffline(false);
    const queueCount = await db.sync_queue.where('synced').equals(0).count().catch(() => 0);
    setPendingSyncCount(queueCount);
    const { synced, errors } = await processSyncQueue();
    if (synced > 0) {
      showToast({ message: `${synced} transaction(s) synced to server`, type: 'success' });
      const remaining = await db.sync_queue.where('synced').equals(0).count().catch(() => 0);
      setPendingSyncCount(remaining);
      fetchInitial();
      if (errors.length > 0) {
        setTimeout(() => showToast({ message: `${remaining} item(s) failed: ${errors[0]}`, type: 'error' }), 2000);
      }
    } else {
      const remaining = await db.sync_queue.where('synced').equals(0).count().catch(() => 0);
      setPendingSyncCount(remaining);
      if (remaining === 0) {
        showToast({ message: 'All local entries are fully synced', type: 'info' });
      } else if (errors.length > 0) {
        showToast({ message: `Sync failed for ${remaining} item(s): ${errors[0]}`, type: 'error' });
      }
    }

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
  }, [showToast, fetchInitial, user.hub, user.hub_code, user.role, user.assigned_airline, user.view_overrides, excessBaggageAirlines]);

  useEffect(() => {
    cleanupOldQueue();
    const handleOnline = () => handleForceSync();
    const handleOffline = () => setIsOffline(true);

    if (navigator.onLine) handleOnline();
    const syncInterval = window.setInterval(() => {
      if (navigator.onLine) handleOnline();
    }, 60000);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

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
  }, [handleForceSync, user, excessBaggageAirlines]);

  useEffect(() => {
    if (isOffline) return;
    fetchInitial();
  }, [isOffline, retryTrigger, fetchInitial]);

  const prevTabRef = useRef(currentTab);
  useEffect(() => {
    const prevTab = prevTabRef.current;
    prevTabRef.current = currentTab;
    if (isOffline || prevTab === currentTab) return;

    const isDataTab =
      currentTab === 'Cargo' ||
      currentTab === 'Marketing' ||
      currentTab === 'Packages' ||
      currentTab === 'GAT' ||
      currentTab.startsWith('Baggage:') ||
      ['Tower', 'Scan', 'More'].includes(currentTab);

    if (isDataTab) fetchInitial();
  }, [currentTab, isOffline, fetchInitial]);

  useEffect(() => {
    if (isOffline) return;

    const isAdmin = ['super_admin','admin','accountant','auditor'].includes(user.role);
    const canSeePin = ['admin', 'super_admin', 'accountant'].includes(user.role);
    // No per-hub channel filter on cargo/baggage/marketing/package below:
    // fetchInitial is state-wide (RLS-scoped) since the frontend hub filter
    // was removed, and a channel filtered to one hub made the live feed
    // silently miss sister-hub entries that the initial fetch DID show.
    // Realtime events are RLS-filtered server-side for authenticated
    // channels, so scoping stays consistent with fetch. If per-hub live
    // feeds are ever needed again, both layers must change together --
    // never one without the other. hub_shifts stays hub-local below (a
    // shift is deliberately per-hub, not state-wide).

    let needsCargo = true;
    let needsBaggage = true;
    let needsMarketing = true;
    let needsPackage = true;

    if (isAdmin) {
      const isAggregateView = ['Tower', 'Scan', 'More'].includes(currentTab);
      needsCargo = isAggregateView || currentTab === 'Cargo' || currentTab === 'GAT';
      needsBaggage = isAggregateView || currentTab.startsWith('Baggage:');
      needsMarketing = isAggregateView || currentTab === 'Marketing';
      needsPackage = isAggregateView || currentTab === 'Packages' || currentTab === 'GAT';
    }

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
        { event: 'INSERT', schema: 'public', table: 'cargo_entries' },
        payload => {
          const r = payload.new as any;
          pushUnique({
            id: r.entry_ref || r.id,
            name: r.consignee_name || 'Cargo',
            detail: `${r.airline || ''} · ${r.awb_tag_number || ''} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg · ${r.route || ''} · ${r.content_type || 'Package'}${r.size_inches ? ` · ${r.size_inches}in` : ''}`,
            amount: r.amount || 0,
            // Same 'Debt Paid' recomputation fetchInitial and this
            // channel's own UPDATE handler use -- an INSERT is rarely
            // already fully paid off, but kept consistent regardless.
            mode: r.receipt_mode === 'Debt' && (r.amount_paid || 0) >= (r.amount || 0) ? 'Debt Paid' : (r.receipt_mode || 'Cash'),
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
            pickupPin: canSeePin ? (r.pickup_pin || undefined) : undefined,
            consigneePhone: r.consignee_phone || undefined,
            clientType: r.client_type || undefined,
            wallet_id: r.wallet_id || undefined,
            wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
            // Brought to parity with baggage/marketing/package's own INSERT
            // handlers below, which already carry these -- cargo's was
            // missing raw entirely, so (t.raw as any)?.retrieved_amount
            // read as undefined for a cargo entry until the next full
            // refetch, same bug class already fixed for the other 3 types.
            retrieved: r.retrieved ?? undefined,
            retrievalNote: r.retrieval_note ?? undefined,
            retrievedAt: r.retrieved_at ?? undefined,
            retrievedBy: r.retrieved_by ?? undefined,
            retrievalApproved: r.retrieval_approved ?? undefined,
            retrievalApprovedBy: r.retrieval_approved_by ?? undefined,
            retrievalApprovedAt: r.retrieval_approved_at ?? undefined,
            is_debt_clearance: r.is_debt_clearance ?? undefined,
            related_tx_id: r.related_tx_id ?? undefined,
            remarks: r.remark ?? undefined,
            raw: r,
          });
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cargo_entries' },
        payload => {
          const r = payload.new as any;
          setTransactions(prev => prev.map(t =>
            t.id === (r.entry_ref || r.id) ? {
              ...t,
              status: r.status || t.status,
              // 'Debt Paid' is a synthetic display value never stored in
              // receipt_mode itself (clear_cargo_debt only ever updates
              // amount_paid/payment_history/payment_confirmed, never the
              // mode column -- confirmed via 20260824_clear_cargo_debt_
              // corporate_decrement.sql) -- recomputed here the same way
              // fetchInitial does, or a debt just cleared via
              // handleClearDebt's RPC call would show its correct
              // optimistic 'Debt Paid' state for a moment, then get
              // silently reverted back to 'Debt' the instant this
              // handler's own realtime round-trip for that same RPC
              // write arrives.
              mode: r.receipt_mode === 'Debt' && (r.amount_paid || 0) >= (r.amount || 0) ? 'Debt Paid' : (r.receipt_mode || t.mode),
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code,
              bank: r.bank ?? t.bank,
              confirmedBy: r.confirmed_by ?? t.confirmedBy,
              confirmedAt: r.confirmed_at ?? t.confirmedAt,
              editedBy: r.last_edited_by ?? t.editedBy,
              editedAt: r.last_edited_at ?? t.editedAt,
              wallet_id: r.wallet_id ?? t.wallet_id,
              wallet_deduction_amount: r.wallet_deduction_amount ?? t.wallet_deduction_amount,
              // Without this, a retrieval processed on another device never
              // shows up here until a full refetch -- DebtorsTab's balance
              // and handleClearDebt's remaining-debt calc both read
              // (t.raw as any)?.retrieved_amount, which stayed frozen at
              // whatever it was on initial load.
              retrieved: r.retrieved ?? t.retrieved,
              retrievalNote: r.retrieval_note ?? t.retrievalNote,
              retrievedAt: r.retrieved_at ?? t.retrievedAt,
              retrievedBy: r.retrieved_by ?? t.retrievedBy,
              retrievalApproved: r.retrieval_approved ?? t.retrievalApproved,
              retrievalApprovedBy: r.retrieval_approved_by ?? t.retrievalApprovedBy,
              retrievalApprovedAt: r.retrieval_approved_at ?? t.retrievalApprovedAt,
              is_debt_clearance: r.is_debt_clearance ?? (t as any).is_debt_clearance,
              related_tx_id: r.related_tx_id ?? (t as any).related_tx_id,
              remarks: r.remark ?? t.remarks,
              raw: { ...(t.raw || {}), ...r },
            } : t
          ));
        }
      )
      .subscribe() : null;

    const baggageChannel = needsBaggage ? supabase
      .channel('ehi-baggage-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'manifests' },
        payload => {
          const r = payload.new as any;
          pushUnique({
            id: r.transaction_id || r.id,
            name: r.passenger_name || 'Baggage Passenger',
            detail: `${r.flight_no || ''} · ${r.destination || ''} · +${r.excess_kg || 0}kg excess`,
            amount: r.amount || 0,
            mode: r.payment_mode === 'Debt' && (r.amount_paid || 0) >= (r.amount || 0) ? 'Debt Paid' : (r.payment_mode || 'POS'),
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
            wallet_id: r.wallet_id || undefined,
            wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
            retrieved: r.retrieved ?? undefined,
            retrievalNote: r.retrieval_note ?? undefined,
            retrievedAt: r.retrieved_at ?? undefined,
            retrievedBy: r.retrieved_by ?? undefined,
            retrievalApproved: r.retrieval_approved ?? undefined,
            retrievalApprovedBy: r.retrieval_approved_by ?? undefined,
            retrievalApprovedAt: r.retrieval_approved_at ?? undefined,
            is_debt_clearance: r.is_debt_clearance ?? undefined,
            related_tx_id: r.related_tx_id ?? undefined,
            remarks: r.remark ?? undefined,
            raw: r,
          });
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'manifests' },
        payload => {
          const r = payload.new as any;
          setTransactions(prev => prev.map(t =>
            t.id === (r.transaction_id || r.id) ? {
              ...t,
              // Same 'Debt Paid' recomputation as the cargo channel above --
              // see its comment for why this can't just pass payment_mode through.
              mode: r.payment_mode === 'Debt' && (r.amount_paid || 0) >= (r.amount || 0) ? 'Debt Paid' : (r.payment_mode || t.mode),
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code,
              editedBy: r.last_edited_by ?? t.editedBy,
              editedAt: r.last_edited_at ?? t.editedAt,
              wallet_id: r.wallet_id ?? t.wallet_id,
              wallet_deduction_amount: r.wallet_deduction_amount ?? t.wallet_deduction_amount,
              retrieved: r.retrieved ?? t.retrieved,
              retrievalNote: r.retrieval_note ?? t.retrievalNote,
              retrievedAt: r.retrieved_at ?? t.retrievedAt,
              retrievedBy: r.retrieved_by ?? t.retrievedBy,
              retrievalApproved: r.retrieval_approved ?? t.retrievalApproved,
              retrievalApprovedBy: r.retrieval_approved_by ?? t.retrievalApprovedBy,
              retrievalApprovedAt: r.retrieval_approved_at ?? t.retrievalApprovedAt,
              is_debt_clearance: r.is_debt_clearance ?? (t as any).is_debt_clearance,
              related_tx_id: r.related_tx_id ?? (t as any).related_tx_id,
              remarks: r.remark ?? t.remarks,
              raw: { ...(t.raw || {}), ...r },
            } : t
          ));
        }
      )
      .subscribe() : null;

    const marketingChannel = needsMarketing ? supabase
      .channel('ehi-marketing-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'marketing_entries' },
        payload => {
          const r = payload.new as any;
          pushUnique({
            id: r.entry_ref || r.id,
            awb_tag_number: r.awb_tag_number || undefined,
            name: r.customer_name || 'Customer',
            detail: `${r.route || ''} · ${r.qty_big_bag || 0}BB ${r.qty_med_bag || 0}MB ${r.qty_small_bag || 0}SB`,
            amount: r.amount_paid || 0,
            mode: r.payment_mode === 'Debt' && (r.debt_amount_paid || 0) >= (r.amount_paid || 0) ? 'Debt Paid' : (r.payment_mode || 'Cash'),
            time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
            type: 'marketing',
            status: 'Intake',
            created_at: r.created_at,
            hub_id: r.hub_id,
            route: r.route,
            wallet_id: r.wallet_id || undefined,
            wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
            retrieved: r.retrieved ?? undefined,
            retrievalNote: r.retrieval_note ?? undefined,
            retrievedAt: r.retrieved_at ?? undefined,
            retrievedBy: r.retrieved_by ?? undefined,
            retrievalApproved: r.retrieval_approved ?? undefined,
            retrievalApprovedBy: r.retrieval_approved_by ?? undefined,
            retrievalApprovedAt: r.retrieval_approved_at ?? undefined,
            is_debt_clearance: r.is_debt_clearance ?? undefined,
            related_tx_id: r.related_tx_id ?? undefined,
            remarks: r.remark ?? undefined,
            raw: r,
          });
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'marketing_entries' },
        payload => {
          const r = payload.new as any;
          setTransactions(prev => prev.map(t =>
            t.id === (r.entry_ref || r.id) ? {
              ...t,
              // Same 'Debt Paid' recomputation as the cargo channel above,
              // but keyed on debt_amount_paid vs amount_paid -- marketing_
              // entries' own naming inversion (amount_paid there is the
              // SALE total, not what's been paid down; see clear_marketing_
              // debt's comment on this).
              mode: r.payment_mode === 'Debt' && (r.debt_amount_paid || 0) >= (r.amount_paid || 0) ? 'Debt Paid' : (r.payment_mode || t.mode),
              paymentConfirmed: r.payment_confirmed,
              status: r.status || t.status,
              editedBy: r.last_edited_by ?? t.editedBy,
              editedAt: r.last_edited_at ?? t.editedAt,
              wallet_id: r.wallet_id ?? t.wallet_id,
              wallet_deduction_amount: r.wallet_deduction_amount ?? t.wallet_deduction_amount,
              retrieved: r.retrieved ?? t.retrieved,
              retrievalNote: r.retrieval_note ?? t.retrievalNote,
              retrievedAt: r.retrieved_at ?? t.retrievedAt,
              retrievedBy: r.retrieved_by ?? t.retrievedBy,
              retrievalApproved: r.retrieval_approved ?? t.retrievalApproved,
              retrievalApprovedBy: r.retrieval_approved_by ?? t.retrievalApprovedBy,
              retrievalApprovedAt: r.retrieval_approved_at ?? t.retrievalApprovedAt,
              is_debt_clearance: r.is_debt_clearance ?? (t as any).is_debt_clearance,
              related_tx_id: r.related_tx_id ?? (t as any).related_tx_id,
              remarks: r.remark ?? t.remarks,
              raw: { ...(t.raw || {}), ...r },
            } : t
          ));
        }
      )
      .subscribe() : null;

    const packageChannel = needsPackage ? supabase
      .channel('ehi-package-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'package_entries' },
        payload => {
          const r = payload.new as any;
          pushUnique({
            id: r.entry_ref || r.id,
            name: r.customer_name || 'Customer',
            detail: `${r.destination || ''} · ${r.content_type || 'Package'} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg${r.contents ? ` · ${r.contents}` : ''}`,
            amount: r.amount || 0,
            mode: r.payment_mode === 'Debt' && (r.debt_paid === true || (r.amount_paid || 0) >= (r.amount || 0)) ? 'Debt Paid' : (r.payment_mode || 'Cash'),
            time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
            type: 'package',
            status: r.status || 'Intake',
            created_at: r.created_at,
            hub_id: r.hub_id,
            terminal: r.terminal,
            destination: r.destination,
            contentType: r.content_type,
            pieces: r.total_pcs,
            kg: r.total_kg,
            contents: r.contents || undefined,
            wallet_id: r.wallet_id || undefined,
            wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
            retrieved: r.retrieved ?? undefined,
            retrievalNote: r.retrieval_note ?? undefined,
            retrievedAt: r.retrieved_at ?? undefined,
            retrievedBy: r.retrieved_by ?? undefined,
            retrievalApproved: r.retrieval_approved ?? undefined,
            retrievalApprovedBy: r.retrieval_approved_by ?? undefined,
            retrievalApprovedAt: r.retrieval_approved_at ?? undefined,
            is_debt_clearance: r.is_debt_clearance ?? undefined,
            related_tx_id: r.related_tx_id ?? undefined,
            remarks: r.remark ?? undefined,
            raw: r,
          });
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'package_entries' },
        payload => {
          const r = payload.new as any;
          setTransactions(prev => prev.map(t =>
            t.id === (r.entry_ref || r.id) ? {
              ...t,
              status: r.status || t.status,
              // Same 'Debt Paid' recomputation as the cargo channel above,
              // also OR'ing in the legacy debt_paid boolean flag to match
              // fetchInitial's own package formula exactly.
              mode: r.payment_mode === 'Debt' && (r.debt_paid === true || (r.amount_paid || 0) >= (r.amount || 0)) ? 'Debt Paid' : (r.payment_mode || t.mode),
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code,
              bank: r.bank ?? t.bank,
              confirmedBy: r.confirmed_by ?? t.confirmedBy,
              confirmedAt: r.confirmed_at ?? t.confirmedAt,
              debtPaid: r.debt_paid ?? t.debtPaid,
              debtPaidAt: r.debt_paid_at ?? t.debtPaidAt,
              amountPaid: r.amount_paid ?? t.amountPaid,
              editedBy: r.last_edited_by ?? t.editedBy,
              editedAt: r.last_edited_at ?? t.editedAt,
              wallet_id: r.wallet_id ?? t.wallet_id,
              wallet_deduction_amount: r.wallet_deduction_amount ?? t.wallet_deduction_amount,
              retrieved: r.retrieved ?? t.retrieved,
              retrievalNote: r.retrieval_note ?? t.retrievalNote,
              retrievedAt: r.retrieved_at ?? t.retrievedAt,
              retrievedBy: r.retrieved_by ?? t.retrievedBy,
              retrievalApproved: r.retrieval_approved ?? t.retrievalApproved,
              retrievalApprovedBy: r.retrieval_approved_by ?? t.retrievalApprovedBy,
              retrievalApprovedAt: r.retrieval_approved_at ?? t.retrievalApprovedAt,
              is_debt_clearance: r.is_debt_clearance ?? (t as any).is_debt_clearance,
              related_tx_id: r.related_tx_id ?? (t as any).related_tx_id,
              remarks: r.remark ?? t.remarks,
              raw: { ...(t.raw || {}), ...r },
            } : t
          ));
        }
      )
      .subscribe() : null;

    // hub_shifts only ever loads this device's own hub (fetchShifts above
    // does .eq('hub_id', user.hub_id) unconditionally, unlike the
    // admin-sees-everything cargo/baggage/marketing channels above) --
    // matched here so a shift started/ended on another device/tab for this
    // hub updates todayShifts (and, via activeShiftsByDept, every
    // department's derived active shift) immediately instead of waiting
    // for the next full fetchInitial (tab switch, date change, or the 60s
    // sync interval).
    const shiftsChannel = user.hub_id ? supabase
      .channel('ehi-shifts-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hub_shifts', filter: `hub_id=eq.${user.hub_id}` },
        payload => {
          const r = payload.new as HubShift;
          setTodayShifts(prev => prev.some(s => s.id === r.id) ? prev : [r, ...prev]);
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'hub_shifts', filter: `hub_id=eq.${user.hub_id}` },
        payload => {
          const r = payload.new as HubShift;
          setTodayShifts(prev => prev.map(s => s.id === r.id ? r : s));
        }
      )
      .subscribe() : null;

    return () => {
      if (cargoChannel) supabase.removeChannel(cargoChannel);
      if (baggageChannel) supabase.removeChannel(baggageChannel);
      if (marketingChannel) supabase.removeChannel(marketingChannel);
      if (packageChannel) supabase.removeChannel(packageChannel);
      if (shiftsChannel) supabase.removeChannel(shiftsChannel);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [isOffline, flushPendingTx, user.hub_id, user.role, currentTab]);

  const handleAddTx = useCallback(async (tx: Transaction) => {
    const tableName = tx.type === 'marketing' ? 'marketing_entries'
      : tx.type === 'cargo' ? 'cargo_entries'
      : tx.type === 'baggage' ? 'manifests'
      : tx.type === 'package' ? 'package_entries'
      : null;
    if (!tableName) {
      // A tx.type outside the known four is a programming error, not a
      // runtime condition -- the old fallback wrote to a 'shipments' table
      // that does not exist, silently losing the entry. Fail loud instead,
      // and BEFORE the optimistic UI update below -- otherwise a rejected
      // entry would still flash into the ledger locally and only vanish
      // (unexplained) on the next refetch, since it was never actually saved.
      console.error(`handleAddTx: unknown tx.type "${tx.type}" — entry not saved`, tx);
      showToast({ message: `Internal error: unknown entry type "${tx.type}". Entry NOT saved — report this.`, type: 'error' });
      return;
    }

    setTransactions(prev => {
      const idx = prev.findIndex(t => t.id === tx.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = tx;
        return next;
      }
      return [tx, ...prev];
    });

    // Prefer the hub already stamped on the transaction (e.g. DebtorsTab's
    // debt-clearance shadow entry deliberately carries the original debt's
    // hub, not the acting user's) -- only fall back to the current user's
    // own hub for normal entry creation, where tx.hub_id is never set.
    let hubId = tx.hub_id || user.hub_id;
    if (!hubId) {
      const { data: hubData } = await supabase.from('hubs').select('id').eq('name', user.hub).single();
      if (hubData) {
        hubId = hubData.id;
      }
    }

    let payload: any = { id: tx.id };
    
    if (tx.type === 'marketing') {
      // See the cargo branch's comment below on why a debt-clearance shadow
      // entry's summary-text `detail` must never be positionally parsed --
      // here it would otherwise write the literal "DEBT CLEARANCE" string
      // into the route column.
      const parts = tx.is_debt_clearance ? [] : tx.detail.split(' · ');
      const route = (tx as any).route || parts[0] || '';
      const bagsStr = parts[1] || '';
      const bb = (tx as any)._bb ?? parseInt(bagsStr.match(/(\d+)\s*BB/)?.[1] || '0');
      const mb = (tx as any)._mb ?? parseInt(bagsStr.match(/(\d+)\s*MB/)?.[1] || '0');
      const sb = (tx as any)._sb ?? parseInt(bagsStr.match(/(\d+)\s*SB/)?.[1] || '0');

      payload = {
        id: tx.id,
        entry_ref: tx.id,
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
        payment_mode: tx.mode === 'Debt Paid' ? 'Debt' : tx.mode,
        bank: tx.bank,
        hub_id: hubId,
        // Set by MarketingWorkspace.tsx (mirrors CargoForm/PackageForm/
        // ExcessBaggageForm) when a wallet covers all or part of the
        // sale -- was never actually persisted here despite the wallet
        // itself already being debited via a separate chargeWalletForSale
        // call, so the sale record permanently forgot which wallet paid
        // for it (and how much) the moment the page next refreshed.
        wallet_id: tx.wallet_id ?? null,
        wallet_deduction_amount: tx.wallet_deduction_amount ?? null,
        entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined,
        // Was captured client-side but had no column to land in -- see
        // MarketingWorkspace.tsx's own comment on this same gap.
        customer_phone: tx.consigneePhone || null,
        // Set by DebtorsTab.tsx/TransactionLedger.tsx's debt-clearance
        // shadow entries but never actually written here -- see the cargo
        // branch's own comment below on the same gap. Was cargo_entries-only
        // until 20260909_debt_clearance_columns_all_departments.sql.
        is_debt_clearance: tx.is_debt_clearance ?? false,
        related_tx_id: tx.related_tx_id ?? null,
        // The debt-clearance shadow entry's Orig/Paid/Bal breakdown (and
        // the ledger Edit modal's general-purpose Remarks field) -- see
        // 20260910_remark_column_all_departments.sql, was cargo_entries-only.
        remark: (tx as any).remarks || null,
        created_at: new Date().toISOString()
      };
    } else if (tx.type === 'cargo') {
      // A debt-clearance shadow entry's `detail` is a human-readable "DEBT
      // CLEARANCE · Orig: ... · Paid: ... · Bal: ..." summary, not the
      // structured "airline · awb · pcs · kg · route · content" format real
      // cargo intake writes -- splitting it positionally wrote fragments of
      // that summary into route/awb_tag_number/content_type (route became
      // the literal "Bal: ₦50,000" once an Age segment pushed indices over).
      // Skip the parse entirely here; every field below already falls back
      // to a clean default when its explicit value is absent.
      const parts = tx.is_debt_clearance ? [] : tx.detail.split(' · ');
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
        size_inches: tx.sizeInches ?? null,
        content_type: (tx as any).contentType ?? content,
        awb_tag_number: (tx as any).awb_tag_number || awbFromDetail,
        amount: tx.amount,
        receipt_mode: tx.mode === 'Debt Paid' ? 'Debt' : tx.mode,
        bank: tx.bank,
        hub_id: hubId,
        terminal: (tx as any).terminal ?? 'MMA2',
        airline: (tx as any).airline || parts[0] || 'Unknown',
        commission_rate: (tx as any).commissionRate ?? null,
        remark: (tx as any).remarks || null,
        pickup_pin: (tx as any).pickupPin || null,
        consignee_phone: tx.consigneePhone || null,
        client_type: tx.clientType || null,
        corporate_client_id: (tx as any).corporate_client_id || null,
        applied_rate_per_kg: tx.applied_rate_per_kg ?? null,
        // See the marketing branch's comment above -- same gap, same fix,
        // for the department this bug was actually noticed in.
        wallet_id: tx.wallet_id ?? null,
        wallet_deduction_amount: tx.wallet_deduction_amount ?? null,
        entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined,
        // Set on the client by DebtorsTab.tsx/TransactionLedger.tsx's
        // debt-clearance shadow entries but never actually written here --
        // the "COLLECTION" badge and the link back to the cleared debt only
        // survived until the next refetch, after which the row looked like
        // an ordinary new cargo intake for the same consignee/airline/route.
        is_debt_clearance: tx.is_debt_clearance ?? false,
        related_tx_id: tx.related_tx_id ?? null,
        created_at: new Date().toISOString()
      };
    } else if (tx.type === 'baggage') {
      const excessKg  = Math.round(tx.excessKg || (tx as any).excessKg || 0);
      const totalKg   = Math.round(tx.totalKg  || (tx as any).totalKg  || excessKg);
      const dest      = tx.destination || (tx as any).destination || '';
      // Same debt-clearance guard as the cargo/marketing branches -- a
      // shadow entry's "DEBT CLEARANCE · ..." detail text must not become
      // the literal flight number.
      const flightNo  = tx.flight      || (tx as any).flight      || (tx.is_debt_clearance ? '' : tx.detail?.split(' · ')[0]) || '';
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
        payment_mode: tx.mode === 'Debt Paid' ? 'Debt' : tx.mode,
        bank: tx.bank,
        hub_id: hubId,
        // See the marketing branch's comment above -- same gap, same fix.
        wallet_id: tx.wallet_id ?? null,
        wallet_deduction_amount: tx.wallet_deduction_amount ?? null,
        entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined,
        // See the marketing branch's comment above -- same gap, same fix.
        is_debt_clearance: tx.is_debt_clearance ?? false,
        related_tx_id: tx.related_tx_id ?? null,
        // See the marketing branch's comment above -- same gap, same fix.
        remark: (tx as any).remarks || null,
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
        payment_mode: tx.mode === 'Debt Paid' ? 'Debt' : tx.mode,
        bank: tx.bank,
        payment_narration: tx.paymentNarration,
        debt_paid: (tx as any).debtPaid ?? false,
        debt_paid_at: (tx as any).debtPaidAt || null,
        amount_paid: tx.amountPaid,
        payment_history: tx.paymentHistory,
        // See the marketing branch's comment above -- same gap, same fix.
        wallet_id: tx.wallet_id ?? null,
        wallet_deduction_amount: tx.wallet_deduction_amount ?? null,
        hub_id: hubId,
        hub: user.hub,
        terminal: (tx as any).terminal ?? 'MMA2',
        entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined,
        // See the marketing branch's comment above -- same gap, same fix.
        customer_phone: tx.consigneePhone || null,
        // See the marketing branch's comment above -- same gap, same fix.
        is_debt_clearance: tx.is_debt_clearance ?? false,
        related_tx_id: tx.related_tx_id ?? null,
        // See the marketing branch's comment above -- same gap, same fix.
        remark: (tx as any).remarks || null,
        created_at: tx.created_at || new Date().toISOString()
      };
    } else {
      payload = { ...tx, created_at: new Date().toISOString(), hub_id: hubId };
    }

    const { offline, error } = await writeWithOfflineSupport(tableName, payload);
    
    if (offline) {
      setPendingSyncCount(prev => prev + 1);
      showToast({ message: error ? `Error: ${error}` : 'Saved offline — syncs when reconnected', type: 'warning' });
    }
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

  // Builds the full Supabase update payload for a transaction. Pulled out of
  // handleUpdateTx so it can be called twice (once for the incoming tx, once
  // for the transaction's previous known state) to diff out columns that
  // didn't actually change -- see the comment at its call site below for why.
  const buildTxUpdatePayload = (t: Transaction, table: string): Record<string, any> => {
    const modeCol = table === 'cargo_entries' ? 'receipt_mode' : 'payment_mode';
    const dbMode = t.mode === 'Debt Paid' ? 'Debt' : t.mode;
    const updatePayload: Record<string, any> = {
      [modeCol]: dbMode,
      bank: t.bank,
      status: t.status,
    };
    if (t.paymentConfirmed !== undefined) updatePayload.payment_confirmed = t.paymentConfirmed;
    if (t.posApprovalCode)               updatePayload.pos_approval_code  = t.posApprovalCode;
    if (t.confirmedBy)                   updatePayload.confirmed_by        = t.confirmedBy;
    if (t.confirmedAt)                   updatePayload.confirmed_at        = t.confirmedAt;
    if (t.bankReference)                 updatePayload.bank_reference      = t.bankReference;
    if (t.bankSender)                    updatePayload.bank_sender         = t.bankSender;
    if (t.bankAlertText)                 updatePayload.bank_alert_text     = t.bankAlertText;
    if (t.editedBy)                      updatePayload.last_edited_by      = t.editedBy;
    if (t.editedAt)                      updatePayload.last_edited_at      = t.editedAt;
    const amountPaidCol = table === 'marketing_entries' ? 'debt_amount_paid' : 'amount_paid';
    if (t.amountPaid !== undefined)     updatePayload[amountPaidCol] = t.amountPaid;
    if (t.paymentHistory !== undefined) updatePayload.payment_history = t.paymentHistory;
    // Set when TransactionLedger's edit modal switches mode to 'Wallet'
    // (chargeWalletForSale already deducted the balance by the time this
    // runs) -- without persisting these two columns, the deduction would
    // have genuinely happened against the wallet, but the entry itself
    // would silently forget which wallet paid for it on the next refetch.
    if (t.wallet_id !== undefined)              updatePayload.wallet_id = t.wallet_id;
    if (t.wallet_deduction_amount !== undefined) updatePayload.wallet_deduction_amount = t.wallet_deduction_amount;

    if (table === 'marketing_entries') {
      updatePayload.amount_paid = t.amount;
    } else {
      updatePayload.amount = t.amount;
    }

    // remark now exists on all 4 department tables (see
    // 20260910_remark_column_all_departments.sql) -- this used to be set
    // only inside the cargo branch below, so editing the ledger's
    // Remarks field (canEditRemarks, rendered for every transaction type
    // with no type gate) on a baggage/marketing/package entry looked
    // like it saved (optimistic UI update) but silently never reached
    // the database, reverting on the next refetch.
    if ((t as any).remarks !== undefined) updatePayload.remark = (t as any).remarks;

    if (t.type === 'cargo') {
      updatePayload.consignee_name = t.name;
      updatePayload.route = t.route;
      updatePayload.total_pcs = t.pieces;
      updatePayload.total_kg = t.kg;
      updatePayload.content_type = t.contentType;
      updatePayload.airline = t.airline;
      if ((t as any).pickupPin !== undefined) updatePayload.pickup_pin = (t as any).pickupPin;
      if (t.consigneePhone !== undefined) updatePayload.consignee_phone = t.consigneePhone;
    } else if (t.type === 'baggage') {
      updatePayload.passenger_name = t.name;
      updatePayload.flight_no = t.flight;
      updatePayload.destination = t.destination;
      updatePayload.total_pcs = t.pieces || 1;
      const excess = Math.round(t.excessKg || (t as any).excessKg || t.kg || 0);
      updatePayload.excess_kg = excess;
      updatePayload.total_kg = Math.round(t.totalKg || (t as any).totalKg || excess);
      if (t.pnr !== undefined) updatePayload.pnr = t.pnr;
      if ((t as any).phone !== undefined || t.consigneePhone !== undefined) {
        updatePayload.passenger_phone = (t as any).phone || t.consigneePhone;
      }
    } else if (t.type === 'marketing') {
      updatePayload.customer_name = t.name;
      updatePayload.route = t.route;
      const bb = (t as any)._bb;
      const mb = (t as any)._mb;
      const sb = (t as any)._sb;
      if (bb !== undefined) updatePayload.qty_big_bag = bb;
      if (mb !== undefined) updatePayload.qty_med_bag = mb;
      if (sb !== undefined) updatePayload.qty_small_bag = sb;
    } else if (t.type === 'package') {
      updatePayload.customer_name = t.name;
      updatePayload.destination = t.destination;
      updatePayload.content_type = t.contentType;
      updatePayload.total_pcs = t.pieces || 1;
      updatePayload.total_kg = t.kg || 0;
      updatePayload.contents = (t as any).contents || null;
      if (t.paymentNarration !== undefined) updatePayload.payment_narration = t.paymentNarration;
    }

    return updatePayload;
  };

  const handleUpdateTx = useCallback(async (tx: Transaction) => {
    const prevTx = transactionsRef.current.find(t => t.id === tx.id);
    setTransactions(prev => prev.map(t => t.id === tx.id ? tx : t));

    const table = tx.type === 'cargo' ? 'cargo_entries'
                : tx.type === 'baggage' ? 'manifests'
                : tx.type === 'package' ? 'package_entries'
                : 'marketing_entries';

    const idCol = table === 'manifests' ? 'transaction_id' : 'entry_ref';

    const fullPayload = buildTxUpdatePayload(tx, table);
    // A retrieval (TransactionLedger.tsx's executeRetrieval) calls onUpdateTx
    // with a full Transaction built by spreading the PRIOR record and
    // overriding only retrieval fields -- mode/bank/amount/route/etc are
    // therefore unchanged from what's already in the database, and
    // process_cargo_retrieval() already persisted the retrieval columns
    // server-side via its own RPC call. Diffing against the previously-known
    // transaction and sending only what actually changed avoids rewriting a
    // dozen unrelated, unchanged columns on every retrieval. Falls back to
    // the full payload whenever there's no known baseline, or when the diff
    // would otherwise be empty -- this can only ever narrow what's sent
    // relative to the old unconditional behavior, never omit a real change.
    let updatePayload = fullPayload;
    let auditOldValues: Record<string, any> | undefined;
    if (prevTx) {
      const prevPayload = buildTxUpdatePayload(prevTx, table);
      const diffed: Record<string, any> = {};
      const diffedOld: Record<string, any> = {};
      for (const key of Object.keys(fullPayload)) {
        if (JSON.stringify(fullPayload[key]) !== JSON.stringify(prevPayload[key])) {
          diffed[key] = fullPayload[key];
          diffedOld[key] = prevPayload[key];
        }
      }
      if (Object.keys(diffed).length > 0) { updatePayload = diffed; auditOldValues = diffedOld; }
    }

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
          // processSyncQueue retries every queued item as an upsert keyed on
          // idCol (entry_ref/transaction_id) -- without that column in the
          // payload, Postgres can't match the existing row, falls through to
          // a fresh INSERT, and dies on the first NOT NULL column that isn't
          // in this partial update payload. Without this, a failed edit
          // retries forever and never actually applies, despite the toast
          // above claiming it's queued.
          payload: { ...updatePayload, id: tx.id, [idCol]: tx.id },
          synced: 0,
          created_at: new Date().toISOString(),
        });
        setPendingSyncCount(prev => prev + 1);
      } catch (qErr) {
        console.error('Failed to queue update', qErr);
      }
    }
    // No client-side decrement_corporate_debt call here -- clear_cargo_debt
    // (supabase/migrations/20260824_clear_cargo_debt_corporate_decrement.sql)
    // already decrements corporate_clients.accumulated_monthly_debt
    // atomically, server-side, for every real debt-clearing path (both
    // DebtorsTab.tsx and TransactionLedger.tsx's handleClearDebt route
    // through the clear_cargo_debt RPC). TransactionLedger.tsx's
    // handleClearDebt also calls onUpdateTx() with the RPC's own returned
    // amountPaid right after -- a client-side decrement here fired again
    // on that same call, double-decrementing the corporate balance by
    // 2x the real payment every time a corporate cargo debt was cleared
    // from the ledger. amountPaid has no other legitimate write path for
    // a corporate cargo entry outside of clear_cargo_debt.
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
    // TransactionLedger.tsx's handleSaveEdit is the only caller that sets
    // editedBy -- but toggleConfirm/savePosCode/handleClearDebt/
    // executeRetrieval all build their update object by spreading the
    // existing local Transaction (`{...tx}`/`{...e.raw}`), which carries
    // editedBy/editedAt forward from whatever the LAST edit was, even
    // though none of those four actions are themselves an edit. Gating on
    // tx.editedBy truthiness alone would fire a spurious "entry edited"
    // audit entry (misattributed to whoever triggered THIS call) and
    // permanently stick the ledger's "Edited by" badge past its actual
    // relevance every time any of those four run on a previously-edited
    // entry. Comparing tx.editedAt against the previously-known value
    // instead only fires when THIS call is the one that actually set a
    // new edit timestamp (handleSaveEdit always stamps a fresh one).
    // last_edited_by/at are excluded from the diff shown below since they
    // always differ from the previous snapshot by definition and would
    // otherwise drown out the actual field(s) that changed.
    const isGenuineEdit = !!tx.editedBy && !!tx.editedAt && tx.editedAt !== prevTx?.editedAt;
    if (!error && isGenuineEdit) {
      const omitAttribution = (obj?: Record<string, any>) =>
        obj ? Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'last_edited_by' && k !== 'last_edited_at')) : undefined;
      writeAuditLog({
        user_id: user.id,
        user_name: user.name,
        action: 'UPDATE',
        table_name: table,
        record_id: tx.id,
        description: `${tx.type} entry edited: ${tx.name} — ₦${tx.amount?.toLocaleString()}`,
        hub: user.hub,
        hub_id: user.hub_id,
        old_values: omitAttribution(auditOldValues),
        new_values: omitAttribution(updatePayload),
      }).catch(() => {});
    }
  }, [showToast, user.hub, user.hub_id, user.id, user.name]);

  const handleAddExpense = useCallback(async (expense: Expense) => {
    // Callers (CargoForm/PackageForm/etc.) build the Expense object without
    // a hub_id -- attach this device's hub here so EODReconciliation's
    // hub-scoped filter sees this expense immediately, not just after the
    // next full fetchInitial re-maps it from Supabase.
    expense = { ...expense, hub_id: expense.hub_id || user.hub_id };
    setExpenses(prev => [expense, ...prev]);
    pendingExpenseRef.current.push(expense);
    const today = new Date().toISOString().split('T')[0];
    const parsedDate = /^\d{4}-\d{2}-\d{2}/.test(expense.time) ? expense.time.split(' ')[0] : today;
    const payload = {
      id: expense.id,
      category: expense.type,
      amount: expense.amount,
      description: expense.description,
      date: parsedDate,
      time: expense.time,
      hub: user.hub,
      hub_id: expense.hub_id || null,
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

    const updatePayload = decision === 'approved'
      ? { status: 'approved', approved_by: user.name, approved_at: nowIso }
      : { status: 'rejected', rejected_by: user.name, rejected_at: nowIso };

    const { error } = await supabase.from('expenses').update(updatePayload).eq('id', expenseId);

    if (error) {
      // Same offline-queue fallback as handleUpdateTx above -- without this,
      // an approve/reject done with no connection only ever showed an error
      // toast: the optimistic setExpenses() above already flipped the UI to
      // approved/rejected, so the decision looked saved but silently never
      // reached Supabase and nothing retried it.
      try {
        await db.sync_queue.add({
          table_name: 'expenses',
          record_id: expenseId,
          action: 'UPDATE',
          payload: { ...updatePayload, id: expenseId },
          synced: 0,
          created_at: new Date().toISOString(),
        });
        setPendingSyncCount(prev => prev + 1);
        showToast({ message: 'Saved offline — decision queued to sync', type: 'warning' });
      } catch (qErr) {
        console.error('Failed to queue expense decision', qErr);
        showToast({ message: `Failed to save decision: ${error.message}`, type: 'error' });
      }
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

  const handleShowCargoHistory = useCallback(() => setStreamLedger({ streams: ['cargo'] }), []);
  const handleShowMarketingHistory = useCallback(() => setStreamLedger({ streams: ['marketing'] }), []);
  const handleShowBaggageHistory = useCallback(() => setStreamLedger({ streams: ['baggage'] }), []);
  const handleShowPackageHistory = useCallback(() => setStreamLedger({ streams: ['package'] }), []);
  // Only cargo/package entries ever carry a terminal tag -- filtering by
  // terminal='GAT' alone (typeFilter left at 'All' downstream) already
  // excludes marketing/baggage, which default to 'MMA2' when untagged. The
  // explicit streams list here is a belt-and-braces match on top of that.
  const handleShowGatHistory = useCallback(() => setStreamLedger({ streams: ['cargo', 'package'], terminal: 'GAT' }), []);
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

  // Which department's shift this per-tab History overlay Start/End Day
  // control (and current-shift boundary) should track -- GAT's scope
  // spans two Transaction types but is its own single department.
  const streamLedgerDepartment: ShiftDepartment | null = useMemo(() => {
    if (!streamLedger) return null;
    if (streamLedger.terminal === 'GAT') return 'gat';
    return streamLedger.streams.length === 1 ? streamLedger.streams[0] : 'all';
  }, [streamLedger]);

  const STREAM_LEDGER_DEPT_LABEL: Record<Exclude<ShiftDepartment, 'all'>, string> = {
    cargo: 'Cargo', package: 'Package', marketing: 'Marketing', baggage: 'Baggage', gat: 'GAT',
  };

  const filteredLedgerTransactions = useMemo(() => {
    if (!streamLedger) return [];
    return transactions.filter(t => {
      if (!streamLedger.streams.includes(t.type as any)) return false;
      if (streamLedger.terminal) {
        const rowTerminal = (t as any).raw?.terminal ?? (t as any).terminal ?? 'MMA2';
        if (rowTerminal !== streamLedger.terminal) return false;
      }
      return true;
    });
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
        <Header
          user={user}
          isOffline={isOffline}
          pendingCount={pendingSyncCount}
          onToggleWifi={handleToggleWifi}
          onLogout={onLogout}
          theme={theme}
          onToggleTheme={toggle}
          onManualSync={handleForceSync}
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
                  <Analytics user={user} transactions={transactions} expenses={expenses} dateRange={globalDateRange} setDateRange={setGlobalDateRange} />
                ) : (
                  <Dashboard
                    user={user}
                    transactions={transactions}
                  />
                )
              )}
              {currentTab === 'Cargo' && (
                <CargoForm
                  onAddTx={handleAddTx}
                  user={user}
                  transactions={transactions}
                  onShowHistory={handleShowCargoHistory}
                  customerWallets={customerWallets}
                  setCustomerWallets={setCustomerWallets}
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
                  customerWallets={customerWallets}
                  setCustomerWallets={setCustomerWallets}
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
                      customerWallets={customerWallets}
                      setCustomerWallets={setCustomerWallets}
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
                  onShowHistory={handleShowPackageHistory}
                  customerWallets={customerWallets}
                  setCustomerWallets={setCustomerWallets}
                />
              )}
              {currentTab === 'GAT' && (
                <GatWorkspace
                  user={user}
                  transactions={transactions}
                  expenses={expenses}
                  onAddTx={handleAddTx}
                  onAddExpense={handleAddExpense}
                  onShowHistory={handleShowGatHistory}
                  customerWallets={customerWallets}
                  setCustomerWallets={setCustomerWallets}
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
              {currentTab === 'AirlinePerformance' && <AirlinePerformance user={user} onBack={() => setCurrentTab('More')} />}
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
                   activeShift={activeShiftsByDept['all'] || null}
                   todayShifts={todayShifts.filter(s => s.department === 'all')}
                   onStartShift={() => handleStartShift('all')}
                   onEndShift={() => handleEndShift('all')}
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
            onAddTx={handleAddTx}
            defaultTypeFilter={streamLedger.streams.length === 1 ? streamLedger.streams[0] : null}
            defaultTerminalFilter={streamLedger.terminal}
            viewOnly={user.role !== 'super_admin' && !user.can_print_ledger}
            dateRange={globalDateRange}
            onDateRangeChange={setGlobalDateRange}
            activeShift={streamLedgerDepartment ? (activeShiftsByDept[streamLedgerDepartment] || null) : null}
            shifts={streamLedgerDepartment ? todayShifts.filter(s => s.department === streamLedgerDepartment) : []}
            onStartShift={streamLedgerDepartment ? () => handleStartShift(streamLedgerDepartment) : undefined}
            onEndShift={streamLedgerDepartment ? () => handleEndShift(streamLedgerDepartment) : undefined}
            shiftLabel={streamLedgerDepartment && streamLedgerDepartment !== 'all' ? STREAM_LEDGER_DEPT_LABEL[streamLedgerDepartment] : undefined}
            customerWallets={customerWallets}
          />
        </div>
      )}
    </div>
  );
};
