import { TabView, User, UserRole, ExcessBaggageAirline } from './types';

// Single source of truth for "which nav views can this user see." Before
// this, the same role-based logic was hand-duplicated across SideNav.tsx,
// BottomNav.tsx, EHIApp.tsx's ehi-nav allowlist, and More.tsx's menu
// gates -- four lists that had to be kept in sync by hand, and the only
// place a per-user override (view_overrides) could plug in without
// touching all four separately.

export interface ViewDef {
  id: TabView;
  label: string;
  roles: UserRole[];
  // Groups the checklist in StaffManagement's view-access editor -- undefined
  // means it's one of the original top-level nav tabs (see groupViewDefs
  // below). Purely cosmetic; has no bearing on getAllowedTabs/canAccessTab.
  category?: string;
}

// Same role list as the 'More' tab itself -- used below for the handful of
// More-menu sub-screens (EOD Close, Transaction Ledger, Help Desk) that
// were never role-gated at all before this: anyone who can open More could
// already reach them, so their default here has to match 'More' exactly or
// turning on a view_overrides for someone would silently take these away.
const MORE_TAB_ROLES: UserRole[] = ['super_admin', 'admin', 'accountant', 'auditor', 'cargo_agent', 'baggage_agent', 'marketing_agent', 'driver', 'office_work'];

