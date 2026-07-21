import { CustomerWallet } from './types';

// Canonical Nigerian phone: digits only, +234/234 → 0-prefixed local form.
// Used as the wallet identity key everywhere (name is only a display label).
export function normalizePhone(raw?: string | null): string {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('234')) d = '0' + d.slice(3);
  else if (d.length === 10 && !d.startsWith('0')) d = '0' + d;
  return d;
}

// Find a customer's active wallet: PHONE first (reliable), then exact name
// (fallback for older phone-less wallets). Only returns wallets with credit.
export function matchWallet(
  wallets: CustomerWallet[],
  name?: string | null,
  phone?: string | null,
): CustomerWallet | null {
  const p = normalizePhone(phone);
  if (p) {
    const byPhone = wallets.find(w => normalizePhone((w as any).customer_phone) === p && w.balance > 0);
    if (byPhone) return byPhone;
  }
  const n = (name || '').trim().toLowerCase();
  if (n.length >= 2) {
    const byName = wallets.find(w => w.customer_name.trim().toLowerCase() === n && w.balance > 0);
    if (byName) return byName;
  }
  return null;
}
