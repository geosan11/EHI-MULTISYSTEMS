import { useState, useEffect, useRef, useMemo } from "react";
import { useEnterToNextField } from "../../lib/useEnterToNextField";
import { User, Transaction, Expense } from "../../lib/types";
import { fmt, uid, tnow, generatePaymentNarration, getHubCode, upperOnChange, isStandalonePWA } from "../../lib/helpers";
import { chargeWalletForSale } from "../../lib/walletPayment";
import { matchWallet } from "../../lib/customerIdentity";
import { WalletRemainderSelector } from "../WalletRemainderSelector";
import { useHubRoutes, useValidatedRouteSelection, useHubs } from "../../lib/hubRoutes";
import { useContentTypes } from "../../lib/contentTypes";
import { useExpenseCategories } from "../../lib/expenseCategories";
import { useBanks } from "../../lib/banks";
import {  MIN_PACKAGE_AMOUNT , CARGO_ROUTES } from "../../lib/constants";
import { getNextTag } from "../../lib/tagPool";
import { Plus, CheckCircle, Loader2, ClipboardList, BarChart2, Printer, MessageSquare, Bluetooth } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { sendReceiptWhatsApp, buildPackageWhatsApp } from "../../lib/notifications";
import { useToast } from "../../lib/ToastContext";
import { useConfirm } from "../../lib/ConfirmContext";
import { EmptyState } from "./EmptyState";
import { CustomerWalletPicker } from "../CustomerWalletPicker";
import { CustomerWallet } from "../../lib/types";
import { ReviewEntryModal } from "./ReviewEntryModal";
import { TerminalSwitch, usePersistedTerminal } from "../TerminalSwitch";
import { DepartmentSalesAnalysisModal } from "../DepartmentSalesAnalysis";

