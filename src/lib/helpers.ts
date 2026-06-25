import { PRICING } from './constants';
import { Transaction, PaymentMode } from './types';

export const fmt = (amount: number) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(amount).replace('NGN', '₦');
};

export const generatePaymentNarration = (hubCode: string, serial: string | number): string => {
  const code = (hubCode || 'XXX').toUpperCase().substring(0, 3).padEnd(3, 'X');
  const d = new Date();
  const yymmdd = [
    d.getFullYear().toString().slice(2),
    (d.getMonth() + 1).toString().padStart(2, '0'),
    d.getDate().toString().padStart(2, '0')
  ].join('');
  const ser = serial.toString().padStart(3, '0');
  return `EHI-${code}-${yymmdd}-${ser}`;
};

export const extractNarrationFromText = (text: string): string | null => {
  const match = text.match(/EHI-[A-Z]{2,4}-\d{6}-\d{3,4}/i);
  return match ? match[0].toUpperCase() : null;
};

export const uid = (prefix: 'WB' | 'VJ' | 'AC' | 'MK' | 'CG' | 'TR'): string => {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const randomHex = Math.floor(Math.random() * 65536).toString(16).toUpperCase().padStart(4, '0');
  return `${prefix}-${dateStr}-${randomHex}`;
};

export const tnow = (): string => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
};

export function generatePickupPin(): string {
  return String(Math.floor(10000 + Math.random() * 90000));
}
