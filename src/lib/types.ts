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

export type HubType = 'Cargo Station' | 'Head Office';

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'cargo_agent'
  | 'vj_agent'
  | 'marketing_agent'
  | 'driver'
  | 'accountant'
  | 'auditor';

export interface User {
  id?: string;
  email: string;
  name: string;
  role: UserRole;
  hubType: HubType;
  hub: string;
  active?: boolean;
}

export type PaymentMode = 'Cash' | 'POS' | 'Transfer' | 'Debt' | 'Debt Paid';

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
  };
  lastEvent?: {
    type: string;
    hub: string;
    time: string;
    by: string;
  };
  currentHub: string;
  message?: string;
}

export interface TrackingEvent {
  id: string;
  cargo_ref: string;
  event_type: 'ARRIVE' | 'DEPART' | 'WRONG_DESTINATION_ALERT';
  hub_name: string;
  scanned_by_name: string;
  notes?: string;
  cargo_destination?: string;
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
  type: 'cargo' | 'baggage' | 'marketing';
  status: 'Intake' | 'Departure' | 'In-Transit' | 'Arrived' | 'Delivered' | 'Pending' | 'Received' | 'Dispatched';
  isPending?: boolean;
  route?: string;
  bank?: string;
  // Cargo specifics
  awb_tag_number?: string;
  consignee?: string;
  pieces?: number;
  kg?: number;
  contentType?: string;
  remarks?: string;
}

export interface Expense {
  id: string;
  type: string;
  amount: number;
  description: string;
  time: string;
  status?: 'pending' | 'approved' | 'rejected';
  mode?: string;
}

export type TabView = 'Tower' | 'Cargo' | 'VJ POS' | 'Marketing' | 'Scan' | 'More' | 'MyTrips' | 'IT Debug';

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
