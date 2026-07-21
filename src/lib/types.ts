export interface ProofOfDelivery {
  id:                string;
  awbNumber:         string;
  consigneeName:     string;
  deliveredBy:       string;        // EHI staff member
  receivedByName:    string;        // person who received
  receivedByPhone?:  string;
  receivedByIdType?: 'NIN' | 'Driving License' | 'Voter Card' | 'Staff ID';
  receivedByIdNumber?: string;
  signatureData:     string;        // base64 PNG of signature
  photoData?:        string;        // base64 JPEG of recipient/package
  deliveredAt:       string;        // ISO timestamp
  hubName:           string;
  notes?:            string;
  gpsLatitude?:      number;
  gpsLongitude?:     number;
}

// Matches the live hubs.type CHECK constraint exactly (see
// supabase/migrations/20260706_full_schema.sql's hubs table comment) --
// this table predates that migration file's CREATE TABLE IF NOT EXISTS, so
// that file's own CHECK clause text doesn't reflect the real constraint.
export type HubType = 'Cargo Station' | 'Head Office' | 'Field Office';

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'cargo_agent'
  | 'baggage_agent'
  | 'marketing_agent'
  | 'driver'
  | 'accountant'
  | 'auditor'
  | 'office_work';

export interface User {
  id?: string;
  email: string;
  name: string;
  role: UserRole;
  hubType: HubType;
  hub: string;
  hub_code?: string;
  hub_id?: string;
  active?: boolean;
  can_print_ledger?: boolean;   // Super admin grants this per user
  can_edit_remarks?: boolean;   // Super admin grants this per user to edit cargo remarks
  // Which excess_baggage_airlines.name this user tickets for -- only
  // meaningful when role === 'baggage_agent'.
  assigned_airline?: string;
  // Super-admin-set exact list of TabView ids this user can access,
  // replacing their role-derived default entirely. undefined/null means
  // "no override -- use the normal role-based access" (see
  // src/lib/permissions.ts, the single source of truth for both paths).
  view_overrides?: string[] | null;
}

// One row per excess-baggage carrier (ValueJet, and any airline added
// after it) -- configured in the Excess Baggage Airlines admin screen,
// no code change needed to onboard a new one.
export interface ExcessBaggageAirline {
  id: string;
  name: string;
  flight_prefix: string;
  tag_code: string;
  free_allowance_kg: number;
  rate_per_kg: number;
  active: boolean;
}

export type PaymentMode = 'Cash' | 'POS' | 'Transfer' | 'Debt' | 'Debt Paid' | 'Wallet';

export type ShipmentType = 'marketing' | 'cargo';

export type ContentType =
  | 'Medical'
  | 'Clothes & Shoes'
  | 'Documents'
  | 'Chairs/Furniture'
  | 'Tyres'
  | 'Phones/Electronics'
  | 'Cosmetics'
  | 'Package/Parcel'
  | 'Baby Items'
  | 'SIM Cards'
  | 'Clearance'
  | 'Courier'
  | 'Other';

export type ScanMode = 'ARRIVE' | 'DEPART' | 'DELIVER';

export type ScanResultType =
  | 'SUCCESS_ARRIVE'
  | 'SUCCESS_DEPART'
  | 'SUCCESS_DELIVER'
  | 'WRONG_DESTINATION'
  | 'NOT_LOGGED_IN'
  | 'ALREADY_PROCESSED'
  | 'NOT_FOUND'
  | 'ERROR';

export interface ScanValidationResult {
  type: ScanResultType;
  cargo?: {
    ref: string;
    name: string;
    destination: string;
    awb: string;
    content: string;
    pieces?: number;
    kg?: number;
    pickupPin?: string | null;
  };
  lastEvent?: {
    type: string;
    hub: string;
    time: string;
    by: string;
  };
  previousHub?: string;
  currentHub: string;
  message?: string;
}

export interface TrackingEvent {
  id: string;
  cargo_ref: string;
  event_type: 'ARRIVE' | 'DEPART' | 'DELIVER' | 'WRONG_DESTINATION_ALERT';
  hub_name: string;
  hub_id?: string;
  scanned_by_name: string;
  notes?: string;
  cargo_destination?: string;
  alert_reason?: string;
  previous_hub?: string;
  resolved?: boolean;
  resolved_by?: string;
  resolved_at?: string;
  created_at: string;
}

