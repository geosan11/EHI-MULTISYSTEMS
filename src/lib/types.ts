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
}

export type TabView = 'Tower' | 'Cargo' | 'VJ POS' | 'Marketing' | 'Scan' | 'More' | 'MyTrips' | 'Accounting';

export interface AppState {
  user: User | null;
  transactions: Transaction[];
  expenses: Expense[];
  isOffline: boolean;
  pendingSyncCount: number;
  currentTab: TabView;
}
