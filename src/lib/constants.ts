import { Transaction, UserRole, HubType } from './types';

export const PRICING: Record<string, { BB: number; MB: number; SB: number }> = {
  'LOS/Lagos':  { BB: 30000, MB: 18000, SB: 22000 },
  'ABV/Abuja':  { BB: 40000, MB: 25000, SB: 28000 },
  'PHC/Port Harcourt': { BB: 35000, MB: 20000, SB: 25000 },
  'KAN/Kano':   { BB: 42000, MB: 27000, SB: 30000 },
  'ENU/Enugu':  { BB: 28000, MB: 16000, SB: 20000 },
  'ABB/Asaba':  { BB: 25000, MB: 14000, SB: 18000 },
  'AKR/Akure':  { BB: 25000, MB: 14000, SB: 18000 },
  'BCU/Bauchi': { BB: 25000, MB: 14000, SB: 18000 },
  'BNI/Benin City':  { BB: 30000, MB: 18000, SB: 22000 },
  'CBQ/Calabar': { BB: 25000, MB: 14000, SB: 18000 },
  'GMO/Gombe':  { BB: 25000, MB: 14000, SB: 18000 },
  'IBA/Ibadan': { BB: 25000, MB: 14000, SB: 18000 },
  'ILR/Ilorin': { BB: 25000, MB: 14000, SB: 18000 },
  'KAD/Kaduna': { BB: 38000, MB: 22000, SB: 26000 },
  'MIU/Maiduguri': { BB: 25000, MB: 14000, SB: 18000 },
  'QOW/Owerri': { BB: 27000, MB: 15000, SB: 19000 },
  'QUO/Uyo':    { BB: 25000, MB: 14000, SB: 18000 },
  'QRW/Warri (Osubi Airstrip)':  { BB: 26000, MB: 15000, SB: 19000 },
  'YOL/Yola':   { BB: 25000, MB: 14000, SB: 18000 },
  'Other': { BB: 30000, MB: 18000, SB: 21000 },
};

export const AIRLINES = [
  { code: 'AK',  name: 'Arik Air' },
  { code: 'GA',  name: 'Green Africa Airways' },
  { code: 'UN',  name: 'United Nigeria Airlines' },
] as const;

export const CORPORATE_CLIENTS = ['Aramex', 'SAHCO', 'GlobaCom', 'ZeemMax', 'EHI', 'Salco', 'Slot', 'Prosper', 'Evergreen', 'Wellcare', 'Other'] as const;

export const CARGO_ROUTES = [
  'LOS/Lagos',
  'ABV/Abuja',
  'PHC/Port Harcourt',
  'KAN/Kano',
  'ENU/Enugu',
  'ABB/Asaba',
  'AKR/Akure',
  'BCU/Bauchi',
  'BNI/Benin City',
  'CBQ/Calabar',
  'GMO/Gombe',
  'IBA/Ibadan',
  'ILR/Ilorin',
  'KAD/Kaduna',
  'MIU/Maiduguri',
  'QOW/Owerri',
  'QUO/Uyo',
  'QRW/Warri (Osubi Airstrip)',
  'YOL/Yola',
  'Other'
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
