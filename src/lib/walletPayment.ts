import { applyWalletTransaction } from './wallet';
import { CustomerWallet } from './types';

export interface WalletChargeResult {
  ok: boolean;
  walletDeduction: number;   // amount actually taken from the wallet
  remainder: number;         // amount still to be collected by another method
  newBalance?: number;
  error?: string;
}

// Deduct as much of `amount` as the wallet holds, atomically. Never deducts
// more than the balance; the caller records `remainder` under the chosen
// Cash/Transfer/POS receipt_mode so EOD nets it correctly.
export async function chargeWalletForSale(params: {
  wallet: Pick<CustomerWallet, 'id' | 'balance' | 'customer_name'>;
  amount: number;
  cargoRef: string;
  description: string;
  loggedBy: string;
}): Promise<WalletChargeResult> {
  const deduct = Math.min(params.amount, params.wallet.balance);
  const remainder = Math.max(0, params.amount - deduct);
  if (deduct <= 0) {
    return { ok: true, walletDeduction: 0, remainder, newBalance: params.wallet.balance };
  }
  const res = await applyWalletTransaction({
    walletId: params.wallet.id,
    type: 'deduction',
    amount: deduct,
    cargoRef: params.cargoRef,
    description: params.description,
    loggedBy: params.loggedBy,
  });
  if (!res.ok) return { ok: false, walletDeduction: 0, remainder, error: res.error };
  return { ok: true, walletDeduction: deduct, remainder, newBalance: res.newBalance };
}