export interface BatchScanItem {
  ref: string;
  name: string;
  result: ScanResultType;
  time: string;
}

export interface CargoEntry {
  id: string;
  entry_ref: string;
  serial_number: number;
  entry_date: string;
  airline_code: 'AK' | 'GA' | 'UN' | 'OTHER';
  consignee_name: string;
  consignee_id?: string;
  awb_tag_number: string;
  total_pcs: number;
  total_kg: number;
  route: string;
  content_type: ContentType;
  amount: number;
  receipt_mode: 'Cash' | 'Transfer' | 'Debt';
  bank_name?: string;
  remark?: string;
  sales_analysis?: string;
  hub_id?: string;
  logged_by?: string;
  created_at: string;
}

export interface Transaction {
  id: string;
  name: string;
  detail: string;
  amount: number;
  mode: PaymentMode | string;
  time: string;
  created_at?: string;
  type: 'cargo' | 'baggage' | 'marketing' | 'package';
  status: 'Intake' | 'Departure' | 'In-Transit' | 'Arrived' | 'Delivered' | 'Pending' | 'Received' | 'Dispatched' | 'Cancelled';
  isPending?: boolean;
  route?: string;
  bank?: string;
  hub_id?: string;
  hub?: string;
  // Which physical Lagos counter logged this (Cargo/Package only) -- GAT is
  // a second desk on the same LOS hub, not a separate hub. Undefined/absent
  // for every other hub and for baggage/marketing entries.
  terminal?: 'MMA2' | 'GAT';
  enteredByName?: string;
  editedBy?: string;
  editedAt?: string;
  debtClearedBy?: string;
  // Cargo specifics
  awb_tag_number?: string;
  airline?: string;
  // Commission % locked in at entry time -- must not be recomputed later
  // against a since-changed pricing_config rate (that would silently
  // rewrite historical airline payables).
  commissionRate?: number;
  consignee?: string;
  corporate_client_id?: string;
  applied_rate_per_kg?: number;
  pieces?: number;
  kg?: number;
  pickupPin?: string;
  contentType?: string;
  // Package/Parcel specifics -- distinct from contentType, which for this
  // stream holds the 'Package'/'Parcel' service class, not what's inside.
  contents?: string;
  remarks?: string;
  // Excess-baggage specifics (ValueJet and any other configured airline)
  destination?: string;
  excessKg?: number;
  totalKg?: number;
  flight?: string;
  pnr?: string;           // Passenger Name Record / booking reference
  // Payment Validation
  paymentConfirmed?: boolean;
  confirmedAt?: string;
  bankReference?: string;
  bankSender?: string;
  bankAlertText?: string;
  bankAlertSnippet?: string;
  paymentNarration?: string;
  confirmedBy?: string;
  posApprovalCode?: string;
  // Package Desk specifics -- lightweight debt tracking (no registered
  // client required, matching the paper ledger's free-text debtor names)
  debtPaid?: boolean;
  debtPaidAt?: string;
  // Partial debt repayment tracking (cargo/VJ/marketing debts)
  amountPaid?: number;
  paymentHistory?: { amount: number; mode: 'Cash' | 'Transfer'; by: string; at: string }[];
  clientType?: 'Corporate' | 'Individual' | 'Office Work';
  raw?: any;
  // Retail cargo debtor contact, for following up on an individual (not
  // corporate-monthly) debt -- captured at entry, optional.
  consigneePhone?: string;

  // ── Tag Retrieval (edit-in-place) ──────────────────────────────────────
  // When a cargo is retrieved (flight cancelled / airline change), the
  // original entry is updated in-place and these fields are populated.
  retrieved?: boolean;
  retrievalNote?: string;   // structured: "Retrieved by X at T. Was: Arik ₦12k → Now: United ₦11.5k"
  retrievedAt?: string;     // ISO timestamp
  retrievedBy?: string;     // staff name

  // ── Debt Clearance (shadow ledger event) ───────────────────────────────
  // A synthetic entry created when a prior-debt payment is recorded via
  // DebtorsTab so it appears as a visible row in today's ledger and EOD.
  is_debt_clearance?: boolean;
  related_tx_id?: string;   // id of the original debt transaction

  // ── Office Work Linking ────────────────────────────────────────────────
  // Set when a retail-form entry is linked to a registered corporate client,
  // either at point of entry (banner detection) or via reclassification.
  linked_as_office_work?: boolean;
  reclassification_note?: string;
  reclassification_by?: string;
  reclassification_at?: string;
  original_amount?: number; // retail amount before office-rate correction

