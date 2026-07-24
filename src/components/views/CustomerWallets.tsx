import { useState, useEffect, useCallback } from 'react';
import { User } from '../../lib/types';
import { fmt, tnow } from '../../lib/helpers';
import { supabase, writeAuditLog } from '../../lib/supabase';
import { applyWalletTransaction, requestWalletCashPayout, approveWalletCashPayout, rejectWalletCashPayout, RetrievalEntryType } from '../../lib/wallet';
import { useToast } from '../../lib/ToastContext';
import { useConfirm } from '../../lib/ConfirmContext';
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
  Trash2,
  X,
  Loader2,
  AlertCircle,
  TrendingUp,
  ShieldCheck,
  User as UserIcon,
  HandCoins,
  CheckCircle2,
  XCircle,
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
  archived_at?: string | null;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  hub_id?: string;
  type: 'top_up' | 'deduction' | 'refund' | 'adjustment' | 'cash_payout';
  amount: number;
  balance_before: number;
  balance_after: number;
  cargo_ref?: string;
  description?: string;
  logged_by: string;
  created_at: string;
  // department is only reliably populated from 20260902_multi_department_
  // retrieval_and_wallet_cashout.sql onward -- older rows were backfilled
  // to 'cargo' (every wallet transaction before this migration came from
  // cargo retrieval, the only department wired up until now).
  department?: RetrievalEntryType;
  status?: 'completed' | 'pending' | 'rejected';
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
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
  const confirm = useConfirm();
  const [wallets, setWallets] = useState<CustomerWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialCustomerName || '');
  // Archived wallets were previously invisible everywhere -- fetchWallets
  // always filtered them out with no toggle to see them again.
  const [walletView, setWalletView] = useState<'active' | 'archived'>('active');

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

  // Same role gate TransactionLedger.tsx already uses for financial
  // approvals (payment confirmation) -- reused here for cash-payout
  // approval rather than inventing a new permission.
  const canApprovePayouts = ['accountant', 'admin', 'super_admin'].includes(user.role);
  // Force delete permanently destroys a wallet's transaction history and
  // unlinks it from any past entries -- restricted to a smaller, explicitly
  // named set of roles rather than reusing canApprovePayouts.
  const canForceDelete = ['super_admin', 'accountant', 'admin', 'office_work'].includes(user.role);
  const [forceDeletingId, setForceDeletingId] = useState<string | null>(null);
  // Matches apply_wallet_transaction's own server-side gate for
  // top_up/adjustment (20260903_security_and_bugfix_pass.sql) -- without
  // this, unprivileged roles could open the Top-Up form and submit it,
  // only to have the RPC reject it after the fact.
  const canTopUp = ['accountant', 'admin', 'super_admin', 'auditor'].includes(user.role);

  // Cash-payout request form
  const [payoutWalletId, setPayoutWalletId] = useState<string | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutDepartment, setPayoutDepartment] = useState<RetrievalEntryType>('cargo');
  const [payoutNote, setPayoutNote] = useState('');
  const [savingPayout, setSavingPayout] = useState(false);

  // Pending cash payouts awaiting a second person's approval
  const [pendingPayouts, setPendingPayouts] = useState<WalletTransaction[]>([]);
  const [rejectingPayoutId, setRejectingPayoutId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [payoutActionLoading, setPayoutActionLoading] = useState<string | null>(null);

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    setTableMissing(false);
    try {
      let query = supabase
        .from('customer_wallets')
        .select('*')
        .order('updated_at', { ascending: false });

      query = walletView === 'archived'
        ? query.not('archived_at', 'is', null)
        : query.is('archived_at', null);

      // Customer credit wallets are company-wide customer accounts -- all station
      // agents across all hubs require visibility into all customer wallets
      // to process wallet payments, top-ups, and ledger checks regardless of
      // origin hub.

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
  }, [user.hub_id, user.role, walletView, showToast]);

  const fetchPendingPayouts = useCallback(async () => {
    if (!canApprovePayouts) return;
    try {
      const { data, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('type', 'cash_payout')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setPendingPayouts((data as WalletTransaction[]) || []);
    } catch (err: any) {
      // Silent -- table/columns may not exist yet if the migration hasn't
      // been run, and this section is a secondary feature of the screen,
      // not its core purpose (matches tableMissing's own graceful handling
      // for customer_wallets above).
      console.error('Error fetching pending cash payouts:', err);
    }
  }, [canApprovePayouts]);

  useEffect(() => {
    fetchPendingPayouts();
  }, [fetchPendingPayouts]);

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

  // A wallet with zero balance AND zero lifetime activity has, by
  // definition, zero wallet_transactions rows (total_topped_up/total_used
  // only ever increase, via apply_wallet_transaction) -- safe to hard
  // delete with nothing to lose. Anything with real history gets archived
  // instead (hidden from the default list, balance/history untouched) so a
  // customer's payment trail is never silently destroyed.
  const handleRemoveWallet = async (wallet: CustomerWallet) => {
    const noHistory = wallet.balance === 0 && wallet.total_topped_up === 0 && wallet.total_used === 0;

    if (noHistory) {
      const ok = await confirm({
        title: 'Delete wallet?',
        message: `Permanently delete ${wallet.customer_name}'s wallet? It has no balance or transaction history, so this cannot be undone.`,
        confirmLabel: 'Delete',
        tone: 'danger',
      });
      if (!ok) return;
      const { error } = await supabase.from('customer_wallets').delete().eq('id', wallet.id);
      if (error) {
        showToast({ message: `Failed to delete wallet: ${error.message}`, type: 'error' });
        return;
      }
      setWallets((prev) => prev.filter((w) => w.id !== wallet.id));
      showToast({ message: `${wallet.customer_name}'s wallet deleted`, type: 'success' });
      return;
    }

    const balanceWarning = wallet.balance > 0 ? ` It still has a remaining balance of ₦${fmt(wallet.balance)}.` : '';
    const ok = await confirm({
      title: 'Archive wallet?',
      message: `${wallet.customer_name}'s wallet has transaction history, so it can't be permanently deleted.${balanceWarning} Archiving will hide it from this list but keep its full balance and history intact.`,
      confirmLabel: 'Archive',
      tone: 'danger',
    });
    if (!ok) return;
    const { error } = await supabase
      .from('customer_wallets')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', wallet.id);
    if (error) {
      showToast({ message: `Failed to archive wallet: ${error.message}`, type: 'error' });
      return;
    }
    setWallets((prev) => prev.filter((w) => w.id !== wallet.id));
    showToast({ message: `${wallet.customer_name}'s wallet archived`, type: 'success' });
  };

  // Genuinely destructive: bypasses handleRemoveWallet's history check
  // entirely, permanently deleting a wallet with real balance/activity.
  // force_delete_wallet (20260905_force_delete_wallet.sql) unlinks the
  // wallet from any cargo/manifests/marketing/package entries that paid
  // via it before deleting, so the delete itself never fails on a foreign
  // key -- but wallet_transactions (its full top-up/deduction history)
  // cascades away with it, which is the whole point of "force". Restricted
  // to canForceDelete roles both here and (authoritatively) server-side in
  // the RPC itself.
  const handleForceDelete = async (wallet: CustomerWallet) => {
    const ok = await confirm({
      title: 'Force delete this wallet?',
      message: `This PERMANENTLY deletes ${wallet.customer_name}'s wallet, including its entire top-up/deduction history. Any cargo, baggage, marketing, or package entry that was ever paid from this wallet will keep its own record but lose its link to it. This cannot be undone.`,
      confirmLabel: 'Force Delete',
      tone: 'danger',
    });
    if (!ok) return;

    setForceDeletingId(wallet.id);
    try {
      const { error } = await supabase.rpc('force_delete_wallet', { p_wallet_id: wallet.id });
      if (error) {
        showToast({ message: `Failed to force-delete wallet: ${error.message}`, type: 'error' });
        return;
      }
      setWallets((prev) => prev.filter((w) => w.id !== wallet.id));
      showToast({ message: `${wallet.customer_name}'s wallet permanently deleted`, type: 'success' });
      writeAuditLog({
        user_id: user.id,
        user_name: user.name,
        action: 'DELETE',
        table_name: 'customer_wallets',
        record_id: wallet.id,
        description: `Force-deleted wallet for ${wallet.customer_name} (balance ₦${fmt(wallet.balance)}, lifetime topped up ₦${fmt(wallet.total_topped_up)}, used ₦${fmt(wallet.total_used)})`,
        hub: user.hub,
        hub_id: user.hub_id,
        old_values: {
          customer_name: wallet.customer_name,
          customer_phone: wallet.customer_phone,
          balance: wallet.balance,
          total_topped_up: wallet.total_topped_up,
          total_used: wallet.total_used,
          archived_at: wallet.archived_at,
        },
      }).catch(() => {});
    } catch (err: any) {
      showToast({ message: `Failed to force-delete wallet: ${err.message}`, type: 'error' });
    } finally {
      setForceDeletingId(null);
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
      let isNewWallet = false;

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
        isNewWallet = true;
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

      if (!result.ok) {
        // A rejected top-up (e.g. a stale/unprivileged session slipping
        // past the canTopUp gate above, or the server-side role check in
        // apply_wallet_transaction) must not leave the zero-balance wallet
        // row just inserted above permanently orphaned. Scoped to exactly
        // that row and only if it's still untouched, so this can never
        // delete a wallet that already has real balance/activity.
        if (isNewWallet && walletId) {
          await supabase.from('customer_wallets').delete().eq('id', walletId).eq('balance', 0).eq('total_topped_up', 0);
        }
        throw new Error(result.error);
      }

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

  const handleRequestPayout = async (wallet: CustomerWallet) => {
    const amt = parseFloat(payoutAmount);
    if (isNaN(amt) || amt <= 0) {
      showToast({ message: 'Enter a valid payout amount', type: 'error' });
      return;
    }
    if (amt > wallet.balance) {
      showToast({ message: `Cannot pay out more than the current balance (₦${fmt(wallet.balance)})`, type: 'error' });
      return;
    }
    setSavingPayout(true);
    try {
      // Does NOT deduct the balance yet -- request_wallet_cash_payout()
      // only records a 'pending' row. The balance only actually moves once
      // a different person (accountant/admin/super_admin, not this agent)
      // approves it below.
      const result = await requestWalletCashPayout({
        walletId: wallet.id,
        amount: amt,
        department: payoutDepartment,
        requestedBy: user.name,
        note: payoutNote.trim() || undefined,
      });
      if (!result.ok) throw new Error(result.error);
      showToast({ message: `Cash payout of ₦${fmt(amt)} requested — awaiting approval`, type: 'success' });
      setPayoutWalletId(null);
      setPayoutAmount('');
      setPayoutNote('');
      fetchPendingPayouts();
    } catch (err: any) {
      showToast({ message: 'Failed to request payout: ' + err.message, type: 'error' });
    } finally {
      setSavingPayout(false);
    }
  };

  const handleApprovePayout = async (payout: WalletTransaction) => {
    if (payout.logged_by === user.name) {
      showToast({ message: "You can't approve a cash payout you requested yourself", type: 'error' });
      return;
    }
    const ok = await confirm({
      title: 'Approve cash payout?',
      message: `Approve a ₦${fmt(payout.amount)} cash payout requested by ${payout.logged_by}? The wallet balance will be deducted immediately.`,
      confirmLabel: 'Approve',
      tone: 'default',
    });
    if (!ok) return;
    setPayoutActionLoading(payout.id);
    try {
      const result = await approveWalletCashPayout({ transactionId: payout.id, approvedBy: user.name });
      if (!result.ok) throw new Error(result.error);
      showToast({ message: `₦${fmt(payout.amount)} cash payout approved`, type: 'success' });
      fetchPendingPayouts();
      fetchWallets();
    } catch (err: any) {
      showToast({ message: 'Failed to approve payout: ' + err.message, type: 'error' });
    } finally {
      setPayoutActionLoading(null);
    }
  };

  const handleRejectPayout = async (payout: WalletTransaction) => {
    setPayoutActionLoading(payout.id);
    try {
      const result = await rejectWalletCashPayout({
        transactionId: payout.id,
        rejectedBy: user.name,
        reason: rejectReason.trim() || undefined,
      });
      if (!result.ok) throw new Error(result.error);
      showToast({ message: 'Cash payout rejected', type: 'success' });
      setRejectingPayoutId(null);
      setRejectReason('');
      fetchPendingPayouts();
    } catch (err: any) {
      showToast({ message: 'Failed to reject payout: ' + err.message, type: 'error' });
    } finally {
      setPayoutActionLoading(null);
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
        {canTopUp && (
          <button
            onClick={() => setShowTopUpModal(true)}
            className="px-3 py-1.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-mono font-bold rounded-lg flex items-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
          >
            <Plus size={14} strokeWidth={3} />
            <span>Top-Up Wallet</span>
          </button>
        )}
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

      {/* Pending Cash Payouts -- maker-checker: requested by one agent,
          approved/rejected by a different accountant/admin/super_admin */}
      {canApprovePayouts && pendingPayouts.length > 0 && (
        <div className="p-3.5 bg-[rgba(245,158,11,0.06)] border border-[var(--color-accent-amber)] rounded-xl space-y-2.5">
          <div className="text-[11px] font-mono font-bold text-[var(--color-accent-amber)] uppercase tracking-wider flex items-center gap-1.5">
            <HandCoins size={13} /> Pending Cash Payouts ({pendingPayouts.length})
          </div>
          {pendingPayouts.map((payout) => {
            const wallet = wallets.find((w) => w.id === payout.wallet_id);
            const isSelf = payout.logged_by === user.name;
            const busy = payoutActionLoading === payout.id;
            return (
              <div key={payout.id} className="p-3 bg-[var(--color-surface-card)] rounded-lg border border-[var(--color-border)] space-y-2">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-bold text-[var(--color-foreground)] truncate">
                      {wallet?.customer_name || 'Unknown customer'} · ₦{fmt(payout.amount)}
                    </div>
                    <div className="text-[9px] font-mono text-[var(--color-muted)]">
                      Requested by {payout.logged_by} · {payout.department || 'cargo'}
                      {payout.description ? ` · ${payout.description}` : ''}
                    </div>
                  </div>
                </div>
                {rejectingPayoutId === payout.id ? (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason for rejecting (optional)"
                      className="w-full h-9 px-2.5 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleRejectPayout(payout)}
                        disabled={busy}
                        className="flex-1 h-8 rounded-lg text-[10px] font-mono font-bold bg-[var(--color-error)] text-white disabled:opacity-50"
                      >
                        Confirm Reject
                      </button>
                      <button
                        onClick={() => { setRejectingPayoutId(null); setRejectReason(''); }}
                        className="flex-1 h-8 rounded-lg text-[10px] font-mono font-bold bg-[var(--color-surface-2)] text-[var(--color-foreground)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleApprovePayout(payout)}
                      disabled={isSelf || busy}
                      title={isSelf ? "You can't approve your own request" : 'Approve'}
                      className="flex-1 h-8 rounded-lg text-[10px] font-mono font-bold bg-[var(--color-success)] text-[#0B0F19] disabled:opacity-40 flex items-center justify-center gap-1"
                    >
                      <CheckCircle2 size={12} /> Approve
                    </button>
                    <button
                      onClick={() => setRejectingPayoutId(payout.id)}
                      disabled={busy}
                      className="flex-1 h-8 rounded-lg text-[10px] font-mono font-bold bg-[var(--color-surface-2)] text-[var(--color-error)] border border-[rgba(239,68,68,0.3)] disabled:opacity-40 flex items-center justify-center gap-1"
                    >
                      <XCircle size={12} /> Reject
                    </button>
                  </div>
                )}
                {isSelf && (
                  <div className="text-[9px] font-mono text-[var(--color-muted)] italic">
                    You requested this payout -- a different person must approve it.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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

      {/* Active / Archived toggle -- archived wallets were previously
          invisible everywhere, with no way to see them again. */}
      <div className="flex p-1 bg-[var(--color-surface-2)] rounded-lg w-fit">
        <button
          onClick={() => setWalletView('active')}
          className={`px-3 py-1.5 text-[11px] font-mono font-bold rounded-md transition-colors ${walletView === 'active' ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'text-[var(--color-muted)]'}`}
        >
          Active
        </button>
        <button
          onClick={() => setWalletView('archived')}
          className={`px-3 py-1.5 text-[11px] font-mono font-bold rounded-md transition-colors ${walletView === 'archived' ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'text-[var(--color-muted)]'}`}
        >
          Archived
        </button>
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
                  {canTopUp && (
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
                  )}
                  {wallet.balance > 0 && (
                    <button
                      onClick={() => { setPayoutWalletId(wallet.id); setPayoutAmount(''); setPayoutNote(''); }}
                      className="px-2 py-1 rounded text-[9px] font-mono font-bold bg-[rgba(239,68,68,0.1)] text-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                      title="Pay this customer cash out of their wallet balance"
                    >
                      <HandCoins size={10} /> Pay Cash
                    </button>
                  )}
                  <button
                    onClick={() => printWalletReceipt(wallet)}
                    className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)] cursor-pointer"
                    title="Print Receipt"
                  >
                    <Printer size={12} />
                  </button>
                  <button
                    onClick={() => handleRemoveWallet(wallet)}
                    className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-2)] cursor-pointer"
                    title="Remove Wallet"
                  >
                    <Trash2 size={12} />
                  </button>
                  {canForceDelete && (
                    <button
                      onClick={() => handleForceDelete(wallet)}
                      disabled={forceDeletingId === wallet.id}
                      className="px-2 py-1 rounded text-[9px] font-mono font-bold bg-[rgba(239,68,68,0.1)] text-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-white transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Permanently delete this wallet, including its full history -- bypasses the normal archive-only safeguard"
                    >
                      {forceDeletingId === wallet.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                      Force Delete
                    </button>
                  )}
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
                        ) : tx.type === 'cash_payout' ? (
                          <span className={`flex items-center gap-1 ${tx.status === 'rejected' ? 'text-[var(--color-muted)] line-through' : tx.status === 'pending' ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-error)]'}`}>
                            <HandCoins size={12} /> CASH PAYOUT{tx.status === 'pending' ? ' (PENDING)' : tx.status === 'rejected' ? ' (REJECTED)' : ''}
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
                      <div className="text-[9px] font-mono text-[var(--color-light-muted)] flex items-center gap-1.5">
                        <span>By: {tx.logged_by}</span>
                        {tx.department && (
                          <span className="px-1 py-0.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] uppercase">
                            {tx.department}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-0.5">
                      <div
                        className={`font-mono font-bold text-[12px] ${
                          tx.type === 'top_up' ? 'text-[var(--color-success)]'
                            : tx.type === 'cash_payout' && tx.status !== 'completed' ? 'text-[var(--color-muted)]'
                            : 'text-[var(--color-error)]'
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

      {/* Modal: Request Cash Payout */}
      {payoutWalletId && (() => {
        const wallet = wallets.find((w) => w.id === payoutWalletId);
        if (!wallet) return null;
        return (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl space-y-4 p-5">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                <div>
                  <span className="text-[13px] font-mono font-bold text-[var(--color-foreground)] uppercase block">
                    Pay Cash Out
                  </span>
                  <span className="text-[10px] font-mono text-[var(--color-muted)]">
                    {wallet.customer_name} · Balance ₦{fmt(wallet.balance)}
                  </span>
                </div>
                <button onClick={() => setPayoutWalletId(null)} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer">
                  <X size={16} />
                </button>
              </div>

              <div className="text-[10px] font-mono text-[var(--color-muted)] leading-relaxed bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.2)] rounded-lg p-2.5">
                This does not deduct the balance immediately -- a different accountant/admin must approve it first.
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">AMOUNT ₦ (max {fmt(wallet.balance)})</label>
                  <input
                    type="number"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    placeholder={String(wallet.balance)}
                    className="w-full h-10 px-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg text-[13px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">DEPARTMENT (record-keeping)</label>
                  <select
                    value={payoutDepartment}
                    onChange={(e) => setPayoutDepartment(e.target.value as RetrievalEntryType)}
                    className="w-full h-10 px-2 text-[12px] font-mono rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)]"
                  >
                    <option value="cargo">Cargo</option>
                    <option value="baggage">Baggage</option>
                    <option value="marketing">Marketing</option>
                    <option value="package">Package</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">NOTE (optional)</label>
                  <input
                    type="text"
                    value={payoutNote}
                    onChange={(e) => setPayoutNote(e.target.value)}
                    placeholder="Why this is being paid out as cash"
                    className="w-full h-10 px-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg text-[13px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
              </div>

              <button
                onClick={() => handleRequestPayout(wallet)}
                disabled={savingPayout}
                className="w-full h-11 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg text-[12px] font-mono font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <HandCoins size={14} /> {savingPayout ? 'Requesting...' : 'Request Cash Payout'}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