// The static (non-airline-dependent) top-level views and which roles get
// each one by default. This is what a user falls back to when they have
// no view_overrides set -- i.e. every account until a super_admin
// explicitly customizes one.
export const STATIC_VIEWS: ViewDef[] = [
  { id: 'Tower', label: 'Dashboard', roles: ['super_admin', 'admin', 'cargo_agent', 'baggage_agent', 'marketing_agent', 'accountant', 'auditor'] },
  { id: 'Cargo', label: 'Cargo Entry', roles: ['super_admin', 'admin', 'cargo_agent', 'office_work'] },
  // GAT (General Aviation Terminal / MM1) is a second physical Lagos
  // counter, not a new hub -- same roles as Cargo (anyone who can log a
  // Lagos sale can work at GAT), further gated to LOS-hub users only inside
  // BottomNav.tsx (this list has no hub concept to filter on).
  { id: 'GAT', label: 'GAT Terminal', roles: ['super_admin', 'admin', 'cargo_agent', 'office_work'] },
  { id: 'Marketing', label: 'Marketing', roles: ['super_admin', 'admin', 'marketing_agent', 'office_work'] },
  { id: 'Packages', label: 'Package Desk', roles: ['super_admin', 'admin', 'cargo_agent', 'marketing_agent', 'office_work'] },
  { id: 'Scan', label: 'QR Scanner', roles: ['super_admin', 'admin', 'cargo_agent', 'baggage_agent', 'marketing_agent', 'accountant', 'auditor', 'driver', 'office_work'] },
  { id: 'Incoming', label: 'Incoming To Hub', roles: ['super_admin', 'admin', 'cargo_agent', 'baggage_agent', 'driver', 'office_work'] },
  { id: 'OutboundArrivals', label: 'Outbound Arrivals', roles: ['super_admin', 'admin', 'cargo_agent', 'baggage_agent', 'marketing_agent', 'driver', 'accountant', 'auditor', 'office_work'] },
  { id: 'MyTrips', label: 'My Trips', roles: ['driver'] },
  { id: 'More', label: 'More', roles: ['super_admin', 'admin', 'accountant', 'auditor', 'cargo_agent', 'baggage_agent', 'marketing_agent', 'driver', 'office_work'] },
  { id: 'IT Debug', label: 'IT Debug Console', roles: ['super_admin'] },
  { id: 'Credit & Debit', label: 'Credit & Debit', roles: ['super_admin', 'admin', 'accountant'] },

  // Everything below used to be gated inside More.tsx by hardcoded,
  // per-screen role checks (canAccessAccounting/canAccessRecon/etc.) that a
  // super_admin's per-user view_overrides had no way to reach -- granting
  // someone the "Custom View Access" override could change their top-level
  // tabs but never touched what they could open inside More. Folding these
  // in as regular TabViews, with roles matching each screen's previous
  // check exactly, changes nothing for anyone without an override while
  // making all of it individually overridable for people who do have one.
  { id: 'More:EODClose', label: 'EOD Daily Close', roles: MORE_TAB_ROLES, category: 'Daily Operations' },
  { id: 'More:TransactionLedger', label: 'Transaction Ledger', roles: MORE_TAB_ROLES, category: 'Daily Operations' },
  // GAT has no printers -- same role list as the ledger itself (MORE_TAB_ROLES)
  // since any Lagos-hub agent who can see the ledger needs to be able to
  // batch-print for GAT at MMA2.
  { id: 'More:GatPrintQueue', label: 'GAT Print Queue', roles: MORE_TAB_ROLES, category: 'Daily Operations' },
  { id: 'More:BankReconciliation', label: 'Bank Reconciliation', roles: ['super_admin', 'accountant'], category: 'Finance' },
  { id: 'More:AccountingConsole', label: 'Central Accounting ERP', roles: ['super_admin', 'admin', 'accountant'], category: 'Finance' },
  { id: 'More:Reports', label: 'Advanced Reports', roles: ['super_admin', 'admin', 'accountant'], category: 'Finance' },
  { id: 'More:RatesList', label: 'Rates Directory', roles: MORE_TAB_ROLES, category: 'Finance' },
  { id: 'More:AirlineCommissions', label: 'Airline Commissions', roles: ['super_admin', 'admin', 'accountant'], category: 'Finance' },
  { id: 'More:AirlinePerformance', label: 'Airline Sales & Weight Breakdown', roles: ['super_admin', 'admin', 'accountant', 'auditor'], category: 'Finance' },
  { id: 'More:CorporateBilling', label: 'Corporate Client Billing', roles: ['super_admin', 'admin', 'accountant'], category: 'Finance' },
  { id: 'More:OfficeWorkReconcile', label: 'Office Work Reconciliation', roles: ['super_admin', 'admin', 'accountant'], category: 'Finance' },
  { id: 'More:Forecasting', label: 'Demand Forecasting AI', roles: ['super_admin', 'admin'], category: 'Intelligence' },
  { id: 'More:FraudAlerts', label: 'Fraud & Anomalies Feed', roles: ['super_admin', 'admin', 'auditor', 'accountant'], category: 'Intelligence' },
  { id: 'More:AuditLog', label: 'Revision Audit Log', roles: ['super_admin', 'auditor'], category: 'Intelligence' },
  { id: 'More:Fleet', label: 'Fleet Management', roles: ['super_admin', 'admin'], category: 'Fleet & Logistics' },
  { id: 'More:PODLog', label: 'Proof of Delivery Log', roles: ['super_admin', 'admin', 'auditor', 'accountant'], category: 'Fleet & Logistics' },
  { id: 'More:Dispatch', label: 'Dispatch & Fleet Tracking', roles: ['super_admin', 'admin'], category: 'Fleet & Logistics' },
  { id: 'AirlineLedger', label: 'Airline Balance Ledger', roles: ['super_admin', 'admin', 'accountant'], category: 'Data & Records' },
  { id: 'WeightManifest', label: 'Weight Manifest', roles: ['super_admin', 'admin', 'cargo_agent', 'office_work'], category: 'Data & Records' },
  { id: 'DataImport', label: 'Import Historical Data', roles: ['super_admin', 'admin'], category: 'Data & Records' },
  { id: 'AirlineLogos', label: 'Airline Logos', roles: ['super_admin', 'admin'], category: 'Administration' },
  { id: 'More:PricingConfiguration', label: 'Pricing & Rates Configuration', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:HubCargoRates', label: 'Hub Cargo Rates', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:ExcessBaggageAirlines', label: 'Excess Baggage Airlines', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:ContentTypes', label: 'Content Types', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:SpecialGoodsRates', label: 'Special Goods Rates', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:MinimumCharges', label: 'Minimum Charges', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:FlatTierRates', label: 'Flat Tier Rates', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:ExpenseCategories', label: 'Expense Categories', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:Banks', label: 'Banks', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:Settings', label: 'Platform Settings', roles: ['super_admin'], category: 'Administration' },
  { id: 'More:StaffManagement', label: 'Staff Management', roles: ['super_admin', 'admin'], category: 'Support & Account' },
  { id: 'More:SupportTickets', label: 'Help Desk & Issue Resolution', roles: MORE_TAB_ROLES, category: 'Support & Account' },
];

// Fixed display order for groupViewDefs -- an explicit list rather than
// discovery order so the checklist doesn't reshuffle every time a new
// category's first entry happens to get added to STATIC_VIEWS.
const CATEGORY_ORDER = ['Main Navigation', 'Daily Operations', 'Finance', 'Intelligence', 'Fleet & Logistics', 'Data & Records', 'Administration', 'Support & Account'];

// Buckets a flat view list into the same sections More.tsx's own menu uses,
// for StaffManagement's view-access checklist -- otherwise ~45 checkboxes
// (11 nav tabs + 22 More sub-screens + one per configured baggage airline)
// render as one undifferentiated grid, which is unusable at a glance.
export function groupViewDefs(views: ViewDef[]): { category: string; views: ViewDef[] }[] {
  const byCategory = new Map<string, ViewDef[]>();
  for (const v of views) {
    const cat = v.category || 'Main Navigation';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(v);
  }
  return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({ category: c, views: byCategory.get(c)! }));
}

