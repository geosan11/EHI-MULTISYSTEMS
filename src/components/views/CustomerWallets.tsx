import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { User } from '../../lib/types';
import { fmt, tnow } from '../../lib/helpers';
import { supabase, writeAuditLog, fetchRowsCapped } from '../../lib/supabase';
import { applyWalletTransaction, requestWalletCashPayout, approveWalletCashPayout, rejectWalletCashPayout, requestWalletTopUp, approveWalletTopUp, rejectWalletTopUp, approveRetrievalRefund, rejectRetrievalRefund, reverseWalletDeduction, RetrievalEntryType } from '../../lib/wallet';
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
  Undo2,
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
  type: 'top_up' | 'deduction' | 'refund' | 'adjustment' | 'cash_payout' | 'retrieval_refund' | 'reversal';
  amount: number;
  balance_before: number;
  balance_after: number;
  cargo_ref?: string;
  cargo_entry_id?: string;
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
  // Set on a 'deduction' row once it has been undone (reverse_wallet_
  // deduction, or Reopen Debt on a wallet-settled debt).
  reversed_at?: string;
  reversed_by?: string;
  // Set on the compensating 'reversal' row -- the deduction it undid.
  reversal_of?: string;
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
  const [walletHistoryCapped, setWalletHistoryCapped] = useState(false);
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
  // How this top-up was physically collected -- previously not captured at
  // all, so a real cash top-up was invisible to EODReconciliation.tsx's
  // expected-cash math (it only ever produced a wallet_transactions row,
  // never a Transaction the EOD screen's cash/transfer/pos totals scan).
  const [formPaymentMode, setFormPaymentMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');
  const [savingTopUp, setSavingTopUp] = useState(false);

  const [tableMissing, setTableMissing] = useState(false);
  const [walletsCapped, setWalletsCapped] = useState(false);

  // Same role gate TransactionLedger.tsx already uses for financial
  // approvals (payment confirmation) -- reused here for cash-payout
  // approval rather than inventing a new permission.
  const canApprovePayouts = ['accountant', 'admin', 'super_admin'].includes(user.role);
  // Force delete permanently destroys a wallet's transaction history and
  // unlinks it from any past entries -- restricted to a smaller, explicitly
  // named set of roles rather than reusing canApprovePayouts.
  const canForceDelete = ['super_admin', 'accountant', 'admin', 'office_work'].includes(user.role);
  const [forceDeletingId, setForceDeletingId] = useState<string | null>(null);
  // Undoing a wallet deduction hands money back to a customer -- gated to
  // the same finance roles as cash-payout approval (canApprovePayouts). The
  // RPC re-checks this server-side.
  const [reversingTxId, setReversingTxId] = useState<string | null>(null);
  // Every role can open the Top-Up form now -- canDirectTopUp (matching
  // apply_wallet_transaction's server-side gate for top_up/adjustment,
  // 20260903_security_and_bugfix_pass.sql) decides whether handleSaveTopUp
  // applies the credit immediately, or (for cargo_agent/baggage_agent/
  // marketing_agent/driver/office_work) routes through
  // request_wallet_top_up() instead, landing in the pending-approval queue
  // below for accountant/admin/super_admin to action.
  const canTopUp = true;
  const canDirectTopUp = ['accountant', 'admin', 'super_admin', 'auditor'].includes(user.role);

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
      const buildPage = (from: number, to: number) => {
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

        return query.range(from, to);
      };

      // customer_wallets grows without bound as customers accrue prepaid
      // balances -- a plain unpaginated select silently truncated at
      // PostgREST's implicit ~1000-row cap once the table passed that size,
      // dropping the oldest wallets off this list with no indication.
      // Paginate past it the same way the ledger's "All Time" fetch does.
      let fetched: CustomerWallet[];
      let capped: boolean;
      try {
        const result = await fetchRowsCapped<CustomerWallet>(buildPage, 20000);
        fetched = result.rows;
        capped = result.capped;
      } catch (error: any) {
        if (error?.message?.includes('customer_wallets') || error?.message?.includes('schema cache') || error?.code === '42P01' || error?.code === 'PGRST301') {
          setTableMissing(true);
          return;
        }
        throw error;
      }
      setWalletsCapped(capped);

      // apply_wallet_transaction() already sets status='exhausted' the
      // instant a wallet's balance hits zero (see
      // 20260810_wallet_atomicity_and_isolation.sql) -- but nothing used to
      // read that column, so a spent-down wallet sat in the Active list
      // forever looking identical to one with real spendable balance.
      // Auto-archive it here instead: this only ARCHIVES (setting
      // archived_at, exactly what the manual Archive button already does),
      // it never deletes anything, so the wallet's full top-up/deduction
      // history is preserved -- it just moves out of the everyday Active
      // list automatically instead of requiring someone to notice and
      // click Archive themselves.
      if (walletView === 'active') {
        const toArchive = fetched.filter(w => w.status === 'exhausted' && !w.archived_at);
        if (toArchive.length > 0) {
          const archivedAt = new Date().toISOString();
          await supabase
            .from('customer_wallets')
            .update({ archived_at: archivedAt })
            .in('id', toArchive.map(w => w.id));
          const archivedIds = new Set(toArchive.map(w => w.id));
          setWallets(fetched.filter(w => !archivedIds.has(w.id)));
          if (toArchive.length === 1) {
            showToast({ message: `${toArchive[0].customer_name}'s wallet balance reached ₦0 -- automatically archived (history preserved)`, type: 'success' });
          } else {
            showToast({ message: `${toArchive.length} wallets reached ₦0 balance -- automatically archived (history preserved)`, type: 'success' });
          }
          return;
        }
      }
      setWallets(fetched);
    } catch (err: any) {
      console.error('Error fetching customer wallets:', err);
      showToast({ message: 'Failed to load customer wallets: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [user.hub_id, user.role, walletView, showToast]);

  // Combines all 3 maker-checker wallet actions into one queue --
  // cash_payout, top_up (front-line-requested), and retrieval_refund
  // (processRetrieval's deferred wallet credit) are all just
  // wallet_transactions rows with a 'pending' status and a type
  // discriminator, so one fetch + one render section covers all three
  // instead of duplicating the whole pattern 3 times.
  const fetchPendingPayouts = useCallback(async () => {
    if (!canApprovePayouts) return;
    try {
      const { data, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .in('type', ['cash_payout', 'top_up', 'retrieval_refund'])
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setPendingPayouts((data as WalletTransaction[]) || []);
    } catch (err: any) {
      // Silent -- table/columns may not exist yet if the migration hasn't
      // been run, and this section is a secondary feature of the screen,
      // not its core purpose (matches tableMissing's own graceful handling
      // for customer_wallets above).
      console.error('Error fetching pending wallet approvals:', err);
    }
  }, [canApprovePayouts]);

  useEffect(() => {
    fetchPendingPayouts();
  }, [fetchPendingPayouts]);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  // "Total Customer Credit Liability" must mean the same thing everywhere
  // it's shown -- LiveCreditFeed.tsx (fed by EHIApp.tsx's own unfiltered
  // wallet fetch) always sums active + archived balances. This screen used
  // to compute its own KPI from `wallets`, which is only ever the CURRENTLY
  // SELECTED tab's filtered list -- switching to the Archived tab silently
  // changed what the same label meant, and (worse) a wallet archived while
  // holding a real balance vanished from the Active tab's total even though
  // EHI still owed that money. Fetched independently of walletView so it
  // can't be affected by which tab is open.
  const [totalLiability, setTotalLiability] = useState(0);
  const [liabilityCapped, setLiabilityCapped] = useState(false);
  const fetchTotalLiability = useCallback(async () => {
    try {
      const { rows, capped } = await fetchRowsCapped<{ balance: number }>(
        (from, to) => supabase.from('customer_wallets').select('balance').range(from, to),
        20000,
      );
      setTotalLiability(rows.reduce((acc, w) => acc + (w.balance || 0), 0));
      setLiabilityCapped(capped);
    } catch {
      // table may not exist yet -- fetchWallets() already surfaces that case
    }
  }, []);
  useEffect(() => {
    fetchTotalLiability();
  }, [fetchTotalLiability]);

  // Live balance updates -- without this, a wallet spent down to zero (or
  // partially deducted) from a DIFFERENT screen (Cargo/VJ/Marketing/Package
  // retrieval) never reflects here until this screen is revisited/re-
  // toggled and fetchWallets() re-runs. Mirrors the same realtime pattern
  // TransactionLedger.tsx's own wallet feed already uses.
  useEffect(() => {
    const channel = supabase
      .channel('customer_wallets_management_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions' }, payload => {
        const walletId = (payload.new as any)?.wallet_id || (payload.old as any)?.wallet_id;
        if (!walletId) return;
        fetchTotalLiability();
        supabase.from('customer_wallets').select('*').eq('id', walletId).single()
          .then(async ({ data }) => {
            if (!data) return;
            if (walletView === 'active' && data.status === 'exhausted' && !data.archived_at) {
              // Same auto-archive as fetchWallets above, triggered live the
              // moment a deduction elsewhere exhausts this wallet, instead
              // of waiting for the next time this screen is fetched.
              await supabase.from('customer_wallets').update({ archived_at: new Date().toISOString() }).eq('id', walletId);
              setWallets(prev => prev.filter(w => w.id !== walletId));
              showToast({ message: `${data.customer_name}'s wallet balance reached ₦0 -- automatically archived (history preserved)`, type: 'success' });
              return;
            }
            setWallets(prev => prev.map(w => w.id === walletId ? { ...w, ...data } : w));
          });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [walletView, showToast, fetchTotalLiability]);

  const filteredWallets = wallets.filter(
    (w) =>
      w.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      (w.customer_phone && w.customer_phone.includes(search))
  );

  const handleOpenHistory = async (wallet: CustomerWallet) => {
    setSelectedWallet(wallet);
    setShowHistoryModal(true);
    setHistoryLoading(true);
    try {
      // A long-lived, heavily-used wallet's history can exceed PostgREST's
      // implicit ~1000-row cap -- paginate past it so old top-ups/deductions
      // don't silently vanish from this modal.
      const { rows, capped } = await fetchRowsCapped<WalletTransaction>(
        (from, to) => supabase
          .from('wallet_transactions')
          .select('*')
          .eq('wallet_id', wallet.id)
          .order('created_at', { ascending: false })
          .range(from, to),
        5000,
      );
      setWalletHistory(rows);
      setWalletHistoryCapped(capped);
    } catch (err: any) {
      showToast({ message: 'Failed to load wallet history: ' + err.message, type: 'error' });
    } finally {
      setHistoryLoading(false);
    }
  };

  // Undo a single wallet deduction (an intake wallet sale): refunds the
  // wallet and puts the linked shipment back to owing (unpaid Debt) for the
  // reverted amount. reverse_wallet_deduction() refuses -- and its error
  // names the right button -- for a retrieval clawback (use Unretrieve on
  // the shipment) or a wallet-settled debt (use Reopen Debt), and for a
  // shipment that has since been retrieved.
  const handleReverseDeduction = async (tx: WalletTransaction) => {
    if (reversingTxId || !selectedWallet) return;
    const ok = await confirm({
      title: 'Undo this deduction?',
      message: `Refunds ₦${fmt(tx.amount)} to ${selectedWallet.customer_name}'s wallet and puts ${tx.cargo_ref || 'the linked shipment'} back to owing (unpaid Debt). Use Unretrieve / Reopen Debt on the shipment instead if this deduction was a retrieval or a debt payment.`,
      confirmLabel: 'Undo Deduction',
      tone: 'danger',
    });
    if (!ok) return;

    setReversingTxId(tx.id);
    try {
      const result = await reverseWalletDeduction({
        transactionId: tx.id,
        loggedBy: user.name || 'Unknown',
      });
      if (!result.ok) {
        showToast({ message: result.error || 'Failed to undo this deduction.', type: 'error' });
        return;
      }
      writeAuditLog({
        user_id: user.id, user_name: user.name || 'Unknown', action: 'WALLET_DEDUCTION_REVERSED',
        table_name: 'wallet_transactions', record_id: tx.id,
        description: `₦${fmt(tx.amount)} deduction undone for ${selectedWallet.customer_name}'s wallet (${tx.cargo_ref || 'no ref'}) -- refunded, shipment back to Debt`,
        hub: undefined, hub_id: tx.hub_id,
        old_values: { amount: tx.amount, reversed_at: null },
        new_values: { reversed_at: tnow(), reversal_txn_id: result.reversalTxnId ?? null },
      }).catch(() => {});
      showToast({ message: `₦${fmt(tx.amount)} refunded to ${selectedWallet.customer_name}'s wallet`, type: 'success' });
      await handleOpenHistory(selectedWallet);
      fetchWallets();
      fetchTotalLiability();
    } finally {
      setReversingTxId(null);
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

    // Hard block, not just a warning -- archiving used to be allowed with a
    // positive balance (only a soft warning in the confirm message below),
    // which let a wallet's real balance silently vanish from the Active
    // tab's "Total Customer Credit Liability" the instant it was archived,
    // even though EHI still owed that money to the customer. Zero the
    // balance out first (Cash Payout, or a manual adjustment) so the
    // liability is actually resolved, not just hidden from view.
    if (wallet.balance > 0) {
      showToast({
        message: `Cannot archive ${wallet.customer_name}'s wallet -- it still has a ₦${fmt(wallet.balance)} balance. Pay it out (Cash Payout) or otherwise resolve it to ₦0 first.`,
        type: 'error',
      });
      return;
    }

    const ok = await confirm({
      title: 'Archive wallet?',
      message: `${wallet.customer_name}'s wallet has transaction history, so it can't be permanently deleted. Archiving will hide it from this list but keep its full balance and history intact.`,
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
      // force_delete_wallet is a single SECURITY DEFINER Postgres function
      // (20260905_force_delete_wallet.sql) -- it unlinks all 4 entry tables,
      // deletes wallet_transactions, and deletes the wallet inside one
      // transaction, so it can never itself leave partial state. There used
      // to be a client-side fallback here that manually replayed those same
      // steps as 5 separate non-transactional HTTP calls if the RPC errored
      // -- but a mid-sequence failure in THAT path could leave a wallet
      // unlinked from its entries without actually being deleted, exactly
      // the inconsistent state the atomic RPC exists to prevent. Fail
      // closed instead: surface the RPC's error and let the user retry.
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
      // 1. Find or atomically create the wallet, serialized server-side
      // against concurrent calls for the same customer name -- this used
      // to check only this tab's in-memory `wallets` array then do a plain
      // client .insert(), so two top-ups submitted near-simultaneously for
      // the same (often phone-less) customer could both miss the match and
      // both create a separate wallet, splitting their balance across two
      // rows. See find_or_create_customer_wallet() in
      // supabase/migrations/20260917_phoneless_wallet_dedupe_race.sql.
      const { data: foundOrCreated, error: findErr } = await supabase.rpc('find_or_create_customer_wallet', {
        p_hub_id: user.hub_id,
        p_customer_name: name,
        p_customer_phone: formPhone.trim() || null,
        p_created_by: user.name,
        p_source_type: formSourceType,
        p_source_ref: formSourceRef.trim() || null,
        p_source_note: formNote.trim() || null,
        p_opening_balance: amt,
      });
      if (findErr) throw findErr;
      const foundOrCreatedRow = Array.isArray(foundOrCreated) ? foundOrCreated[0] : foundOrCreated;
      if (!foundOrCreatedRow?.wallet_id) throw new Error('Could not find or create wallet');

      const walletId: string = foundOrCreatedRow.wallet_id;
      const isNewWallet: boolean = foundOrCreatedRow.was_created;

      // 2. accountant/admin/super_admin/auditor credit the wallet
      // immediately, same as always. Every other role (cargo_agent,
      // baggage_agent, marketing_agent, driver, office_work) instead
      // requests the top-up -- it lands as a 'pending' wallet_transactions
      // row via request_wallet_top_up(), with zero balance change until an
      // accountant/admin/super_admin approves it below.
      const result = canDirectTopUp
        ? await applyWalletTransaction({
            walletId,
            type: 'top_up',
            amount: amt,
            cargoRef: formSourceRef.trim() || undefined,
            description: formNote.trim() || `Top-up via ${formSourceType.replace('_', ' ')}`,
            loggedBy: user.name,
            paymentMode: formPaymentMode,
          })
        : await requestWalletTopUp({
            walletId,
            amount: amt,
            requestedBy: user.name,
            paymentMode: formPaymentMode,
            note: formNote.trim() || `Top-up via ${formSourceType.replace('_', ' ')}`,
          });

      if (!result.ok) {
        // A rejected top-up must not leave the zero-balance wallet row
        // just inserted above permanently orphaned. Scoped to exactly that
        // row and only if it's still untouched, so this can never delete a
        // wallet that already has real balance/activity.
        if (isNewWallet && walletId) {
          await supabase.from('customer_wallets').delete().eq('id', walletId).eq('balance', 0).eq('total_topped_up', 0);
        }
        throw new Error(result.error);
      }

      showToast({
        message: canDirectTopUp
          ? `Successfully topped up ₦${fmt(amt)} for ${name}!`
          : `₦${fmt(amt)} top-up requested for ${name} — awaiting approval`,
        type: 'success',
      });
      setShowTopUpModal(false);
      setFormName('');
      setFormPhone('');
      setFormAmount('');
      setFormSourceRef('');
      setFormNote('');
      setFormPaymentMode('Cash');
      fetchWallets();
      fetchPendingPayouts();
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

  // Labels/RPC routing for the 3 pending types this queue now covers.
  const PENDING_TYPE_LABEL: Record<string, string> = {
    cash_payout: 'Cash Payout',
    top_up: 'Top-Up',
    retrieval_refund: 'Retrieval Refund',
  };
  const approveByType = (type: string) =>
    type === 'top_up' ? approveWalletTopUp : type === 'retrieval_refund' ? approveRetrievalRefund : approveWalletCashPayout;
  const rejectByType = (type: string) =>
    type === 'top_up' ? rejectWalletTopUp : type === 'retrieval_refund' ? rejectRetrievalRefund : rejectWalletCashPayout;

  const handleApprovePayout = async (payout: WalletTransaction) => {
    if (payout.logged_by === user.name) {
      showToast({ message: `You can't approve a ${PENDING_TYPE_LABEL[payout.type] || 'wallet action'} you requested yourself`, type: 'error' });
      return;
    }
    const verb = payout.type === 'cash_payout' ? 'deducted from' : 'credited to';
    const ok = await confirm({
      title: `Approve ${PENDING_TYPE_LABEL[payout.type] || 'wallet action'}?`,
      message: `Approve a ₦${fmt(payout.amount)} ${(PENDING_TYPE_LABEL[payout.type] || 'action').toLowerCase()} requested by ${payout.logged_by}? The wallet balance will be ${verb} immediately.`,
      confirmLabel: 'Approve',
      tone: 'default',
    });
    if (!ok) return;
    setPayoutActionLoading(payout.id);
    try {
      const result = await approveByType(payout.type)({ transactionId: payout.id, approvedBy: user.name });
      if (!result.ok) throw new Error(result.error);
      showToast({ message: `₦${fmt(payout.amount)} ${PENDING_TYPE_LABEL[payout.type] || 'action'} approved`, type: 'success' });
      fetchPendingPayouts();
      fetchWallets();
    } catch (err: any) {
      showToast({ message: 'Failed to approve: ' + err.message, type: 'error' });
    } finally {
      setPayoutActionLoading(null);
    }
  };

  const handleRejectPayout = async (payout: WalletTransaction) => {
    setPayoutActionLoading(payout.id);
    try {
      const result = await rejectByType(payout.type)({
        transactionId: payout.id,
        rejectedBy: user.name,
        reason: rejectReason.trim() || undefined,
      });
      if (!result.ok) throw new Error(result.error);
      showToast({ message: `${PENDING_TYPE_LABEL[payout.type] || 'Action'} rejected`, type: 'success' });
      setRejectingPayoutId(null);
      setRejectReason('');
      fetchPendingPayouts();
    } catch (err: any) {
      showToast({ message: 'Failed to reject: ' + err.message, type: 'error' });
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
            className="px-3 py-1.5 bg-[var(--color-accent-amber)] text-[var(--color-on-accent)] text-[11px] font-mono font-bold rounded-lg flex items-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
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
            {liabilityCapped || walletsCapped
              ? 'Wallet count exceeds this view\'s cap — total may be incomplete'
              : 'Prepaid balance held by EHI'}
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

      {/* Pending Wallet Approvals -- maker-checker: requested by one agent
          (cash payout, front-line top-up, or a retrieval's deferred wallet
          refund), approved/rejected by a different accountant/admin/
          super_admin */}
      {canApprovePayouts && pendingPayouts.length > 0 && (
        <div className="p-3.5 bg-[rgba(245,158,11,0.06)] border border-[var(--color-accent-amber)] rounded-xl space-y-2.5">
          <div className="text-[11px] font-mono font-bold text-[var(--color-accent-amber)] uppercase tracking-wider flex items-center gap-1.5">
            <HandCoins size={13} /> Pending Wallet Approvals ({pendingPayouts.length})
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
                      <span className="ml-1.5 px-1.5 py-0.5 rounded text-[8px] font-mono uppercase bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)] align-middle">
                        {PENDING_TYPE_LABEL[payout.type] || payout.type}
                      </span>
                    </div>
                    <div className="text-[9px] font-mono text-[var(--color-muted)]">
                      {/* top_up has no real department (request_wallet_top_up
                          doesn't take one) -- falling back to 'cargo' for it
                          would mislabel every front-line top-up request.
                          cash_payout/retrieval_refund always have a real one. */}
                      Requested by {payout.logged_by}{payout.department ? ` · ${payout.department}` : ''}
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
                      className="flex-1 h-8 rounded-lg text-[10px] font-mono font-bold bg-[var(--color-success)] text-[var(--color-on-accent)] disabled:opacity-40 flex items-center justify-center gap-1"
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
                    You requested this -- a different person must approve it.
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
          className={`px-3 py-1.5 text-[11px] font-mono font-bold rounded-md transition-colors ${walletView === 'active' ? 'bg-[var(--color-accent-amber)] text-[var(--color-on-accent)]' : 'text-[var(--color-muted)]'}`}
        >
          Active
        </button>
        <button
          onClick={() => setWalletView('archived')}
          className={`px-3 py-1.5 text-[11px] font-mono font-bold rounded-md transition-colors ${walletView === 'archived' ? 'bg-[var(--color-accent-amber)] text-[var(--color-on-accent)]' : 'text-[var(--color-muted)]'}`}
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
              className="px-3 py-1.5 bg-[var(--color-accent-amber)] text-[var(--color-on-accent)] text-[11px] font-mono font-bold rounded-lg cursor-pointer hover:opacity-90"
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
              style={{ boxShadow: 'var(--shadow-card)' }}
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
                      className="px-2 py-1 rounded text-[9px] font-mono font-bold bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)] hover:bg-[var(--color-accent-amber)] hover:text-[var(--color-on-accent)] transition-colors flex items-center gap-1 cursor-pointer"
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
      {showTopUpModal && createPortal(
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-md overflow-hidden space-y-4 p-5" style={{ boxShadow: 'var(--shadow-modal)' }}>
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
                  Collected Via *
                </label>
                <select
                  value={formPaymentMode}
                  onChange={(e: any) => setFormPaymentMode(e.target.value)}
                  className="w-full h-10 px-2 text-[11px] font-mono rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                >
                  <option value="Cash">Cash</option>
                  <option value="Transfer">Transfer</option>
                  <option value="POS">POS</option>
                </select>
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
                  className="flex-1 py-2.5 rounded-xl bg-[var(--color-accent-amber)] text-[var(--color-on-accent)] text-[11px] font-mono font-bold hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {savingTopUp ? <Loader2 size={14} className="animate-spin" /> : 'Confirm Top-Up'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: History */}
      {showHistoryModal && selectedWallet && createPortal(
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg overflow-hidden space-y-4 p-5 max-h-[85vh] flex flex-col" style={{ boxShadow: 'var(--shadow-modal)' }}>
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

            {walletHistoryCapped && (
              <div className="text-[10px] font-mono text-[var(--color-accent-amber)] shrink-0">
                Showing the most recent 5,000 entries — older history exists but isn't shown here.
              </div>
            )}

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
                walletHistory.map((tx) => {
                  // top_up / refund / adjustment / retrieval_refund / reversal
                  // all move the balance UP; deduction / cash_payout move it
                  // down. (Previously plain 'refund'/'adjustment' credits
                  // rendered as red '-₦…' -- fixed here alongside 'reversal'.)
                  const isCredit = tx.type === 'top_up' || tx.type === 'refund' || tx.type === 'adjustment' || tx.type === 'retrieval_refund' || tx.type === 'reversal';
                  // A retrieval clawback or a wallet-settled debt is undone
                  // from the shipment (Unretrieve / Reopen Debt), not here --
                  // reverse_wallet_deduction() refuses them, so don't offer
                  // the button.
                  const canUndo = tx.type === 'deduction' && !tx.reversed_at && tx.status === 'completed' && canApprovePayouts
                    && !tx.cargo_entry_id
                    && !(tx.description || '').startsWith('Retrieval reversal')
                    && tx.description !== 'Debt settled from wallet';
                  return (
                  <div
                    key={tx.id}
                    className="p-3 bg-[var(--color-surface-2)] rounded-xl border border-[var(--color-border)] flex items-center justify-between gap-3 text-[11px]"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 font-bold">
                        {tx.type === 'top_up' ? (
                          <span className={`flex items-center gap-1 ${tx.status === 'rejected' ? 'text-[var(--color-muted)] line-through' : tx.status === 'pending' ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-success)]'}`}>
                            <ArrowDownLeft size={12} /> TOP-UP{tx.status === 'pending' ? ' (PENDING)' : tx.status === 'rejected' ? ' (REJECTED)' : ''}
                          </span>
                        ) : tx.type === 'deduction' ? (
                          <span className={`flex items-center gap-1 ${tx.reversed_at ? 'text-[var(--color-muted)] line-through' : 'text-[var(--color-error)]'}`}>
                            <ArrowUpRight size={12} /> DEDUCTION{tx.reversed_at ? ' (REVERSED)' : ''}
                          </span>
                        ) : tx.type === 'cash_payout' ? (
                          <span className={`flex items-center gap-1 ${tx.status === 'rejected' ? 'text-[var(--color-muted)] line-through' : tx.status === 'pending' ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-error)]'}`}>
                            <HandCoins size={12} /> CASH PAYOUT{tx.status === 'pending' ? ' (PENDING)' : tx.status === 'rejected' ? ' (REJECTED)' : ''}
                          </span>
                        ) : tx.type === 'retrieval_refund' ? (
                          <span className={`flex items-center gap-1 ${tx.status === 'rejected' ? 'text-[var(--color-muted)] line-through' : tx.status === 'pending' ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-success)]'}`}>
                            <ArrowDownLeft size={12} /> RETRIEVAL REFUND{tx.status === 'pending' ? ' (PENDING)' : tx.status === 'rejected' ? ' (REJECTED)' : ''}
                          </span>
                        ) : tx.type === 'reversal' ? (
                          <span className="flex items-center gap-1 text-[var(--color-success)]">
                            <Undo2 size={12} /> REVERSAL
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
                      {tx.type === 'deduction' && tx.reversed_at && (
                        <div className="text-[9px] font-mono text-[var(--color-muted)]">
                          Reversed {new Date(tx.reversed_at).toLocaleDateString('en-GB')}{tx.reversed_by ? ` · ${tx.reversed_by}` : ''}
                        </div>
                      )}
                      {canUndo && (
                        <button
                          onClick={() => handleReverseDeduction(tx)}
                          disabled={reversingTxId === tx.id}
                          className="mt-1 py-1 px-2 inline-flex items-center justify-center gap-1 bg-[rgba(239,68,68,0.08)] hover:bg-[var(--color-error)] hover:text-white text-[var(--color-error)] rounded-lg transition-colors border border-[rgba(239,68,68,0.25)] text-[10px] font-mono font-bold disabled:opacity-50"
                          title="Refund this deduction and put the shipment back to owing (unpaid Debt)"
                        >
                          {reversingTxId === tx.id ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />} Undo
                        </button>
                      )}
                    </div>

                    <div className="text-right shrink-0 space-y-0.5">
                      <div
                        className={`font-mono font-bold text-[12px] ${
                          ((tx.type === 'top_up' || tx.type === 'retrieval_refund') && tx.status !== 'completed')
                            || (tx.type === 'cash_payout' && tx.status !== 'completed')
                            || tx.reversed_at
                            ? 'text-[var(--color-muted)] line-through'
                            : isCredit ? 'text-[var(--color-success)]'
                            : 'text-[var(--color-error)]'
                        }`}
                      >
                        {isCredit ? '+' : '-'}₦{fmt(tx.amount)}
                      </div>
                      <div className="text-[9px] font-mono text-[var(--color-muted)]">
                        {tx.status === 'pending' ? 'Balance not yet affected' : `Bal after: ₦${fmt(tx.balance_after)}`}
                      </div>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Request Cash Payout */}
      {payoutWalletId && (() => {
        const wallet = wallets.find((w) => w.id === payoutWalletId);
        if (!wallet) return null;
        return createPortal(
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-sm overflow-hidden space-y-4 p-5" style={{ boxShadow: 'var(--shadow-modal)' }}>
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
                className="w-full h-11 bg-[var(--color-accent-amber)] text-[var(--color-on-accent)] rounded-lg text-[12px] font-mono font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <HandCoins size={14} /> {savingPayout ? 'Requesting...' : 'Request Cash Payout'}
              </button>
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
  );
};
