import { PRICING, SEED_TRANSACTIONS } from './constants';
import { Transaction, PaymentMode } from './types';

export const fmt = (amount: number) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(amount).replace('NGN', '₦');
};

export const uid = (prefix: 'WB' | 'VJ' | 'AC' | 'MK' | 'CG'): string => {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const randomHex = Math.floor(Math.random() * 65536).toString(16).toUpperCase().padStart(4, '0');
  return `${prefix}-${dateStr}-${randomHex}`;
};

export const tnow = (): string => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
};

const DUMMY_NAMES = ['Mr. Alabi', 'Grace M.', 'Chief Okon', 'Ibrahim Y.', 'Uzor Goods', 'TechHub Ltd'];

export const randCargo = (): Transaction => {
  const consignees = ['Aramex', 'SAHCO', 'Slot', 'GlobaCom', 'ZeemMax', 'Salco'];
  const contents = ['Medical', 'Documents', 'Clothes & Shoes', 'Phones/Electronics', 'Courier'];
  const routes = ['ABV', 'PHC', 'BNI', 'KAN', 'Asaba'];
  const airlines = ['AK', 'GA', 'UN'];

  return {
    id: uid('CG'),
    name: consignees[Math.floor(Math.random() * consignees.length)],
    detail: `${airlines[Math.floor(Math.random() * airlines.length)]} · ${Math.floor(Math.random() * 90 + 10)}kg · ${contents[Math.floor(Math.random() * contents.length)]}`,
    amount: Math.round((Math.random() * 200000 + 50000) / 1000) * 1000,
    mode: ['Cash', 'Transfer', 'Transfer'][Math.floor(Math.random() * 3)],
    time: tnow(),
    type: 'cargo',
    status: 'Intake'
  };
};

export const randMarketingEntry = (): Transaction => {
  const names = ['Madam Uchechi', 'Alhaji Sule', 'Mrs. Nneka', 'Swift Cargo', 'Bright Movers'];
  const routes = Object.keys(PRICING);
  const route = routes[Math.floor(Math.random() * routes.length)];
  const rates = PRICING[route];
  const bb = Math.floor(Math.random() * 3);
  const sb = Math.floor(Math.random() * 2);
  const amount = (bb || 1) * rates.BB + sb * rates.SB;

  return {
    id: uid('MK'),
    name: names[Math.floor(Math.random() * names.length)],
    detail: `${route} · ${bb > 0 ? bb + 'BB' : ''} ${sb > 0 ? sb + 'SB' : ''}`.trim(),
    amount,
    mode: ['Cash', 'Transfer'][Math.floor(Math.random() * 2)],
    time: tnow(),
    type: 'marketing',
    status: 'Intake'
  };
};

export const randBaggage = (): Transaction => {
  const kg = Math.floor(Math.random() * 15) + 1;
  return {
    id: uid('VJ'),
    name: DUMMY_NAMES[Math.floor(Math.random() * DUMMY_NAMES.length)],
    detail: `VQ-${Math.floor(Math.random() * 800 + 100)} · +${kg}kg`,
    amount: kg * 5000,
    mode: ['Cash', 'Transfer', 'POS'][Math.floor(Math.random() * 3)] as PaymentMode,
    time: tnow(),
    type: 'baggage',
    status: 'Delivered'
  };
};
