import { Transaction, UserRole, HubType } from './types';

export const PRICING: Record<string, { BB: number; MB: number; SB: number }> = {
  Benin:  { BB: 30000, MB: 18000, SB: 22000 },
  PHC:    { BB: 35000, MB: 20000, SB: 25000 },
  Abuja:  { BB: 40000, MB: 25000, SB: 28000 },
  Jos:    { BB: 32000, MB: 18000, SB: 22000 },
  Kano:   { BB: 42000, MB: 27000, SB: 30000 },
  Enugu:  { BB: 28000, MB: 16000, SB: 20000 },
  Warri:  { BB: 26000, MB: 15000, SB: 19000 },
  Asaba:  { BB: 25000, MB: 14000, SB: 18000 },
  Kaduna: { BB: 38000, MB: 22000, SB: 26000 },
  Onitsha:{ BB: 27000, MB: 15000, SB: 19000 },
  Makurdi:{ BB: 30000, MB: 18000, SB: 21000 },
};

export const AIRLINES = [
  { code: 'AK',  name: 'Arik Air' },
  { code: 'GA',  name: 'Green Africa Airways' },
  { code: 'UN',  name: 'United Nigeria Airlines' },
] as const;

export const CORPORATE_CLIENTS = ['Aramex', 'SAHCO', 'GlobaCom', 'ZeemMax', 'EHI', 'Salco', 'Slot', 'Prosper', 'Evergreen', 'Wellcare', 'Other'] as const;

export const CARGO_ROUTES = [
  'ABV/Abuja', 'PHC/Port Harcourt', 'BNI/Benin', 'KAN/Kano',
  'Asaba', 'Enugu', 'Warri', 'Owerri', 'Lagos', 'Kaduna',
  'Makurdi', 'Other'
];

export const CONTENT_TYPES = [
  'Medical',
  'Clothes & Shoes',
  'Documents',
  'Chairs/Furniture',
  'Tyres',
  'Phones/Electronics',
  'Cosmetics',
  'Package/Parcel',
  'Baby Items',
  'SIM Cards',
  'Clearance',
  'Courier',
  'Other'
] as const;

export const EXPENSE_CATEGORIES = [
  'Cars',
  'Carrier',
  'Transport',
  'Bus Hire',
  'Sack & Nylon',
  'Miscellaneous',
] as const;

export const PAYMENT_MODES = ['Cash', 'POS', 'Transfer', 'Debt'] as const;
export const BANKS = ['UBA', 'GTBank', 'Access', 'Zenith', 'First Bank', 'Polaris', 'Keystone', 'Fidelity', 'Sterling', 'Other'] as const;

export const ALL_STATUSES = ['Intake', 'Departure', 'In-Transit', 'Arrived', 'Delivered', 'Pending', 'Received', 'Dispatched'] as const;