// One synthetic view per active configured excess-baggage airline --
// baggage_agent gets only their assigned one, super_admin/admin get all
// (mirrors the SideNav.tsx BAGGAGE_MARKER expansion this replaces).
export function getBaggageViews(role: UserRole, assignedAirline: string | undefined, airlines: ExcessBaggageAirline[]): ViewDef[] {
  if (role === 'baggage_agent') {
    return assignedAirline ? [{ id: `Baggage:${assignedAirline}` as TabView, label: `${assignedAirline} POS`, roles: ['baggage_agent'], category: 'Daily Operations' }] : [];
  }
  if (role === 'super_admin' || role === 'admin') {
    return airlines.map((a) => ({ id: `Baggage:${a.name}` as TabView, label: `${a.name} POS`, roles: [role], category: 'Daily Operations' }));
  }
  return [];
}

// Every view that exists, for a given user's context -- used to render a
// "pick which views this person can see" checklist (StaffManagement's
// view-access editor), independent of what that user's role would
// normally default to.
export function getAllViewDefs(airlines: ExcessBaggageAirline[]): ViewDef[] {
  const allAirlineViews = airlines.map((a) => ({ id: `Baggage:${a.name}` as TabView, label: `${a.name} POS`, roles: ['super_admin', 'admin'] as UserRole[], category: 'Daily Operations' }));
  return [...STATIC_VIEWS, ...allAirlineViews];
}

// The role-derived default view list -- what a user falls back to with no
// override set.
export function getRoleDefaultTabs(user: Pick<User, 'role' | 'assigned_airline'>, airlines: ExcessBaggageAirline[]): TabView[] {
  const staticIds = STATIC_VIEWS.filter((v) => v.roles.includes(user.role)).map((v) => v.id);
  const baggageIds = getBaggageViews(user.role, user.assigned_airline, airlines).map((v) => v.id);
  return [...staticIds, ...baggageIds];
}

// The actual, final list of views this user can access right now: their
// explicit override if a super_admin has set one (replaces the role
// default entirely -- not additive), otherwise the normal role-derived
// default. `null`/`undefined` means no override; an explicit `[]` is a
// deliberate "this person has no views" and is respected as-is (they can
// still sign out via the header/sidenav's sign-out control, which isn't
// gated by this list).
export function getAllowedTabs(user: Pick<User, 'role' | 'assigned_airline' | 'view_overrides'>, airlines: ExcessBaggageAirline[]): TabView[] {
  if (user.view_overrides != null) {
    return user.view_overrides as TabView[];
  }
  return getRoleDefaultTabs(user, airlines);
}

export function canAccessTab(user: Pick<User, 'role' | 'assigned_airline' | 'view_overrides'>, tab: string, airlines: ExcessBaggageAirline[]): boolean {
  return getAllowedTabs(user, airlines).includes(tab as TabView);
}