export const PackageForm = ({
  user: propUser,
  transactions,
  expenses,
  onAddTx,
  onAddExpense,
  onShowHistory,
  customerWallets = [],
  setCustomerWallets,
  forcedTerminal,
}: {
  user: User;
  transactions: Transaction[];
  expenses: Expense[];
  onAddTx: (tx: Transaction) => void;
  onAddExpense: (exp: Expense) => void;
  onShowHistory?: () => void;
  customerWallets?: CustomerWallet[];
  setCustomerWallets?: React.Dispatch<React.SetStateAction<CustomerWallet[]>>;
  // Set by GatWorkspace.tsx to pin this form's terminal to 'GAT' for as
  // long as it's mounted there -- see CargoForm.tsx's identical prop.
  forcedTerminal?: 'MMA2' | 'GAT';
}) => {
  const isAdmin = ['super_admin', 'admin', 'accountant'].includes(propUser.role);
  // See CargoForm.tsx's identical fix for the full explanation: this used
  // to default to the raw propUser.hub_id (a UUID) and be sourced from
  // CARGO_ROUTES route-display-strings, corrupting both user.hub (shown as
  // a garbled "74D"-style code via getHubCode()) and user.hub_id (a
  // Postgres uuid column rejects a "LOS/Lagos" string) once an admin
  // picked anything from the dropdown.
  const hubList = useHubs();
  const [adminSelectedHubId, setAdminSelectedHubId] = useState<string>(propUser.hub_id || '');
  const selectedHubRecord = hubList.find(h => h.id === adminSelectedHubId);
  const user = isAdmin
    ? {
        ...propUser,
        hub_id: adminSelectedHubId || propUser.hub_id,
        hub: selectedHubRecord?.name || propUser.hub,
        hub_code: selectedHubRecord?.code || propUser.hub_code,
      }
    : propUser;
  // GAT (General Aviation Terminal / MM1) is a second physical Lagos counter,
  // not a new hub -- only show the switch to LOS-hub agents.
  const userHubCode = getHubCode(user.hub_code || user.hub);
  const [terminal, setTerminal] = usePersistedTerminal(forcedTerminal);

  // Destinations are the live hub list from Supabase (not a hardcoded
  // constant) so a new hub added in Settings shows up here immediately --
  // each option is prefixed with its IATA-style hub code for consistency
  // with the Cargo/ValueJet route pickers. Cached to localStorage for an
  // instant first paint / offline fallback while the fetch is in flight.
  // No 'Other' option and no bundled-constant cold fallback, matching this
  // form's original behavior exactly.
  const { showToast } = useToast();
  const confirm = useConfirm();
  const destinations = useHubRoutes({ includeOther: false, coldFallback: false });
  const contentTypes = useContentTypes();

  const [trackingRef, setTrackingRef] = useState<string>('');
  useEffect(() => {
    // Tracking numbers are allocated atomically server-side, keyed per hub
    // with a "-PKG" suffix on the same counter cargo and marketing use, so
    // two agents can never be issued the same one. Popped from the local
    // tag pool (src/lib/tagPool.ts) rather than a direct RPC call -- a
    // pure local operation once the pool's been reserved while online, so
    // it works offline too, still guaranteed unique.
    const allocate = async () => {
      const hubCode = getHubCode(user.hub_code || user.hub);
      const tag = await getNextTag(`${hubCode}-PKG`, `EHI-${hubCode}-PKG`);
      if (tag) {
        setTrackingRef(tag);
      } else {
        setTrackingRef('');
        showToast({ message: 'No tracking number available offline. Connect to the internet briefly to reserve more, then try again.', type: 'error' });
      }
    };
    allocate();
  }, []);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // Left empty rather than defaulting to destinations[0] -- a pre-filled
  // dropdown looks like a deliberate choice, so staff could submit against
  // whatever destination happened to be first without ever consciously
  // picking it. isValid above already requires it explicitly.
  const [destination, setDestination] = useState<string>('');
  useValidatedRouteSelection(destinations, destination, setDestination);
  const [contentType, setContentType] = useState<'Package' | 'Parcel'>('Package');
  // Pieces/weight/contents were never captured for this stream at all --
  // every other business line (Cargo, Marketing, ValueJet) tracks these, and
  // reuses the same shared content-types list as Cargo rather than a new
  // hardcoded one, so this scales the same way the rest of the app does.
  const [pcs, setPcs] = useState("1");
  const [kg, setKg] = useState("");
  // Left empty rather than defaulting to contentTypes[0] -- same reasoning
  // as destination above. isValid now requires actualContents explicitly.
  const [contents, setContents] = useState<string>('');
  const [customContents, setCustomContents] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<string>("Cash");
  const banks = useBanks();
  const [bank, setBank] = useState<string>(banks[0]);
  const [debtorName, setDebtorName] = useState("");
  const [narrationCode, setNarrationCode] = useState<string>("");

  useEffect(() => {
    if ((mode === "Transfer" || mode === "POS") && !narrationCode) {
      setNarrationCode(generatePaymentNarration(user.hub_code || user.hub, Math.floor(Math.random() * 9000) + 1000));
    }
  }, [mode, narrationCode, user.hub, user.hub_code]);

  const [successTx, setSuccessTx] = useState<Transaction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPackageReview, setShowPackageReview] = useState(false);

  const expenseCategoryNames = useExpenseCategories().map(c => c.name);
  const [expType, setExpType] = useState<string>('');
  useEffect(() => {
    if (expenseCategoryNames.length > 0 && !expenseCategoryNames.includes(expType)) setExpType(expenseCategoryNames[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseCategoryNames]);
  const [expAmount, setExpAmount] = useState("");
  const [expDesc, setExpDesc] = useState("");

  // "Other" in the Contents dropdown needs a free-text fallback, same
  // pattern CargoForm.tsx already uses for customConsignee/customAirline --
  // otherwise the ledger would literally record the word "Other" instead
  // of what the agent actually typed.
  const actualContents = contents === "Other" ? customContents : contents;
  const parsedAmount = parseFloat(amount) || 0;
  const pcsNum = parseInt(pcs) || 0;
  const kgNum = parseFloat(kg) || 0;
  // actualContents wasn't required at all before -- contents defaulting to
  // contentTypes[0] made it always truthy, so this never actually bit;
  // now that it starts empty, it needs an explicit check like destination
  // already has.
  const isValid = (mode === "Debt" ? debtorName.trim().length > 0 : name.trim().length > 0)
    && parsedAmount >= MIN_PACKAGE_AMOUNT && destination.trim().length > 0 && actualContents.trim().length > 0 && !!trackingRef && pcsNum > 0;

  // "Today" here means the actual calendar day, not whatever the app-wide
  // date-range picker (globalDateRange, defaults to a trailing 7 days) is
  // currently set to -- transactions/expenses are fetched against that
  // wider range, so without this filter every panel below silently sums
  // up to a week of activity and End Day would record that week's total
  // as a single day's close.
  const todayStr = new Date().toISOString().split('T')[0];
  const isToday = (createdAt?: string) => !!createdAt && createdAt.split('T')[0] === todayStr;

  const packageTxs = transactions.filter((t) => t.type === "package" && isToday(t.created_at));
  const totalSales = packageTxs.reduce((sum, t) => sum + t.amount, 0);
  const cashSales = packageTxs.reduce((sum, t) => sum + (t.mode === "Cash" ? t.amount : 0), 0);
  const posSales = packageTxs.reduce((sum, t) => sum + (t.mode === "POS" ? t.amount : 0), 0);
  const transferSales = packageTxs.reduce((sum, t) => sum + (t.mode === "Transfer" ? t.amount : 0), 0);
  const debtSales = packageTxs.reduce((sum, t) => sum + (t.mode === "Debt" ? t.amount : 0), 0);
  const debtCashRecoveredToday = packageTxs.reduce((sum, t) => {
    if (!t.paymentHistory) return sum;
    const todays = t.paymentHistory.filter(p => p.mode === 'Cash' && p.at && isToday(p.at));
    return sum + todays.reduce((s, p) => s + p.amount, 0);
  }, 0);
  const debtTotalRecoveredToday = packageTxs.reduce((sum, t) => {
    if (!t.paymentHistory) return sum;
    const todays = t.paymentHistory.filter(p => p.at && isToday(p.at));
    return sum + todays.reduce((s, p) => s + p.amount, 0);
  }, 0);
  const totalExpenses = expenses.filter(e => isToday(e.created_at)).reduce((sum, e) => sum + e.amount, 0);
  const physicalCash = cashSales + debtCashRecoveredToday;
  const balanceCash = physicalCash - totalExpenses;

  const destinationCounts: Record<string, number> = {};
  packageTxs.forEach(t => {
    const d = t.destination || 'Unknown';
    destinationCounts[d] = (destinationCounts[d] || 0) + 1;
  });

  // Balance-based, not just !debtPaid -- a payment recorded via DebtorsTab
  // (used generically by every stream) only ever touches amountPaid/mode,
  // never this component's own debtPaid flag, so checking debtPaid alone
  // left debts paid off elsewhere still showing as unpaid here.
  const unpaidDebts = packageTxs.filter(t => t.mode === 'Debt' && (t.amount - (t.amountPaid || 0)) > 0);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showSalesAnalysis, setShowSalesAnalysis] = useState(false);
  const [closingDay, setClosingDay] = useState(false);

  const [selectedWalletOverride, setSelectedWalletOverride] = useState<CustomerWallet | null>(null);
  const [walletRemainderMode, setWalletRemainderMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');
  const [walletRemainderBank, setWalletRemainderBank] = useState('');
  const activeWallet = useMemo(() => {
    if (selectedWalletOverride) return selectedWalletOverride;
    return matchWallet(customerWallets, name, phone);
  }, [name, phone, customerWallets, selectedWalletOverride]);

  const handleAddEntry = async () => {
    if (parsedAmount < MIN_PACKAGE_AMOUNT) {
      showToast({ message: `Amount must be at least ₦${MIN_PACKAGE_AMOUNT.toLocaleString()}`, type: 'warning' });
      return;
    }
    if (!isValid || submitting) return;
    setSubmitting(true);

    const tx: Transaction = {
      id: trackingRef,
      name: mode === "Debt" ? debtorName.trim() : name.trim(),
      detail: `${destination} · ${contentType} · ${pcsNum}pcs · ${kgNum}kg · ${actualContents}`,
      amount: parsedAmount,
      mode,
      bank: (mode === "Transfer" || mode === "POS") ? bank : undefined,
      paymentNarration: (mode === "Transfer" || mode === "POS") ? narrationCode : undefined,
      time: tnow(),
      created_at: new Date().toISOString(),
      type: "package",
      status: "Intake",
      destination,
      contentType,
      pieces: pcsNum,
      kg: kgNum,
      contents: actualContents,
      hub: user.hub,
      hub_id: user.hub_id,
      enteredByName: user.name,
      debtPaid: mode === "Debt" ? false : undefined,
      terminal,
      // Was captured into local form state only and never attached to the
      // Transaction itself -- package_entries had nowhere to store it, so
      // it was silently lost the moment this session ended, and any later
      // reprint from the ledger always showed a blank phone.
      consigneePhone: phone.trim() || undefined,
    };

    // Wallet payment — AUTO-SPLIT. Wallet covers what it can; any remainder is
    // collected by the chosen Cash/Transfer/POS method and recorded as the
    // receipt_mode, so the till isn't silently short. EOD nets
    // wallet_deduction_amount out of the cash/transfer/POS totals.
    if (mode === "Wallet" && activeWallet) {
      const charge = await chargeWalletForSale({
        wallet: activeWallet,
        amount: parsedAmount,
        cargoRef: trackingRef,
        description: `Package Consignment ${trackingRef}`,
        loggedBy: user.name,
      });
      if (!charge.ok) {
        showToast({ message: `Wallet deduction failed: ${charge.error}. Entry was not logged.`, type: 'error' });
        setSubmitting(false);
        return;
      }
      // Guard: a short wallet needs a remainder method (Cash needs nothing;
      // Transfer/POS need a bank/terminal reference).
      if (charge.remainder > 0 && (walletRemainderMode === 'Transfer' || walletRemainderMode === 'POS') && !walletRemainderBank.trim()) {
        showToast({ message: `Enter the bank/terminal for the ₦${fmt(charge.remainder)} remainder.`, type: 'warning' });
        setSubmitting(false);
        return;
      }
      tx.wallet_id = activeWallet.id;
      tx.wallet_deduction_amount = charge.walletDeduction;
      (tx as any).wallet_balance_before = activeWallet.balance;
      (tx as any).wallet_balance_after = charge.newBalance;
      if (charge.remainder > 0) {
        tx.mode = walletRemainderMode;
        tx.bank = (walletRemainderMode === 'Transfer' || walletRemainderMode === 'POS') ? walletRemainderBank.trim() : undefined;
      }

      if (setCustomerWallets) {
        setCustomerWallets(prev => prev.map(w => w.id === activeWallet.id ? { ...w, balance: charge.newBalance! } : w));
      }
      showToast({
        message: charge.remainder > 0
          ? `₦${fmt(charge.walletDeduction)} from ${activeWallet.customer_name}'s wallet · ₦${fmt(charge.remainder)} by ${walletRemainderMode}. Balance: ₦${fmt(charge.newBalance!)}`
          : `💰 ₦${fmt(charge.walletDeduction)} deducted from ${activeWallet.customer_name}'s Credit Wallet. Remaining Balance: ₦${fmt(charge.newBalance!)}`,
        type: 'success'
      });
    }

    setSuccessTx(tx);
    setSubmitting(false);
    onAddTx(tx);

    if (phone.trim().length > 0) {
      sendReceiptWhatsApp({
        phone: phone.trim(),
        ref: tx.id,
        message: buildPackageWhatsApp({
          ref: tx.id,
          customer: tx.name,
          destination,
          contentType,
          amount: parsedAmount,
          mode,
          bank: (mode === "Transfer" || mode === "POS") ? bank : undefined,
          paymentNarration: (mode === "Transfer" || mode === "POS") ? narrationCode : undefined,
        }),
      });
    }
  };

  const handleReset = () => {
    setName("");
    setPhone("");
    setDebtorName("");
    setPcs("1");
    setKg("");
    setContents(contentTypes[0]);
    setCustomContents("");
    setAmount("");
    setMode("Cash");
    setNarrationCode("");
    setSuccessTx(null);
    // Cleared synchronously, not just reassigned once the RPC below
    // resolves -- setSuccessTx(null) above immediately returns to the
    // enterable form, but trackingRef previously stayed equal to the
    // JUST-USED ref until the new one arrived. isValid only checks
    // !!trackingRef (truthy), not freshness, so a fast agent (or a slow/
    // failed RPC) could submit a second entry during that window with the
    // same tracking ref as the first -- package_entries is upserted on
    // entry_ref (sync.ts), so the second submission silently overwrote the
    // first one's row, losing a sale that was already collected.
    setTrackingRef('');
    const hubCodeReset = getHubCode(user.hub_code || user.hub);
    getNextTag(`${hubCodeReset}-PKG`, `EHI-${hubCodeReset}-PKG`).then(tag => {
      if (tag) {
        setTrackingRef(tag);
      } else {
        setTrackingRef('');
        showToast({ message: 'No tracking number available offline. Connect to the internet briefly to reserve more, then try again.', type: 'error' });
      }
    });
  };

  const handleAddExpense = () => {
    const amt = parseFloat(expAmount);
    if (!amt || amt <= 0) {
      showToast({ message: 'Enter an expense amount greater than zero.', type: 'warning' });
      return;
    }
    onAddExpense({ id: uid('EX' as any), type: expType, amount: amt, description: expDesc.trim(), time: tnow() });
    setExpAmount("");
    setExpDesc("");
  };

  const handleMarkDebtPaid = (tx: Transaction) => {
    // Mirrors DebtorsTab.handleRecordPayment's full-payoff case (amountPaid/
    // paymentHistory/mode) so a debt marked paid here is also correctly
    // reflected there, instead of only flipping the package-specific
    // debtPaid flag DebtorsTab never looks at. debtPaid/debtPaidAt are kept
    // too, for anything still relying on them.
    const historyEntry = { amount: tx.amount - (tx.amountPaid || 0), mode: 'Cash' as const, by: user.name || 'Unknown', at: new Date().toISOString() };
    onAddTx({
      ...tx,
      debtPaid: true,
      debtPaidAt: new Date().toISOString(),
      amountPaid: tx.amount,
      paymentHistory: [...(tx.paymentHistory || []), historyEntry],
      mode: 'Debt Paid',
    });
  };

  const handleCloseDay = async () => {
    if (closingDay) return;
    const ok = await confirm({
      title: 'Close Package Desk session?',
      message: "Close today's Package Desk session? This cannot be undone.",
      confirmLabel: 'Close Day',
      tone: 'danger',
    });
    if (!ok) return;
    setClosingDay(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from('package_day_close').upsert({
        hub_id: user.hub_id,
        hub: user.hub,
        date: today,
        total_sales: totalSales,
        cash_sales: cashSales,
        pos_sales: posSales,
        transfer_sales: transferSales,
        debt_sales: debtSales,
        total_expenses: totalExpenses,
        balance_cash: balanceCash,
        entry_count: packageTxs.length,
        destination_counts: destinationCounts,
        closed_by: user.name,
        closed_at: new Date().toISOString(),
      }, { onConflict: 'hub_id,date' });
      if (error) throw error;
      showToast({ message: 'Day closed successfully', type: 'success' });
      setShowCloseModal(false);
    } catch (err: any) {
      showToast({ message: 'Failed to close day: ' + err.message, type: 'error' });
    } finally {
      setClosingDay(false);
    }
  };

  const focusClasses = "focus:outline-none focus:ring-2 focus:ring-[rgba(59,130,246,0.5)] focus:border-[rgba(59,130,246,0.5)] transition-colors";

  const formRootRef = useRef<HTMLDivElement>(null);
  useEnterToNextField(formRootRef);

  return (
    <div ref={formRootRef} className="p-4 max-w-5xl mx-auto" style={{ width: "100%", boxSizing: "border-box", minHeight: 0, flex: 1 }}>
      
      {isAdmin && (
        <div className="mb-4 p-3 max-w-[220px] bg-[var(--color-surface-2)] rounded-lg border border-[var(--color-accent-amber)] border-opacity-30 animate-in fade-in">
           <label className="text-[10px] uppercase font-bold text-[var(--color-accent-amber)] mb-1 block flex items-center gap-1">
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
             Admin: Global Hub Context
           </label>
           <select value={adminSelectedHubId} onChange={(e) => setAdminSelectedHubId(e.target.value)} className="w-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] font-bold text-[13px] p-2 rounded border border-[var(--color-border)] focus:border-[var(--color-accent-amber)] focus:outline-none cursor-pointer">
             {hubList.map(h => <option key={h.id} value={h.id}>{h.code}/{h.name}</option>)}
           </select>
        </div>
      )}

      <div className="flex justify-between items-center text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-widest border-b border-[var(--color-border)] pb-2 mb-6">
        <div>{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
        <div className="flex items-center gap-3">
          {userHubCode === 'LOS' && !forcedTerminal && <TerminalSwitch value={terminal} onChange={setTerminal} />}
          <button onClick={() => setShowSalesAnalysis(true)} className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] rounded-lg text-[11px] font-mono text-[var(--color-muted)] hover:text-[var(--color-accent-amber)] hover:border-[var(--color-accent-amber)] transition-colors normal-case tracking-normal">
            <BarChart2 size={14} /> <span>Sales Analysis</span>
          </button>
          {onShowHistory && (
            <button onClick={onShowHistory} className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] rounded-lg text-[11px] font-mono text-[var(--color-muted)] hover:text-[var(--color-accent-cobalt)] hover:border-[var(--color-accent-cobalt)] transition-colors normal-case tracking-normal">
              <ClipboardList size={14} /> <span>History</span>
            </button>
          )}
          <div>Agent: {user.name.split(" ")[0]}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_280px]">
        <div className="space-y-6">
          {successTx ? (
            <div className="bg-[rgba(59,130,246,0.05)] border border-[rgba(59,130,246,0.2)] rounded p-6 md:p-8 flex flex-col animate-in fade-in zoom-in-95 duration-200">
              <div className="flex justify-center">
                <CheckCircle size={32} className="text-[var(--color-accent-cobalt)] mb-3" />
              </div>
              <div className="text-[11px] font-mono text-[var(--color-accent-cobalt)] uppercase tracking-widest mb-1 text-center">ENTRY RECORDED</div>
              <div className="text-[14px] font-bold font-mono text-[var(--color-accent-cobalt)] mb-4 uppercase text-center">REF: {successTx.id}</div>

              <div className="bg-[var(--color-obsidian)] rounded p-3 mb-4 space-y-2 border border-[var(--color-border)]">
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1">
                  <span className="text-[10px] font-mono text-[var(--color-muted)]">Customer</span>
                  <span className="text-[11px] font-mono text-[var(--color-foreground)]">{successTx.name}</span>
                </div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1">
                  <span className="text-[10px] font-mono text-[var(--color-muted)]">Destination / Type</span>
                  <span className="text-[11px] font-mono text-[var(--color-foreground)]">{successTx.detail}</span>
                </div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1">
                  <span className="text-[10px] font-mono text-[var(--color-muted)]">Amount</span>
                  <span className="text-[12px] font-bold font-mono text-[var(--color-accent-cobalt)]">{fmt(successTx.amount)}</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-[10px] font-mono text-[var(--color-muted)]">Payment</span>
                  <span className="text-[11px] font-mono text-[var(--color-foreground)]">{successTx.mode} {successTx.bank && `(${successTx.bank})`}</span>
                </div>
              </div>

              <button onClick={handleReset} className="w-full py-3 mb-2 bg-[var(--color-surface-1)] text-[var(--color-foreground)] text-[11px] font-bold font-mono rounded cursor-pointer flex justify-center items-center gap-2 border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]">
                <Plus size={14} /> NEW ENTRY
              </button>

              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  onClick={() => {
                    import('../../lib/escpos').then(async ({ printViaBluetooth }) => {
                      await printViaBluetooth(async () => {
                        const m = await import('../../lib/escposPackagePrinting');
                        const printData = {
                          entryRef: successTx.id,
                          date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
                          agentName: user.name,
                          customerName: successTx.name,
                          phone: phone || undefined,
                          destination,
                          contentType,
                          pieces: successTx.pieces,
                          kg: successTx.kg,
                          contents: successTx.contents,
                          amount: successTx.amount,
                          paymentMode: successTx.mode,
                          paymentNarration: successTx.paymentNarration,
                          bankName: bank || undefined,
                          trackingUrl: `https://app.ehimultisystems.com/track/${successTx.id}`,
                        };
                        return await m.compilePackageReceiptStream(printData, '80mm');
                      });
                    }).catch((err: any) => {
                      console.error('Bluetooth print failed:', err);
                      showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
                    });
                  }}
                  className="py-2.5 bg-[var(--color-accent-cobalt)] text-white text-[11px] font-bold font-mono rounded cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-opacity-95 border-none"
                >
                  <Bluetooth size={14} className="mb-0.5" />
                  <span>PRINT POS (80mm)</span>
                </button>

                <button
                  onClick={() => {
                    import('../../lib/escpos').then(async ({ printViaBluetooth }) => {
                      await printViaBluetooth(async () => {
                        const m = await import('../../lib/escposPackagePrinting');
                        const printData = {
                          entryRef: successTx.id,
                          date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
                          agentName: user.name,
                          customerName: successTx.name,
                          phone: phone || undefined,
                          destination,
                          contentType,
                          pieces: successTx.pieces,
                          kg: successTx.kg,
                          contents: successTx.contents,
                          amount: successTx.amount,
                          paymentMode: successTx.mode,
                          paymentNarration: successTx.paymentNarration,
                          bankName: bank || undefined,
                          trackingUrl: `https://app.ehimultisystems.com/track/${successTx.id}`,
                        };
                        return await m.compilePackageReceiptStream(printData, '58mm');
                      });
                    }).catch((err: any) => {
                      console.error('Bluetooth print failed:', err);
                      showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
                    });
                  }}
                  className="py-2.5 bg-[var(--color-accent-cobalt)] bg-opacity-80 text-white text-[11px] font-bold font-mono rounded cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-opacity-95 border-none"
                >
                  <Bluetooth size={14} className="mb-0.5" />
                  <span>PRINT POS (58mm)</span>
                </button>
              </div>

              <button
                onClick={() => {
                  import('./PackageReceipt').then(m => m.downloadPackageReceipt({
                    entryRef: successTx.id,
                    date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
                    agentName: user.name,
                    customerName: successTx.name,
                    phone: phone || undefined,
                    destination,
                    contentType,
                    pieces: successTx.pieces,
                    kg: successTx.kg,
                    contents: successTx.contents,
                    amount: successTx.amount,
                    paymentMode: successTx.mode,
                    paymentNarration: successTx.paymentNarration,
                    bankName: bank || undefined,
                  }));
                }}
                className="w-full py-3 bg-transparent border border-[rgba(59,130,246,0.3)] rounded-lg cursor-pointer text-[11px] font-bold font-mono text-[var(--color-accent-cobalt)] flex items-center justify-center gap-2"
              >
                <Printer size={14} /> PRINT RECEIPT (PDF)
              </button>

              <button
                onClick={async () => {
                  const preOpenedWindow = isStandalonePWA() ? null : window.open('', '_blank');
                  showToast({ message: 'Generating tag PDF…', type: 'info' });
                  try {
                    const { printPackageTagPDF } = await import('./PackageTagPDF');
                    await printPackageTagPDF({
                      id: successTx.id,
                      name: successTx.name,
                      destination,
                      contentType,
                      pieces: successTx.pieces,
                      kg: successTx.kg,
                      contents: successTx.contents,
                      hubName: user?.hub || "EHI Station",
                      date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
                    }, preOpenedWindow);
                  } catch (err) {
                    console.error('Failed to open tag PDF', err);
                    preOpenedWindow?.close();
                    showToast({ message: 'Failed to open tag PDF', type: 'error' });
                  }
                }}
                className="w-full mt-2 py-3 bg-transparent border border-[rgba(59,130,246,0.3)] rounded-lg cursor-pointer text-[11px] font-bold font-mono text-[var(--color-accent-cobalt)] flex items-center justify-center gap-2 hover:bg-[rgba(59,130,246,0.05)]"
                title="Fixed 100mm x 80mm label -- for thermal label printers or browser print"
              >
                <Printer size={14} /> PRINT TAG (PDF)
              </button>
            </div>
          ) : (
            <div className="space-y-4 bg-[rgba(255,255,255,0.02)] p-4 md:mx-0 md:rounded-xl md:border border-y border-[var(--color-border)]">
              <div className="border-b border-[var(--color-border)] pb-1 mb-2">
                <span style={{ fontFamily: "JetBrains Mono", fontSize: 10, color: "var(--color-accent-cobalt)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  ▸ NEW PACKAGE / PARCEL ENTRY
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between px-3 h-9 rounded bg-[var(--color-surface-1)] border border-[rgba(59,130,246,0.2)]">
                  <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Tracking Ref</span>
                  <span className="text-[11px] font-mono text-[var(--color-accent-cobalt)] font-bold">{trackingRef || 'Allocating...'}</span>
                </div>

                {mode !== "Debt" && (
                  <>
                    <input
                      id="pkg-name"
                      name="name"
                      placeholder="Customer Name"
                      value={name}
                      onChange={upperOnChange(setName)}
                      className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${focusClasses}`}
                    />
                    <div className="relative">
                      <MessageSquare size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
                      <input
                        id="pkg-phone"
                        name="phone"
                        type="tel"
                        placeholder="Phone (required)"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className={`w-full h-11 pl-9 pr-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${focusClasses}`}
                      />
                    </div>
                  </>
                )}

                <div className="flex space-x-3">
                  <select
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    className={`flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans min-w-0 ${focusClasses}`}
                  >
                    <option value="" disabled>-- Select Destination --</option>
                    {destinations.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value as 'Package' | 'Parcel')}
                    className={`flex-1 h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans min-w-0 ${focusClasses}`}
                  >
                    <option value="Package">Package</option>
                    <option value="Parcel">Parcel</option>
                  </select>
                </div>

                <div className="flex space-x-3">
                  <input
                    id="pkg-pcs"
                    name="pcs"
                    type="number"
                    min="1"
                    placeholder="Pcs"
                    value={pcs}
                    onChange={(e) => setPcs(e.target.value)}
                    className={`flex-1 h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans min-w-0 ${focusClasses}`}
                  />
                  <input
                    id="pkg-kg"
                    name="kg"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="KG (optional)"
                    value={kg}
                    onChange={(e) => setKg(e.target.value)}
                    className={`flex-1 h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans min-w-0 ${focusClasses}`}
                  />
                </div>

                <select
                  value={contents}
                  onChange={(e) => setContents(e.target.value)}
                  className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${focusClasses}`}
                >
                  <option value="" disabled>-- Select Contents --</option>
                  {contentTypes.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {contents === "Other" && (
                  <input
                    id="pkg-custom-contents"
                    name="custom-contents"
                    placeholder="Enter content type"
                    value={customContents}
                    onChange={upperOnChange(setCustomContents)}
                    className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${focusClasses}`}
                  />
                )}

                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as any)}
                  className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${focusClasses}`}
                >
                  <option value="Cash">Cash</option>
                  <option value="POS">POS</option>
                  <option value="Transfer">Bank Transfer</option>
                  <option value="Wallet">💰 Customer Credit Wallet</option>
                  <option value="Debt">Debt / Credit</option>
                </select>

                {mode === "Wallet" && (
                  <div className="mb-3 space-y-2">
                    <CustomerWalletPicker
                      wallets={customerWallets}
                      selectedWallet={activeWallet}
                      onSelectWallet={(w) => setSelectedWalletOverride(w)}
                      currentCustomerName={name}
                    />
                    {activeWallet && activeWallet.balance < parsedAmount && (
                      <WalletRemainderSelector
                        walletName={activeWallet.customer_name}
                        coverage={activeWallet.balance}
                        remainder={parsedAmount - activeWallet.balance}
                        mode={walletRemainderMode}
                        bank={walletRemainderBank}
                        onModeChange={setWalletRemainderMode}
                        onBankChange={setWalletRemainderBank}
                      />
                    )}
                  </div>
                )}

                {(mode === "Transfer" || mode === "POS") && (
                  <select
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${focusClasses}`}
                  >
                    {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                )}

                {mode === "Debt" && (
                  <input
                    id="pkg-debtor-name"
                    name="debtor-name"
                    type="text"
                    placeholder="Debtor Name"
                    value={debtorName}
                    onChange={(e) => setDebtorName(e.target.value)}
                    className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${focusClasses}`}
                  />
                )}

                <div className="flex justify-between items-center py-2 bg-[var(--color-surface-1)] px-3 rounded border border-[var(--color-border)]">
                  <span className="text-[10px] font-mono text-[var(--color-light-muted)]">AMOUNT</span>
                  <div className="flex items-center">
                    <span className="text-[14px] font-bold font-mono text-[var(--color-muted)] mr-1">₦</span>
                    <input
                      id="pkg-amount"
                      name="amount"
                      type="number"
                      min="0"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0"
                      className="w-24 bg-transparent border-none text-right text-[18px] font-bold font-mono p-0 focus:ring-0 text-[var(--color-accent-cobalt)]"
                    />
                  </div>
                </div>
                {amount !== "" && parsedAmount < MIN_PACKAGE_AMOUNT && (
                  <p className="text-[11px] text-red-500 font-mono -mt-2">
                    ⚠ Minimum amount is ₦{MIN_PACKAGE_AMOUNT.toLocaleString()}
                  </p>
                )}

                <button
                  onClick={() => setShowPackageReview(true)}
                  disabled={!isValid || submitting}
                  className={`w-full py-3 rounded font-bold font-mono text-[12px] flex items-center justify-center gap-2 transition-all focus:outline-none ${
                    submitting ? "opacity-80 cursor-wait bg-[var(--color-accent-cobalt)] text-white"
                    : !isValid ? "bg-[var(--color-surface-2)] text-[var(--color-muted)] cursor-not-allowed"
                    : "bg-[var(--color-accent-cobalt)] text-white cursor-pointer hover:bg-opacity-90"
                  }`}
                >
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  {submitting ? "ADDING ENTRY..." : (<><Plus size={16} /> ADD ENTRY</>)}
                </button>
                {showPackageReview && (
                  <ReviewEntryModal
                    title="Review Package/Mail Entry"
                    details={[
                      { label: 'Customer', value: name },
                      { label: 'Content', value: actualContents },
                      { label: 'Amount', value: parseFloat(amount) || 0 },
                      { label: 'Payment Mode', value: mode === 'Debt' ? `Debt (${debtorName})` : mode },
                      // Surfaced right before confirming so a staff member
                      // can't silently submit under the wrong terminal --
                      // same reasoning as CargoForm's own review modal.
                      ...(userHubCode === 'LOS' && !forcedTerminal ? [{ label: 'Terminal', value: terminal }] : []),
                    ]}
                    onConfirm={() => {
                      setShowPackageReview(false);
                      handleAddEntry();
                    }}
                    onCancel={() => setShowPackageReview(false)}
                    confirmText="Log Package"
                    isSubmitting={submitting}
                  />
                )}
              </div>
            </div>
          )}

          {/* Expense Section */}
          <div className="space-y-4 pt-4 border-t border-[var(--color-border)] md:border-none md:pt-0">
            <div className="border-b border-[var(--color-border)] pb-1 mb-2">
              <span style={{ fontFamily: "JetBrains Mono", fontSize: 10, color: "var(--color-accent-cobalt)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                ▸ LOG EXPENSE
              </span>
            </div>
            <div className="flex space-x-2">
              <select value={expType} onChange={(e) => setExpType(e.target.value)} className={`flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${focusClasses}`}>
                {expenseCategoryNames.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <input id="pkg-exp-amount" name="exp-amount" type="number" min="0" placeholder="Amount" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} className={`w-[100px] h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${focusClasses}`} />
            </div>
            <div className="flex space-x-2">
              <input id="pkg-exp-desc" name="exp-desc" placeholder="Description (optional)" value={expDesc} onChange={upperOnChange(setExpDesc)} className={`flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${focusClasses}`} />
              <button onClick={handleAddExpense} disabled={!(parseFloat(expAmount) > 0)} className="h-11 px-4 bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[12px] font-mono font-bold rounded disabled:opacity-50 cursor-pointer hover:bg-[var(--color-surface-3)] transition-colors">
                LOG
              </button>
            </div>
          </div>

          {/* Unpaid Debtors */}
          {unpaidDebts.length > 0 && (
            <div className="bg-[rgba(249,115,22,0.05)] rounded-xl border border-[rgba(249,115,22,0.2)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[rgba(249,115,22,0.2)]">
                <span className="text-[10px] font-mono text-orange-400 uppercase tracking-widest font-bold">▸ UNPAID DEBTS TODAY</span>
              </div>
              <div className="divide-y divide-[rgba(249,115,22,0.1)]">
                {unpaidDebts.map((t) => (
                  <div key={t.id} className="flex justify-between items-center px-4 py-2.5">
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="text-[12px] font-bold text-[var(--color-foreground)] truncate">{t.name}</div>
                      <div className="text-[10px] font-mono text-[var(--color-muted)]">{t.detail}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[12px] font-bold font-mono text-orange-400">{fmt(t.amount)}</span>
                      <button onClick={() => handleMarkDebtPaid(t)} className="text-[9px] font-mono font-bold uppercase px-2 py-1 rounded bg-[rgba(16,185,129,0.1)] text-[var(--color-success)] border border-[rgba(16,185,129,0.25)] cursor-pointer hover:bg-[rgba(16,185,129,0.2)]">
                        Mark Paid
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column — Sales Analysis */}
        <aside className="space-y-4">
          <div className="sticky top-4 space-y-4">
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
                <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] uppercase tracking-widest font-bold">▸ SALES ANALYSIS</span>
                <span className="text-[10px] font-mono text-[var(--color-muted)]">{packageTxs.length} entries</span>
              </div>
              <div className="px-4 py-3 space-y-2 text-[12px] font-mono">
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Total Sales</span><span className="font-bold text-[var(--color-foreground)]">{fmt(totalSales)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Cash Sales</span><span className="text-[var(--color-foreground)]">{fmt(cashSales)}</span></div>
                {debtCashRecoveredToday > 0 && <div className="flex justify-between text-emerald-400"><span>Debt Recovered (Cash)</span><span>+ {fmt(debtCashRecoveredToday)}</span></div>}
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">POS</span><span className="text-[var(--color-foreground)]">{fmt(posSales)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Bank Transfer</span><span className="text-[var(--color-foreground)]">{fmt(transferSales)}</span></div>
                {debtSales > 0 && <div className="flex justify-between border-t border-[var(--color-border)] pt-1.5 mt-1"><span className="text-orange-400 font-sans">Unpaid Credit Sales (Owed)</span><span className="text-orange-400 font-bold">{fmt(debtSales)}</span></div>}
                {debtTotalRecoveredToday > 0 && <div className="flex justify-between"><span className="text-emerald-400 font-sans">Debt Collected Today</span><span className="text-emerald-400 font-bold">{fmt(debtTotalRecoveredToday)}</span></div>}
              </div>
            </div>

            <div className="bg-[rgba(59,130,246,0.05)] rounded-xl border border-[rgba(59,130,246,0.2)] px-4 py-3 space-y-1 text-[12px] font-mono">
              <div className="flex justify-between text-[var(--color-muted)]"><span>Cash in Hand (Sales + Recovered)</span><span>{fmt(physicalCash)}</span></div>
              <div className="flex justify-between text-red-400"><span>Expenses</span><span>− {fmt(totalExpenses)}</span></div>
              <div className="flex justify-between font-bold text-[15px] border-t border-[rgba(59,130,246,0.2)] pt-2 mt-1">
                <span className="text-[var(--color-accent-cobalt)]">Balance Cash</span>
                <span className={balanceCash >= 0 ? 'text-[var(--color-accent-cobalt)]' : 'text-red-400'}>{fmt(Math.abs(balanceCash))}{balanceCash < 0 ? ' (deficit)' : ''}</span>
              </div>
            </div>

            {Object.keys(destinationCounts).length > 0 && (
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)] overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
                  <BarChart2 size={12} className="text-[var(--color-accent-cobalt)]" />
                  <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] uppercase tracking-widest font-bold">DESTINATIONS TODAY</span>
                </div>
                <div className="px-4 py-3 space-y-1.5">
                  {Object.entries(destinationCounts).sort((a, b) => b[1] - a[1]).map(([d, cnt]) => (
                    <div key={d} className="flex justify-between items-center text-[12px] font-mono">
                      <span className="text-[var(--color-muted)] truncate mr-2">{d}</span>
                      <span className="font-bold text-[var(--color-foreground)] shrink-0">{cnt}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] uppercase tracking-widest font-bold">▸ ENTRIES TODAY</span>
              </div>
              {packageTxs.length === 0 ? (
                <EmptyState icon={<ClipboardList size={36} strokeWidth={1.5} />} message="No entries yet" />
              ) : (
                <div className="divide-y divide-[var(--color-border)] max-h-[340px] overflow-y-auto">
                  {[...packageTxs].reverse().map((t) => (
                    <div key={t.id} className="flex justify-between items-center px-4 py-2.5">
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="text-[12px] font-bold text-[var(--color-foreground)] truncate">{t.name}</div>
                        <div className="text-[10px] font-mono text-[var(--color-muted)]">{t.detail}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[12px] font-bold font-mono text-[var(--color-accent-cobalt)]">{fmt(t.amount)}</div>
                        <div className={`text-[9px] font-mono ${t.mode === 'Debt' ? 'text-orange-400' : 'text-[var(--color-muted)]'}`}>{t.mode}{t.bank ? ` · ${t.bank}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button onClick={() => setShowCloseModal(true)} className="w-full py-4 bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] text-[var(--color-accent-cobalt)] text-[12px] font-bold font-mono rounded-xl border border-[rgba(59,130,246,0.2)] transition-colors cursor-pointer">
              END DAY & SUBMIT
            </button>
          </div>
        </aside>
      </div>

      {showCloseModal && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
          <div style={{ background: "var(--color-obsidian)", width: "100%", maxWidth: 480, maxHeight: "90vh", borderRadius: 16, border: "1px solid var(--color-surface-2)", padding: "24px 24px 0 24px", position: "relative", display: "flex", flexDirection: "column" }}>
            <button onClick={() => setShowCloseModal(false)} aria-label="Close" style={{ position: "absolute", top: 16, right: 16, color: "var(--color-muted)" }}>×</button>
            {/* Scrollable body -- same fix as TransactionLedger/MarketingWorkspace's
                close-day modal: keeps CONFIRM & CLOSE DAY reachable even if this
                grows unbounded content later, rather than assuming today's fixed
                fields are the ceiling. */}
            <div style={{ overflowY: "auto", flex: 1 }}>
            <div className="text-[10px] font-mono text-[var(--color-accent-cobalt)] tracking-widest font-bold mb-1">▸ PACKAGE DESK SALES ANALYSIS</div>
            <div className="text-[12px] text-[var(--color-muted)] mb-4">
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              <br />Agent: <span className="text-[var(--color-foreground)]">{user.name}</span>
            </div>
            <div className="space-y-1.5 text-[13px] font-mono border-t border-[var(--color-border)] pt-4 mb-4">
              <div className="flex justify-between"><span className="text-[var(--color-muted)]">Total Sales</span><span className="font-bold text-[var(--color-foreground)]">{fmt(totalSales)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-muted)]">Cash Sales</span><span className="text-[var(--color-foreground)]">{fmt(cashSales)}</span></div>
              {debtCashRecoveredToday > 0 && <div className="flex justify-between text-emerald-400"><span>Debt Recovered (Cash)</span><span>+ {fmt(debtCashRecoveredToday)}</span></div>}
              <div className="flex justify-between"><span className="text-[var(--color-muted)]">POS</span><span className="text-[var(--color-foreground)]">{fmt(posSales)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-muted)]">Bank Transfer</span><span className="text-[var(--color-foreground)]">{fmt(transferSales)}</span></div>
              {debtSales > 0 && <div className="flex justify-between border-t border-[var(--color-border)] pt-1 mt-1"><span className="text-orange-400 font-sans">Unpaid Credit Sales (Owed)</span><span className="text-orange-400 font-bold">{fmt(debtSales)}</span></div>}
              {debtTotalRecoveredToday > 0 && <div className="flex justify-between"><span className="text-emerald-400 font-sans">Debt Collected Today</span><span className="text-emerald-400 font-bold">{fmt(debtTotalRecoveredToday)}</span></div>}
            </div>
            <div className="bg-[rgba(59,130,246,0.1)] border border-[var(--color-accent-cobalt)] rounded-xl p-4 mb-6">
              <div className="flex justify-between items-center">
                <span className="text-[14px] text-[var(--color-accent-cobalt)] font-bold font-mono">BAL. CASH</span>
                <span className={`text-[22px] font-bold font-mono ${balanceCash >= 0 ? 'text-[var(--color-accent-cobalt)]' : 'text-red-400'}`}>{fmt(Math.abs(balanceCash))}</span>
              </div>
              <div className="text-[11px] text-[rgba(59,130,246,0.7)] mt-1">({fmt(physicalCash)} cash-in-hand − {fmt(totalExpenses)} expenses)</div>
            </div>
            </div>{/* end scrollable body */}
            <div className="flex gap-3" style={{ paddingTop: 16, paddingBottom: 24, flexShrink: 0 }}>
              <button
                onClick={() => {
                  import('./PackageReceipt').then(m => m.downloadPackageDailySummary({
                    date: new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
                    agentName: user.name,
                    hubName: user.hub,
                    entries: packageTxs.map(t => ({
                      customerName: t.name,
                      destination: t.destination || '',
                      contentType: t.contentType || '',
                      pieces: t.pieces,
                      kg: t.kg,
                      amount: t.amount,
                      paymentMode: t.mode,
                      bank: t.bank,
                    })),
                    totalSales,
                    cashSales,
                    posSales,
                    transferSales,
                    debtSales,
                    expenses: expenses.filter(e => isToday(e.created_at)),
                    totalExpenses,
                    balanceCash,
                  }));
                }}
                style={{ flex: 1, padding: 12, background: "transparent", border: "1px solid rgba(59,130,246,0.4)", borderRadius: 8, color: "var(--color-accent-cobalt)", fontSize: 11, fontFamily: "monospace", fontWeight: "bold", cursor: "pointer" }}
              >
                DOWNLOAD SUMMARY PDF
              </button>
              <button onClick={handleCloseDay} disabled={closingDay} style={{ flex: 1, padding: 12, background: "var(--color-accent-cobalt)", border: "none", borderRadius: 8, color: "#fff", fontSize: 11, fontFamily: "monospace", fontWeight: "bold", cursor: closingDay ? "not-allowed" : "pointer", opacity: closingDay ? 0.6 : 1 }}>
                {closingDay ? 'CLOSING…' : 'CONFIRM & CLOSE DAY'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSalesAnalysis && (
        <DepartmentSalesAnalysisModal
          user={user}
          deptType="package"
          deptLabel="Package"
          routeLabel="Destination"
          onClose={() => setShowSalesAnalysis(false)}
        />
      )}
    </div>
  );
};