  // ── Customer Wallet Payment ────────────────────────────────────────────
  wallet_id?: string;               // UUID of the CustomerWallet used
  wallet_deduction_amount?: number; // portion of this entry paid from wallet
}

export interface ParsedBankAlert {
  bankName: string;
  amount: number;
  senderName: string;
  reference: string;
  dateString: string;
  parsedDate: string;
  rawText: string;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  narrationCode?: string;
}

export interface PaymentMatch {
  transaction: Transaction;
  alert: ParsedBankAlert;
  matchScore: number;
  matchReasons: string[];
  status: 'confirmed' | 'pending' | 'rejected';
}

export interface Expense {
  id: string;
  type: string;
  amount: number;
  description: string;
  time: string;
  created_at?: string;
  hub_id?: string;
  status?: 'pending' | 'approved' | 'rejected';
  mode?: string;
  bank?: string;
  posApprovalCode?: string;
  logged_by?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
}

// `Baggage:${tag_code}` tabs are generated dynamically, one per active row
// in excess_baggage_airlines (e.g. 'Baggage:VJ') -- no fixed list here.
// `More:${sub_screen}` are synthetic ids for the sub-screens nested inside
// the More menu (Bank Reconciliation, Pricing Configuration, Staff
// Management, etc.) that have no top-level route of their own -- giving
// them TabView ids lets the same view_overrides permission system used for
// top-level tabs also cover them, instead of those screens being gated by
// hardcoded role checks nobody but a code change could ever customize.
export type TabView = 'Tower' | 'Cargo' | `Baggage:${string}` | `More:${string}` | 'Marketing' | 'Packages' | 'Scan' | 'Incoming' | 'IncomingToHub' | 'OutboundArrivals' | 'More' | 'MyTrips' | 'IT Debug' | 'Credit & Debit' | 'AirlineLogos' | 'DataImport' | 'AirlineLedger' | 'WeightManifest' | 'AirlinePerformance' | 'GAT';

export interface AppState {
  user: User | null;
  transactions: Transaction[];
  expenses: Expense[];
  isOffline: boolean;
  pendingSyncCount: number;
  currentTab: TabView;
}

export interface TripPing {
  id: string;
  tripId: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  speed?: number;
  accuracy?: number;
}

export interface DriverTrip {
  id: string;
  vehiclePlate: string;
  driverName: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime?: string;
  status: 'Active' | 'Completed' | 'Cancelled';
  cargoRefs: string[];   // AWB numbers on this vehicle
  notes?: string;
  createdAt: string;
  gpsTrackingEnabled?: boolean;
  lastPingAt?: string;
  lastLatitude?: number;
  lastLongitude?: number;
  lastSpeed?: number;
}

// Daily Cash Register
export interface CashRegister {
  id: string;
  date: string;                        // YYYY-MM-DD
  hub: string;
  openingBalance: number;              // cash carried from previous day close
  closingBalance?: number;             // filled at EOD
  physicalCount?: number;              // actual cash counted at close
  variance?: number;                   // physicalCount - closingBalance
  lockedBy?: string;                   // user who locked the day
  lockedAt?: string;
  status: 'open' | 'locked';
}

// Cash Register Entry (individual movements within a day)
export interface CashMovement {
  id: string;
  registerId: string;
  type: 'receipt' | 'payment';
  source: 'cargo' | 'valuejet' | 'marketing' | 'expense' | 'remittance' | 'adjustment';
  transactionRef?: string;             // links to Transaction.id if from a sale
  amount: number;
  description: string;
  time: string;
  loggedBy: string;
}

// Debt / Accounts Receivable entry with aging
export interface DebtRecord {
  id: string;
  transactionId: string;              // links to Transaction.id
  clientName: string;
  clientType: 'corporate' | 'individual';
  amount: number;
  amountPaid: number;                 // starts at 0, updated on partial payment
  balance: number;                    // amount - amountPaid
  dueDate: string;                    // ISO date
  dateCreated: string;                // ISO date
  ageInDays: number;                  // computed: today - dateCreated
  agingBucket: 'current' | 'overdue' | 'critical' | 'writeoff-risk';
  status: 'outstanding' | 'partial' | 'paid' | 'written-off';
  notes: string;
  payments: DebtPayment[];
}

