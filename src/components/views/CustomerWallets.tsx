import { useState, useEffect, useCallback } from 'react';
import { User } from '../../lib/types';
import { fmt, tnow } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';
import { applyWalletTransaction } from '../../lib/wallet';
import { useToast } from '../../lib/ToastContext';
import { BackButton } from '../BackButton';
import { openPdfOrDownload } from '../../lib/helpers';
import {
  Wallet,
  Plus,
  Search,
  History,
  ArrowUpRight,
  ArrowDownLeft,
  Printer,
  X,
  Loader2,
  AlertCircle,
  TrendingUp,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';

export interface CustomerWallet {
  id: string;
  hub_id?: string;
  customer_name: string;
  customer_phone?: string;
  opening_balance: number;
  balance: number;
  total_topped_up: number;
  total_used: number;
  source_type: 'airline_retrieval' | 'advance_deposit' | 'refund' | 'manual_credit';
  source_ref?: string;
  source_note?: string;
  status: 'active' | 'exhausted' | 'frozen';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  hub_id?: string;
  type: 'top_up' | 'deduction' | 'refund' | 'adjustment';
  amount: number;
  balance_before: number;
  balance_after: number;
  cargo_ref?: string;
  description?: string;
  logged_by: string;
  created_at: string;
}

export const CustomerWallets = ({
  user,
  onBack,
  initialCustomerName,
  initialAmount,
  initialRef,
}: {
  user: User;
  onBack?: () => void;
  initialCustomerName?: string;
  initialAmount?: number;
  initialRef?: string;
}) => {
  const { showToast } = useToast();
  const [wallets, setWallets] = useState<CustomerWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialCustomerName || '');

  // Modal states
  const [showTopUpModal, setShowTopUpModal] = useState(Boolean(initialAmount));
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<CustomerWallet | null>(null);
  const [walletHistory, setWalletHistory] = useState<WalletTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Top-Up form states
  const [formName, setFormName] = useState(initialCustomerName || '');
  const [formPhone, setFormPhone] = useState('');
  const [formAmount, setFormAmount] = useState(initialAmount ? String(initialAmount) : '');
  const [formSourceType, setFormSourceType] = useState<'airline_retrieval' | 'advance_deposit' | 'refund' | 'manual_credit'>(
    initialRef ? 'airline_retrieval' : 'advance_deposit'
  );
  const [formSourceRef, setFormSourceRef] = useState(initialRef || '');
  const [formNote, setFormNote] = useState('');
  const [savingTopUp, setSavingTopUp] = useState(false);

  const [tableMissing, setTableMissing] = useState(false);

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    setTableMissing(false);
    try {
      let query = supabase
        .from('customer_wallets')
        .select('*')
        .order('updated_at', { ascending: false });

      if (user.role !== 'admin' && user.role !== 'super_admin' && user.hub_id) {
        query = query.eq('hub_id', user.hub_id);
      }

      const { data, error } = await query;
      if (error) {
        if (error.message?.includes('customer_wallets') || error.message?.includes('schema cache') || error.code === '42P01' || error.code === 'PGRST301') {
          setTableMissing(true);
          return;
        }
        throw error;
      }
      setWallets((data as CustomerWallet[]) || []);
    } catch (err: any) {
      console.error('Error fetching customer wallets:', err);
      showToast({ message: 'Failed to load customer wallets: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [user.hub_id, user.role, showToast]);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  const filteredWallets = wallets.filter(
    (w) =>
      w.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      (w.customer_phone && w.customer_phone.includes(search))
  );

  const totalLiability = wallets.reduce((acc, w) => acc + (w.balance || 0), 0);

  const handleOpenHistory = async (wallet: CustomerWallet) => {
    setSelectedWallet(wallet);
    setShowHistoryModal(true);
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('wallet_id', wallet.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWalletHistory((data as WalletTransaction[]) || []);
    } catch (err: any) {
      showToast({ message: 'Failed to load wallet history: ' + err.message, type: 'error' });
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSaveTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = formName.trim();
    const amt = parseFloat(formAmount);

    if (!name) {
      showToast({ message: 'Customer name is required', type: 'error' });
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      showToast({ message: 'Please enter a valid top-up amount', type: 'error' });
      return;
    }

    setSavingTopUp(true);
    try {
      // 1. Check if wallet already exists for this customer name (case insensitive)
      const existing = wallets.find(
        (w) => w.customer_name.trim().toLowerCase() === name.toLowerCase()
      );

      let walletId = existing?.id;

      if (existing) {
        if (formPhone.trim() && formPhone.trim() !== existing.customer_phone) {
          // Not money -- no race risk, safe to update directly alongside
          // the atomic balance top-up below.
          await supabase.from('customer_wallets').update({ customer_phone: formPhone.trim() }).eq('id', existing.id);
        }
      } else {
        // Insert new wallet at zero balance -- the actual credit happens
        // via applyWalletTransaction below so the balance and its
        // wallet_transactions audit row are always created together.
        const { data: newWallet, error: insertErr } = await supabase
          .from('customer_wallets')
          .insert({
            hub_id: user.hub_id,
            customer_name: name,
            customer_phone: formPhone.trim() || null,
            opening_balance: amt,
            balance: 0,
            total_topped_up: 0,
            total_used: 0,
            source_type: formSourceType,
            source_ref: formSourceRef.trim() || null,
            source_note: formNote.trim() || null,
            status: 'active',
            created_by: user.name,
          })
          .select('id')
          .single();

        if (insertErr) throw insertErr;
        walletId = newWallet.id;
      }

      // 2. Atomically credit the wallet + write its wallet_transactions audit row
      const result = await applyWalletTransaction({
        walletId: walletId!,
        type: 'top_up',
        amount: amt,
        cargoRef: formSourceRef.trim() || undefined,
        description: formNote.trim() || `Top-up via ${formSourceType.replace('_', ' ')}`,
        loggedBy: user.name,
      });

      if (!result.ok) throw new Error(result.error);

      showToast({ message: `Successfully topped up ₦${fmt(amt)} for ${name}!`, type: 'success' });
      setShowTopUpModal(false);
      setFormName('');
      setFormPhone('');
      setFormAmount('');
      setFormSourceRef('');
      setFormNote('');
      fetchWallets();
    } catch (err: any) {
      console.error('Wallet top up error:', err);
      showToast({ message: 'Failed to complete top-up: ' + err.message, type: 'error' });
    } finally {
      setSavingTopUp(false);
    }
  };

  const printWalletReceipt = (wallet: CustomerWallet, tx?: WalletTransaction) => {
    const html = `
      <html>
        <head>
          <title>Wallet Receipt - ${wallet.customer_name}</title>
          <style>
            body { font-family: monospace; font-size: 12px; margin: 20px; width: 300px; }
            .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
            .title { font-weight: bold; font-size: 14px; margin-bottom: 4px; }
            .row { display: flex; justify-content: space-between; margin-bottom: 4px; }
            .total { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 6px 0; font-weight: bold; font-size: 13px; margin: 10px 0; }
            .footer { text-align: center; font-size: 10px; margin-top: 15px; color: #555; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">EHI MULTISYSTEMS</div>
            <div>Customer Credit Wallet Receipt</div>
            <div>${user.hub || 'Cargo Outpost'}</div>
          </div>
          <div class="row"><span>Date:</span> <span>${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
          <div class="row"><span>Customer:</span> <span><b>${wallet.customer_name}</b></span></div>
          ${wallet.customer_phone ? `<div class="row"><span>Phone:</span> <span>${wallet.customer_phone}</span></div>` : ''}
          <div class="row"><span>Logged By:</span> <span>${user.name}</span></div>

          <div class="total">
            <div class="row"><span>Amount Added:</span> <span>₦${fmt(tx ? tx.amount : wallet.opening_balance)}</span></div>
            <div class="row"><span>Current Balance:</span> <span>₦${fmt(wallet.balance)}</span></div>
          </div>

          ${tx?.description ? `<div style="margin-bottom: 6px;"><b>Note:</b> ${tx.description}</div>` : ''}

          <div class="footer">
            Keep this receipt. Present your name at the counter during consignment to use your credit balance.
          </div>
        </body>
      </html>
    `;
    openPdfOrDownload(html, `Wallet_Receipt_${wallet.customer_name.replace(/\s+/g, '_')}.pdf`);
  };

  return (
    <div className="flex flex-col min-h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] p-4 space-y-4 font-sans select-none">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
        {onBack && <BackButton onClick={onBack} label="Back" />}
        <div className="flex items-center gap-2">
          <Wallet size={18} className="text-[var(--color-accent-amber)]" />
          <span className="text-[12px] font-mono font-bold text-[var(--color-accent-amber)] uppercase tracking-wider">
            CUSTOMER CREDIT WALLETS
          </span>
        </div>
        <button
          onClick={() => setShowTopUpModal(true)}
          className="px-3 py-1.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-mono font-bold rounded-lg flex items-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
        >
          <Plus size={14} strokeWidth={3} />
          <span>Top-Up Wallet</span>
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="p-3 bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] space-y-1">
          <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider">
            Total Customer Credit Liability
          </div>
          <div className="text-[16px] font-mono font-bold text-[var(--color-accent-amber)]">
            ₦{fmt(totalLiability)}
          </div>
          <div className="text-[8px] font-mono text-[var(--color-muted)]">
            Prepaid balance held by EHI
          </div>
        </div>

        <div className="p-3 bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] space-y-1">
          <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider">
            Active Wallets
          </div>
          <div className="text-[16px] font-mono font-bold text-[var(--color-success)]">
            {wallets.filter((w) => w.balance > 0).length} Customers
          </div>
          <div className="text-[8px] font-mono text-[var(--color-muted)]">
            Ready for instant deduction
          </div>
        </div>

        <div className="p-3 bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] space-y-1 col-span-2 md:col-span-1">
          <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider">
            All-Time Topped Up
          </div>
          <div className="text-[16px] font-mono font-bold text-[var(--color-accent-cobalt)]">
            ₦{fmt(wallets.reduce((acc, w) => acc + (w.total_topped_up || 0), 0))}
          </div>
          <div className="text-[8px] font-mono text-[var(--color-muted)]">
            Cumulative customer advance deposits
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer name or phone number..."
          className="w-full h-10 pl-9 pr-3 text-[12px] font-mono rounded-xl bg-[var(--color-surface-card)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
        />
      </div>

      {/* Database Table Missing Setup Banner */}
      {tableMissing && (
        <div className="p-4 bg-[rgba(245,158,11,0.08)] border border-[var(--color-accent-amber)] rounded-xl space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={20} className="text-[var(--color-accent-amber)] shrink-0" />
            <div>
              <div className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">
                DATABASE SETUP REQUIRED (One-Time Setup)
              </div>
              <div className="text-[11px] font-mono text-[var(--color-muted)]">
                The <code className="text-[var(--color-foreground)] bg-[var(--color-surface-2)] px-1 rounded">customer_wallets</code> table has not been created on your Supabase database yet.
              </div>
            </div>
          </div>
          <div className="text-[11px] font-mono text-[var(--color-foreground)] leading-relaxed space-y-1 bg-[var(--color-surface-2)] p-3 rounded-lg border border-[var(--color-border)]">
            <div>1. Open your <b>Supabase Dashboard</b> → <b>SQL Editor</b></div>
            <div>2. Copy and run the migration script: <code className="text-[var(--color-accent-amber)] font-bold">supabase/migrations/20260717_cargo_workflow_overhaul.sql</code></div>
            <div>3. Click "Run" in Supabase, then refresh this page.</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const sql = `CREATE TABLE IF NOT EXISTS customer_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id UUID REFERENCES hubs(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_topped_up NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_used NUMERIC(12,2) NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  source_note TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES customer_wallets(id),
  hub_id UUID REFERENCES hubs(id),
  type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance_before NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  cargo_ref TEXT,
  description TEXT,
  logged_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customer_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to customer_wallets" ON customer_wallets;
CREATE POLICY "Allow full access to customer_wallets" ON customer_wallets FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow full access to wallet_transactions" ON wallet_transactions;
CREATE POLICY "Allow full access to wallet_transactions" ON wallet_transactions FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE cargo_entries ADD COLUMN IF NOT EXISTS wallet_id UUID REFERENCES customer_wallets(id);
ALTER TABLE cargo_entries ADD COLUMN IF NOT EXISTS wallet_deduction_amount NUMERIC(12,2);

ALTER TABLE cargo_entries DROP CONSTRAINT IF EXISTS cargo_entries_receipt_mode_check;
ALTER TABLE cargo_entries ADD CONSTRAINT cargo_entries_receipt_mode_check CHECK (receipt_mode IN ('Cash', 'Transfer', 'TransferCash', 'POS', 'Debt', 'Wallet', 'Complementary'));`;
                navigator.clipboard.writeText(sql);
                showToast({ message: 'Migration SQL copied to clipboard!', type: 'success' });
              }}
              className="px-3 py-1.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-mono font-bold rounded-lg cursor-pointer hover:opacity-90"
            >
              Copy SQL Migration Query
            </button>
            <button
              onClick={fetchWallets}
              className="px-3 py-1.5 bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] text-[11px] font-mono font-bold rounded-lg cursor-pointer hover:bg-[var(--color-border)]"
            >
              Retry Connection
            </button>
          </div>
        </div>
      )}

      {/* Wallet List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 space-y-2 text-[var(--color-muted)]">
          <Loader2 size={24} className="animate-spin text-[var(--color-accent-amber)]" />
          <span className="text-[11px] font-mono">Loading customer wallets...</span>
        </div>
      ) : filteredWallets.length === 0 ? (
        <div className="p-8 text-center bg-[var(--color-surface-card)] rounded-xl border border-dashed border-[var(--color-border)] text-[var(--color-muted)] space-y-2">
          <Wallet size={32} className="mx-auto text-[var(--color-muted)] opacity-50" />
          <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)]">No Customer Wallets Found</div>
          <div className="text-[11px] font-mono">
            {search ? `No match for "${search}"` : 'Top up a customer to create their first wallet.'}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredWallets.map((wallet) => (
            <div
              key={wallet.id}
              className="p-3.5 bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] hover:border-[var(--color-accent-amber)] transition-colors flex items-center justify-between gap-3"
            >
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[13px] text-[var(--color-foreground)] truncate">
                    {wallet.customer_name}
                  </span>
                  {wallet.balance > 0 ? (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-[rgba(16,185,129,0.15)] text-[var(--color-success)] border border-[rgba(16,185,129,0.3)]">
                      ACTIVE
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-mono text-[var(--color-muted)] bg-[var(--color-surface-2)] border border-[var(--color-border)]">
                      EXHAUSTED
                    </span>
                  )}
                </div>
                <div className="text-[10px] font-mono text-[var(--color-muted)] flex items-center gap-3">
                  {wallet.customer_phone && <span>📞 {wallet.customer_phone}</span>}
                  <span>Source: {wallet.source_type.replace('_', ' ')}</span>
                  {wallet.source_ref && <span>Ref: {wallet.source_ref}</span>}
                </div>
              </div>

              <div className="text-right shrink-0 space-y-1">
                <div className="text-[14px] font-mono font-bold text-[var(--color-accent-amber)]">
                  ₦{fmt(wallet.balance)}
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => handleOpenHistory(wallet)}
                    className="px-2 py-1 rounded text-[9px] font-mono font-semibold bg-[var(--color-surface-2)] text-[var(--color-foreground)] hover:bg-[var(--color-border)] border border-[var(--color-border)] flex items-center gap-1 cursor-pointer"
                  >
                    <History size={10} /> History
                  </button>
                  <button
                    onClick={() => {
                      setFormName(wallet.customer_name);
                      setFormPhone(wallet.customer_phone || '');
                      setShowTopUpModal(true);
                    }}
                    className="px-2 py-1 rounded text-[9px] font-mono font-bold bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)] hover:bg-[var(--color-accent-amber)] hover:text-[var(--color-obsidian)] transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Plus size={10} strokeWidth={3} /> Top-Up
                  </button>
                  <button
                    onClick={() => printWalletReceipt(wallet)}
                    className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)] cursor-pointer"
                    title="Print Receipt"
                  >
                    <Printer size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Top-Up / Create Wallet */}
      {showTopUpModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl space-y-4 p-5">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <div className="flex items-center gap-2">
                <Wallet size={18} className="text-[var(--color-accent-amber)]" />
                <span className="text-[13px] font-mono font-bold text-[var(--color-foreground)] uppercase">
                  Top-Up Customer Credit Wallet
                </span>
              </div>
              <button
                onClick={() => setShowTopUpModal(false)}
                className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveTopUp} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                  Customer Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alhassan Ibrahim"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full h-10 px-3 text-[12px] font-mono rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                  Customer Phone (Optional)
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 08031234567"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  className="w-full h-10 px-3 text-[12px] font-mono rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                  Top-Up Amount (₦) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  placeholder="e.g. 50000"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  className="w-full h-10 px-3 text-[14px] font-mono font-bold rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-accent-amber)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Source Type
                  </label>
                  <select
                    value={formSourceType}
                    onChange={(e: any) => setFormSourceType(e.target.value)}
                    className="w-full h-10 px-2 text-[11px] font-mono rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  >
                    <option value="advance_deposit">Advance Deposit</option>
                    <option value="airline_retrieval">Airline Retrieval</option>
                    <option value="refund">EHI Overcharge Refund</option>
                    <option value="manual_credit">Manual Adjustment</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Source Ref (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. AWB-12345"
                    value={formSourceRef}
                    onChange={(e) => setFormSourceRef(e.target.value)}
                    className="w-full h-10 px-3 text-[11px] font-mono rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                  Note / Remarks (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Kept money after Dana Air retrieval"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  className="w-full h-10 px-3 text-[11px] font-mono rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowTopUpModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] text-[11px] font-mono font-semibold hover:bg-[var(--color-surface-2)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTopUp}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-mono font-bold hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {savingTopUp ? <Loader2 size={14} className="animate-spin" /> : 'Confirm Top-Up'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: History */}
      {showHistoryModal && selectedWallet && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl space-y-4 p-5 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3 shrink-0">
              <div>
                <span className="text-[13px] font-mono font-bold text-[var(--color-foreground)] uppercase block">
                  {selectedWallet.customer_name} — Wallet Audit Trail
                </span>
                <span className="text-[10px] font-mono text-[var(--color-accent-amber)]">
                  Current Balance: ₦{fmt(selectedWallet.balance)}
                </span>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {historyLoading ? (
                <div className="p-8 text-center text-[var(--color-muted)]">
                  <Loader2 size={20} className="animate-spin mx-auto mb-2 text-[var(--color-accent-amber)]" />
                  <span className="text-[11px] font-mono">Fetching transaction history...</span>
                </div>
              ) : walletHistory.length === 0 ? (
                <div className="p-8 text-center text-[var(--color-muted)] font-mono text-[11px]">
                  No transaction log entries found.
                </div>
              ) : (
                walletHistory.map((tx) => (
                  <div
                    key={tx.id}
                    className="p-3 bg-[var(--color-surface-2)] rounded-xl border border-[var(--color-border)] flex items-center justify-between gap-3 text-[11px]"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 font-bold">
                        {tx.type === 'top_up' ? (
                          <span className="text-[var(--color-success)] flex items-center gap-1">
                            <ArrowDownLeft size={12} /> TOP-UP
                          </span>
                        ) : tx.type === 'deduction' ? (
                          <span className="text-[var(--color-error)] flex items-center gap-1">
                            <ArrowUpRight size={12} /> DEDUCTION
                          </span>
                        ) : (
                          <span className="text-[var(--color-accent-cobalt)]">{tx.type.toUpperCase()}</span>
                        )}
                        <span className="text-[var(--color-muted)] font-mono font-normal">
                          · {new Date(tx.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-[var(--color-muted)]">
                        {tx.description || tx.cargo_ref || 'No details'}
                      </div>
                      <div className="text-[9px] font-mono text-[var(--color-light-muted)]">
                        By: {tx.logged_by}
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-0.5">
                      <div
                        className={`font-mono font-bold text-[12px] ${
                          tx.type === 'top_up' ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
                        }`}
                      >
                        {tx.type === 'top_up' ? '+' : '-'}₦{fmt(tx.amount)}
                      </div>
                      <div className="text-[9px] font-mono text-[var(--color-muted)]">
                        Bal after: ₦{fmt(tx.balance_after)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