export interface DebtPayment {
  id: string;
  date: string;
  amount: number;
  mode: 'Cash' | 'Transfer';
  bank?: string;
  recordedBy: string;
  reference?: string;
}

// Expense with budget tracking
export interface ExpenseEntry {
  id: string;
  category: string;
  subcategory?: string;
  amount: number;
  description: string;
  date: string;
  time: string;
  hub: string;
  loggedBy: string;
  approvedBy?: string;
  status: 'pending' | 'approved' | 'rejected';
  receiptRef?: string;
  requiresApproval: boolean;          // true if amount > 20000
}

export interface ExpenseBudget {
  category: string;
  monthlyBudget: number;
  spent: number;
  remaining: number;
  percentUsed: number;
}

// Hub remittance
export interface HubRemittance {
  id: string;
  fromHub: string;
  toHub: string;                      // usually 'Lagos HQ'
  date: string;
  totalCollected: number;
  totalExpenses: number;
  netRemittance: number;              // totalCollected - totalExpenses
  mode: 'Cash' | 'Transfer';
  bank?: string;
  reference?: string;
  confirmedByHQ: boolean;
  confirmedAt?: string;
  notes?: string;
}

// Agent commission record
export interface AgentCommission {
  agentId: string;
  agentName: string;
  role: string;
  hub: string;
  period: string;                     // e.g., '2026-06'
  totalSales: number;
  cashSales: number;
  transferSales: number;
  debtCreated: number;
  commissionRate: number;             // e.g., 0.02 for 2%
  commissionEarned: number;
  commissionPaid: boolean;
  paidDate?: string;
}

// VAT record
export interface VATRecord {
  period: string;                     // e.g., '2026-06'
  totalRevenue: number;
  vatRate: number;                    // 0.075 for 7.5%
  outputVAT: number;                  // totalRevenue * vatRate
  filingStatus: 'pending' | 'filed' | 'paid';
  filingDate?: string;
}

// Accounting period lock
export interface PeriodLock {
  period: string;                     // YYYY-MM-DD (day) or YYYY-MM (month)
  lockedBy: string;
  lockedAt: string;
  type: 'day' | 'month';
}

// ── Customer Credit Wallet ──────────────────────────────────────────────────
// Holds money EHI owes back to a customer (e.g. a cargo retrieval refund
// the customer chose to leave as credit for future consignments).
// One wallet per customer — top-ups add to the same record's balance.
// Purely internal: no customer-facing portal or SMS balance alerts.
export interface CustomerWallet {
  id: string;
  hub_id?: string;
  customer_name: string;
  customer_phone?: string;
  opening_balance: number;      // amount at wallet creation
  balance: number;              // current remaining balance
  total_topped_up: number;      // all-time sum of all top-ups
  total_used: number;           // all-time sum of all deductions
  source_type: 'airline_retrieval' | 'advance_deposit' | 'refund' | 'manual_credit';
  source_ref?: string;          // e.g. original AWB of the retrieval
  source_note?: string;         // free text description of origin
  status: 'active' | 'exhausted' | 'frozen';
  created_by: string;
  created_at: string;
  updated_at: string;
}

// One row per debit or credit to a wallet — the full audit trail.
export interface WalletTransaction {
  id: string;
  wallet_id: string;
  hub_id?: string;
  type: 'top_up' | 'deduction' | 'refund' | 'adjustment';
  amount: number;               // always positive
  balance_before: number;       // snapshot before this transaction
  balance_after: number;        // snapshot after this transaction
  cargo_ref?: string;           // AWB of the cargo entry this deduction paid for
  cargo_entry_id?: string;
  description?: string;
  logged_by: string;
  created_at: string;
}

// One shift lifecycle per hub PER DEPARTMENT -- Cargo, Package, Marketing,
// Baggage, and GAT each Start/End Day independently, all still shared by
// every user working that department at that hub (hub_shifts has no
// per-user scoping). 'all' is the pre-existing hub-wide shift used by the
// unfiltered Master Ledger (More -> Ledger), kept as its own independent
// lifecycle rather than merged with the five department ones.
export type ShiftDepartment = 'cargo' | 'package' | 'marketing' | 'baggage' | 'gat' | 'all';

export interface HubShift {
  id: string;
  hub_id: string;
  department: ShiftDepartment;
  started_at: string;
  ended_at?: string;
  status: 'open' | 'closed';
  sales_summary?: any;
  opened_by: string;
  closed_by?: string;
  created_at: string;
}
