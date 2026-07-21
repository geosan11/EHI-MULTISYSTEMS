import { useState, useEffect, useRef, useMemo } from "react";
import { useEnterToNextField } from "../../lib/useEnterToNextField";
import { User, Transaction, Expense } from "../../lib/types";
import {  PRICING , CARGO_ROUTES } from "../../lib/constants";
import { useAirlines } from "../../lib/airlines";
import { useExpenseCategories } from "../../lib/expenseCategories";
import { useBanks } from "../../lib/banks";
import { fmt, uid, tnow, getHubCode, upperOnChange } from "../../lib/helpers";
import { chargeWalletForSale } from "../../lib/walletPayment";
import { matchWallet } from "../../lib/customerIdentity";
import { WalletRemainderSelector } from "../WalletRemainderSelector";
import { getNextTag } from "../../lib/tagPool";
import { Plus, CheckCircle, Loader2, ClipboardList, MessageSquare, Printer, Minus, TrendingDown, BarChart2, Bluetooth } from "lucide-react";
import { motion } from "motion/react";
import { supabase } from "../../lib/supabase";

import {
  sendReceiptWhatsApp,
  buildMarketingWhatsApp,
} from "../../lib/notifications";
import { PaymentNarrationBox } from "../PaymentNarrationBox";
import { useToast } from "../../lib/ToastContext";
import { useConfirm } from "../../lib/ConfirmContext";
import { EmptyState } from "./EmptyState";
import { CustomerWalletPicker } from "../CustomerWalletPicker";
import { CustomerWallet } from "../../lib/types";
import { ReviewEntryModal } from "./ReviewEntryModal";

export const MarketingWorkspace = ({
  user: propUser,
  transactions,
  expenses,
  onAddTx,
  onAddExpense,
  onShowHistory,
  customerWallets = [],
  setCustomerWallets,
}: {
  user: User;
  transactions: Transaction[];
  expenses: Expense[];
  onAddTx: (tx: Transaction) => void;
  onAddExpense: (exp: Expense) => void;
  onShowHistory?: () => void;
  customerWallets?: CustomerWallet[];
  setCustomerWallets?: React.Dispatch<React.SetStateAction<CustomerWallet[]>>;
}) => {
  const isAdmin = ['super_admin', 'admin', 'accountant'].includes(propUser.role);
  const [adminSelectedHub, setAdminSelectedHub] = useState(propUser.hub_id || 'LOS/Lagos');
  const user = isAdmin ? { ...propUser, hub_id: adminSelectedHub, hub: adminSelectedHub } : propUser;

  const { showToast } = useToast();
  const confirm = useConfirm();
  // New Entry State
  const [pricingMatrix, setPricingMatrix] = useState(() => {
    const saved = localStorage.getItem('ehi_setting_pricing');
    if (saved) {
      const parsed = JSON.parse(saved);
      const matrix: Record<string, { BB: number; MB: number; SB: number }> = {};
      parsed.forEach((p: any) => {
        matrix[p.route] = { BB: p.bb, MB: p.mb, SB: p.sb };
      });
      return matrix;
    }
    return PRICING;
  });

  // This used to be localStorage-only, so a rate change made in Pricing
  // Configuration on another device never reached this screen -- fetch the
  // live server copy on mount (localStorage above just gives an instant
  // first paint / offline fallback while this is in flight).
  useEffect(() => {
    supabase.from('marketing_route_rates').select('*').then(({ data, error }) => {
      if (data && !error && data.length > 0) {
        const matrix: Record<string, { BB: number; MB: number; SB: number }> = {};
        data.forEach((r: any) => { matrix[r.route_name] = { BB: Number(r.bb_rate), MB: Number(r.mb_rate), SB: Number(r.sb_rate) }; });
        setPricingMatrix(matrix);
        localStorage.setItem('ehi_setting_pricing', JSON.stringify(data.map((r: any) => ({ id: r.id, route: r.route_name, bb: Number(r.bb_rate), mb: Number(r.mb_rate), sb: Number(r.sb_rate) }))));
      }
    });
  }, []);

  // Marketing entries aren't airway bills -- this is just a printable tag
  // reference, distinct from the entry's own system ref (successTx.id).
  // Uses the same atomic per-key counter as cargo's AWB, keyed with a
  // "-MK" suffix so marketing tags run on their own independent sequence
  // per hub instead of interleaving with that hub's cargo AWB numbers.
  // Popped from the local tag pool (src/lib/tagPool.ts) rather than a
  // direct RPC call -- a pure local operation once the pool's been
  // reserved while online, so it works offline too, still guaranteed
  // unique since every pooled number came from the same atomic counter.
  // On failure (pool empty + offline), awb stays empty and submission is
  // blocked below -- no silent random fallback, since a non-atomic tag
  // could collide with a real one.
  const [awb, setAwb] = useState('');
  const [awbError, setAwbError] = useState(false);
  const fetchNextTag = async () => {
    setAwbError(false);
    const hubCode = getHubCode(user.hub_code || user.hub);
    const tag = await getNextTag(`${hubCode}-MK`, `EHI-${hubCode}-MK`);
    if (tag) {
      setAwb(tag);
    } else {
      setAwb('');
      setAwbError(true);
      showToast({ message: 'No tag number available offline. Connect to the internet briefly to reserve more, then try again.', type: 'error' });
    }
  };
  useEffect(() => { fetchNextTag(); }, []);

  // Same canonical airline source every other picker uses (was previously
  // sourced from whatever logo files happened to be uploaded to Supabase
  // Storage -- an airline with no uploaded logo silently never appeared here).
  const availableAirlines = useAirlines({ includeOther: false });
  const [airline, setAirline] = useState('');
  useEffect(() => {
    if (availableAirlines.length > 0 && !availableAirlines.includes(airline)) {
      setAirline(availableAirlines[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableAirlines]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [route, setRoute] = useState<string>(Object.keys(pricingMatrix)[0]);
  const [mode, setMode] = useState<string>("Transfer");
  const banks = useBanks();
  const [bank, setBank] = useState<string>(banks[0]);
  const [bb, setBb] = useState(0);
  const [mb, setMb] = useState(0);
  const [sb, setSb] = useState(0);
  // Bag counts alone don't tell an airline what to bill/fly -- airlines
  // charge and route cargo by weight, so each bag category needs its own kg
  // figure to reconcile against the airline's manifest.
  const [bbKg, setBbKg] = useState("");
  const [mbKg, setMbKg] = useState("");
  const [sbKg, setSbKg] = useState("");
  const [amountOverride, setAmountOverride] = useState("");
  const [debtorName, setDebtorName] = useState("");

  const [narrationCode, setNarrationCode] = useState<string>("");

  useEffect(() => {
    if ((mode === "Transfer" || mode === "TransferCash" || mode === "POS") && !narrationCode) {
      import("../../lib/helpers").then(({ generatePaymentNarration }) => {
        setNarrationCode(
          generatePaymentNarration(
            user.hub_code || user.hub,
            Math.floor(Math.random() * 9000) + 1000,
          ),
        );
      });
    }
  }, [mode, narrationCode, user.hub]);

  const [successTx, setSuccessTx] = useState<Transaction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showMarketingReview, setShowMarketingReview] = useState(false);

  useEffect(() => {
    if (successTx) {
      document.querySelectorAll('.overflow-y-auto, main').forEach(el => {
        el.scrollTop = 0;
      });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [successTx]);

  // Expense State
  const expenseCategoryNames = useExpenseCategories().map(c => c.name);
  const [expType, setExpType] = useState<string>('');
  useEffect(() => {
    if (expenseCategoryNames.length > 0 && !expenseCategoryNames.includes(expType)) setExpType(expenseCategoryNames[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseCategoryNames]);
  const [expAmount, setExpAmount] = useState("");
  const [expDesc, setExpDesc] = useState("");

  const routePrices = pricingMatrix[route] || { BB: 0, MB: 0, SB: 0 };
  const minAmount = bb * routePrices.BB + mb * routePrices.MB + sb * routePrices.SB;
  const totalKg = (parseFloat(bbKg) || 0) + (parseFloat(mbKg) || 0) + (parseFloat(sbKg) || 0);
  const parsedOverride = parseFloat(amountOverride) || 0;
  const totalAmount = amountOverride !== "" ? parsedOverride : minAmount;

  // Debt mode records debtorName as the transaction's name (see handleAddEntry
  // below: `mode === "Debt" ? debtorName.trim() : name.trim()`), but this
  // check validated `name` unconditionally -- the always-visible "Customer
  // Name" field could be filled while the Debt-only "Debtor Name" field was
  // left empty, producing an untraceable debt record with name: "". Matches
  // the branch PackageForm.tsx already uses correctly for the same fields.
  const isValid = !!awb && (mode === "Debt" ? debtorName.trim().length > 0 : name.trim().length > 0) && phone.trim().length > 0 && totalAmount > 0 && (amountOverride === "" || parsedOverride >= minAmount);

  // "Less Transfer" — daily adjustment for 3rd-party/corporate transfers (Govt/Honda/Zion)
  // that belong to other accounts and should be excluded from the day's cash tally
  const [lessTransfer, setLessTransfer] = useState(0);
  const [lessTransferInput, setLessTransferInput] = useState('');
  const [lessTransferLabel, setLessTransferLabel] = useState('');

  const [selectedWalletOverride, setSelectedWalletOverride] = useState<CustomerWallet | null>(null);
  const [walletRemainderMode, setWalletRemainderMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');
  const [walletRemainderBank, setWalletRemainderBank] = useState('');
  const activeWallet = useMemo(() => {
    if (selectedWalletOverride) return selectedWalletOverride;
    return matchWallet(customerWallets, name, phone);
  }, [name, phone, customerWallets, selectedWalletOverride]);

  const marketingTxs = transactions.filter((t) => t.type === "marketing");
  const totalSales = marketingTxs.reduce((sum, t) => sum + t.amount, 0);
  const cashSales = marketingTxs.reduce(
    (sum, t) => sum + (t.mode === "Cash" ? t.amount : 0),
    0,
  );
  // "Transfer (Cash)" = transfers physically received as cash (e.g. mobile money agents)
  const transferCashSales = marketingTxs.reduce(
    (sum, t) => sum + (t.mode === "TransferCash" ? t.amount : 0),
    0,
  );
  const transferSales = marketingTxs.reduce(
    (sum, t) =>
      sum + (t.mode === "Transfer" || t.mode === "POS" || t.mode === "TransferCash" ? t.amount : 0),
    0,
  );
  const debtSales = marketingTxs.reduce(
    (sum, t) => sum + (t.mode === "Debt" ? t.amount : 0),
    0,
  );
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  // Balance Cash = (physical cash on hand) - expenses
  // Physical cash = Cash sales + Transfer-received-as-cash - Less Transfer deduction
  const physicalCash = cashSales + transferCashSales - lessTransfer;
  const balanceToRemit = physicalCash - totalExpenses;

  // Route breakdown for today
  const routeCounts: Record<string, number> = {};
  marketingTxs.forEach(t => {
    const r = t.route || t.detail?.split(' · ')[0] || 'Unknown';
    routeCounts[r] = (routeCounts[r] || 0) + 1;
  });

  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingDay, setClosingDay] = useState(false);

  const handleDownloadReceipt = async () => {
    if (successTx) {
      const { downloadMarketingReceipt } = await import("./MarketingReceipt");
      const data = {
        entryRef: successTx.id,
        awbTagNumber: successTx.awb_tag_number,
        airline: successTx.airline,
        date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
        agentName: user.name,
        customerName: successTx.name,
        phone: phone || undefined,
        route: route,
        bigBags: bb,
        medBags: mb,
        smallBags: sb,
        amount: successTx.amount,
        paymentMode: successTx.mode,
        paymentNarration: successTx.paymentNarration,
        bankName: bank || undefined,
      };
      downloadMarketingReceipt(data);
    }
  };

  const handleCloseDay = async () => {
    if (closingDay) return;
    const ok = await confirm({
      title: 'Close marketing session?',
      message: "Close today's marketing session? This cannot be undone.",
      confirmLabel: 'Close Day',
      tone: 'danger',
    });
    if (!ok) return;
    setClosingDay(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from('marketing_day_close').upsert({
        hub_id: user.hub_id,
        hub: user.hub,
        date: today,
        total_sales: totalSales,
        cash_sales: cashSales,
        transfer_sales: transferSales - transferCashSales,
        transfer_cash_sales: transferCashSales,
        less_transfer: lessTransfer,
        less_transfer_label: lessTransferLabel,
        debt_sales: debtSales,
        total_expenses: totalExpenses,
        balance_cash: balanceToRemit,
        entry_count: marketingTxs.length,
        route_counts: routeCounts,
        closed_by: user.name,
        closed_at: new Date().toISOString()
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

  const handleDownloadSummary = async () => {
    const { downloadMarketingDailySummary } =
      await import("./MarketingReceipt");
    const uniqueRoutes = [
      ...new Set(marketingTxs.map((t) => t.detail.split(" · ")[0])),
    ].join(", ");
    const data = {
      date: new Date().toLocaleDateString("en-GB", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      agentName: user.name,
      hubName: user.hub,
      entries: marketingTxs.map((t) => ({
        customerName: t.name,
        route: t.detail.split(" · ")[0],
        bags: t.detail.split(" · ")[1],
        amount: t.amount,
        paymentMode: t.mode,
        bank: t.bank,
      })),
      totalSales,
      cashSales,
      transferSales,
      expenses,
      totalExpenses,
      balanceToRemit,
    };
    downloadMarketingDailySummary(data);
  };

  const handleAddEntry = async () => {
    if (!isValid || submitting) return;

    setSubmitting(true);

    let details = [];
    if (bb > 0) details.push(`${bb}BB`);
    if (mb > 0) details.push(`${mb}MB`);
    if (sb > 0) details.push(`${sb}SB`);

    const tx: Transaction = {
      id: uid("MK"),
      awb_tag_number: awb,
      airline,
      name: mode === "Debt" ? debtorName.trim() : name.trim(),
      detail: `${route} · ${details.join(" ")}`,
      amount: totalAmount,
      mode,
      bank: (mode === "Transfer" || mode === "TransferCash" || mode === "POS") ? bank : undefined,
      paymentNarration: (mode === "Transfer" || mode === "TransferCash" || mode === "POS") ? narrationCode : undefined,
      time: tnow(),
      type: "marketing",
      status: "Intake",
      route,
      hub: user.hub,
      enteredByName: user.name,
      // Explicit fields so EHIApp doesn't need to parse the detail string
      ...(bb > 0 || mb > 0 || sb > 0 ? { _bb: bb, _mb: mb, _sb: sb } as any : {}),
      ...(totalKg > 0 ? { _bbKg: parseFloat(bbKg) || 0, _mbKg: parseFloat(mbKg) || 0, _sbKg: parseFloat(sbKg) || 0 } as any : {}),
      // TODO: capture client_type at entry
    };

    // Wallet payment — AUTO-SPLIT. Wallet covers what it can; any remainder is
    // collected by the chosen Cash/Transfer/POS method and recorded as the
    // receipt_mode, so the till isn't silently short. EOD nets
    // wallet_deduction_amount out of the cash/transfer/POS totals.
    if (mode === "Wallet" && activeWallet) {
      const charge = await chargeWalletForSale({
        wallet: activeWallet,
        amount: totalAmount,
        cargoRef: awb,
        description: `Marketing Consignment ${awb}`,
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
      let bagsList: string[] = [];
      if (bb > 0) bagsList.push(`${bb} BB`);
      if (mb > 0) bagsList.push(`${mb} MB`);
      if (sb > 0) bagsList.push(`${sb} SB`);
      sendReceiptWhatsApp({
        phone: phone.trim(),
        ref: tx.id,
        message: buildMarketingWhatsApp({
          ref: tx.id,
          customer: name.trim(),
          route,
          bags: bagsList.join(" · "),
          amount: totalAmount,
          mode,
          bank: (mode === "Transfer" || mode === "TransferCash" || mode === "POS") ? bank : undefined,
        }),
      });
    }
  };

  const handleReset = () => {
    setName("");
    setDebtorName("");
    setPhone("");
    setBb(0);
    setMb(0);
    setSb(0);
    setBbKg("");
    setMbKg("");
    setSbKg("");
    setAmountOverride("");
    setMode("Transfer");
    setNarrationCode("");
    setSuccessTx(null);
    fetchNextTag();
  };

  const handleAddExpense = () => {
    const amt = parseFloat(expAmount);
    if (!amt || amt <= 0) {
      showToast({ message: 'Enter an expense amount greater than zero.', type: 'warning' });
      return;
    }

    onAddExpense({
      id: `EXP-${Date.now()}`,
      type: expType,
      amount: amt,
      description: expDesc.trim(),
      time: tnow(),
    });

    setExpAmount("");
    setExpDesc("");
  };

  // Focus visible styles for marketing form (green stream)
  const mktgFocusClasses =
    "focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.5)] focus:border-[rgba(16,185,129,0.5)] transition-colors";

  const formRootRef = useRef<HTMLDivElement>(null);
  useEnterToNextField(formRootRef);

  return (
    <div
      ref={formRootRef}
      className="overflow-y-auto overflow-x-hidden pb-24 p-4 max-w-5xl mx-auto"
      style={{ width: "100%", boxSizing: "border-box", minHeight: 0, flex: 1 }}
    >
      {/* Workspace Header */}
      <div className="flex justify-between items-center text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-widest border-b border-[var(--color-border)] pb-2 mb-6">
        <div>
          {new Date().toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
          })}
        </div>
        <div className="flex items-center gap-3">
          {onShowHistory && (
            <button
              onClick={onShowHistory}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] rounded-lg text-[11px] font-mono text-[var(--color-muted)] hover:text-[var(--color-success)] hover:border-[var(--color-success)] transition-colors normal-case tracking-normal"
            >
              <ClipboardList size={14} /> <span>History</span>
            </button>
          )}
          <div>Agent: {user.name.split(" ")[0]}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_280px]">
        {/* Left Column - Forms */}
        <div className="space-y-6">
          {successTx ? (
            <div className="bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.2)] rounded p-6 md:p-8 flex flex-col animate-in fade-in zoom-in-95 duration-200">
              <div className="flex justify-center">
                <CheckCircle
                  size={32}
                  className="text-[var(--color-success)] mb-3"
                />
              </div>
              <div className="text-[11px] font-mono text-[var(--color-success)] uppercase tracking-widest mb-1 text-center">
                ENTRY RECORDED
              </div>
              <div
                className="text-[14px] font-bold font-mono text-[var(--color-success)] mb-4 uppercase text-center"
                style={{ fontFamily: "JetBrains Mono" }}
              >
                REF: {successTx.id}
              </div>

              <div className="bg-[var(--color-obsidian)] rounded p-3 mb-4 space-y-2 border border-[var(--color-border)]">
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1">
                  <span className="text-[10px] font-mono text-[var(--color-muted)]">Tag Ref</span>
                  <span className="text-[11px] font-mono text-[var(--color-success)] font-bold">
                    {successTx.awb_tag_number}
                  </span>
                </div>
                {successTx.airline && (
                  <div className="flex justify-between border-b border-[var(--color-border)] pb-1">
                    <span className="text-[10px] font-mono text-[var(--color-muted)]">Airline</span>
                    <span className="text-[11px] font-mono text-[var(--color-foreground)]">
                      {successTx.airline}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1">
                  <span className="text-[10px] font-mono text-[var(--color-muted)]">
                    Customer
                  </span>
                  <span className="text-[11px] font-mono text-[var(--color-foreground)]">
                    {successTx.name}
                  </span>
                </div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1">
                  <span className="text-[10px] font-mono text-[var(--color-muted)]">
                    Route / Bags
                  </span>
                  <span className="text-[11px] font-mono text-[var(--color-foreground)]">
                    {successTx.detail}
                  </span>
                </div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1">
                  <span className="text-[10px] font-mono text-[var(--color-muted)]">
                    Amount
                  </span>
                  <span
                    className="text-[12px] font-bold font-mono text-[var(--color-success)]"
                    style={{ fontFamily: "JetBrains Mono" }}
                  >
                    {fmt(successTx.amount)}
                  </span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-[10px] font-mono text-[var(--color-muted)]">
                    Payment
                  </span>
                  <span className="text-[11px] font-mono text-[var(--color-foreground)]">
                    {successTx.mode} {successTx.bank && `(${successTx.bank})`}
                  </span>
                </div>
              </div>

              <button
                onClick={handleReset}
                className="w-full py-3 mb-2 bg-[var(--color-surface-1)] text-[var(--color-foreground)] text-[11px] font-bold font-mono rounded cursor-pointer flex justify-center items-center gap-2 border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                <Plus size={14} /> NEW ENTRY
              </button>

              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  onClick={() => {
                    import('../../lib/escpos').then(async ({ printViaBluetooth }) => {
                      await printViaBluetooth(async () => {
                        const m = await import('../../lib/escposMarketingPrinting');
                        // Build the MarketingReceiptPrintData object
                        const printData = {
                          entryRef: successTx.id,
                          date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
                          agentName: user.name,
                          customerName: successTx.name,
                          phone: phone || undefined,
                          route: route,
                          bigBags: bb,
                          medBags: mb,
                          smallBags: sb,
                          amount: successTx.amount,
                          paymentMode: successTx.mode,
                          paymentNarration: successTx.paymentNarration,
                          bankName: bank || undefined,
                          airline: successTx.airline,
                          trackingUrl: `https://app.ehimultisystems.com/track/${successTx.id}`,
                        };
                        return await m.compileMarketingReceiptStream(printData, '80mm');
                      });
                    }).catch((err: any) => {
                      console.error('Bluetooth print failed:', err);
                      showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
                    });
                  }}
                  className="py-2.5 bg-[var(--color-success)] text-[#0D1117] text-[11px] font-bold font-mono rounded cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-opacity-95 border-none"
                >
                  <Bluetooth size={14} className="mb-0.5" />
                  <span>PRINT POS (80mm)</span>
                </button>

                <button
                  onClick={() => {
                    import('../../lib/escpos').then(async ({ printViaBluetooth }) => {
                      await printViaBluetooth(async () => {
                        const m = await import('../../lib/escposMarketingPrinting');
                        const printData = {
                          entryRef: successTx.id,
                          date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
                          agentName: user.name,
                          customerName: successTx.name,
                          phone: phone || undefined,
                          route: route,
                          bigBags: bb,
                          medBags: mb,
                          smallBags: sb,
                          amount: successTx.amount,
                          paymentMode: successTx.mode,
                          paymentNarration: successTx.paymentNarration,
                          bankName: bank || undefined,
                          airline: successTx.airline,
                          trackingUrl: `https://app.ehimultisystems.com/track/${successTx.id}`,
                        };
                        return await m.compileMarketingReceiptStream(printData, '58mm');
                      });
                    }).catch((err: any) => {
                      console.error('Bluetooth print failed:', err);
                      showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
                    });
                  }}
                  className="py-2.5 bg-[var(--color-success)] bg-opacity-80 text-[#0D1117] text-[11px] font-bold font-mono rounded cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-opacity-95 border-none"
                >
                  <Bluetooth size={14} className="mb-0.5" />
                  <span>PRINT POS (58mm)</span>
                </button>
              </div>
              <button
                onClick={handleDownloadReceipt}
                className="w-full py-3 bg-transparent border border-[rgba(16,185,129,0.3)] rounded-lg cursor-pointer text-[11px] font-bold font-mono text-[var(--color-success)] flex items-center justify-center gap-2 mt-2"
              >
                <Printer size={14} /> PRINT RECEIPT (PDF)
              </button>

              {/* Tag print buttons — one tag per bag (BB/MB/SB) */}
              {(bb > 0 || mb > 0 || sb > 0) && (
                <div className="mt-3 space-y-1">
                  <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-widest text-center mb-2">
                    Print Routing Tags · {bb + mb + sb} tag{bb + mb + sb !== 1 ? 's' : ''} total
                    {' '}({[bb > 0 && `${bb}BB`, mb > 0 && `${mb}MB`, sb > 0 && `${sb}SB`].filter(Boolean).join(' ')})
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        import('../../lib/escposTagPrinting').then(async (m) => {
                          await m.printMarketingTags(successTx!, bb, mb, sb, '80mm');
                        }).catch((err: any) => {
                          console.error('Bluetooth print failed:', err);
                          showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
                        });
                      }}
                      className="py-2.5 bg-[rgba(16,185,129,0.12)] border border-[rgba(16,185,129,0.3)] text-[var(--color-success)] text-[11px] font-bold font-mono rounded-lg cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-[rgba(16,185,129,0.2)] transition-colors"
                    >
                      <Bluetooth size={14} className="mb-0.5" />
                      <span>TAGS (80mm)</span>
                    </button>
                    <button
                      onClick={() => {
                        import('../../lib/escposTagPrinting').then(async (m) => {
                          await m.printMarketingTags(successTx!, bb, mb, sb, '58mm');
                        }).catch((err: any) => {
                          console.error('Bluetooth print failed:', err);
                          showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
                        });
                      }}
                      className="py-2.5 bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.2)] text-[var(--color-success)] text-[11px] font-bold font-mono rounded-lg cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-[rgba(16,185,129,0.15)] transition-colors"
                    >
                      <Bluetooth size={14} className="mb-0.5" />
                      <span>TAGS (58mm)</span>
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      import('./MarketingTagPDF').then(m => m.downloadMarketingTagPDF({
                        id: successTx!.awb_tag_number || successTx!.id,
                        name: successTx!.name,
                        route,
                        airline,
                        hubName: user?.hub || "EHI Cargo Station",
                        date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
                        bigBags: bb,
                        medBags: mb,
                        smallBags: sb,
                        totalKg,
                      }));
                    }}
                    className="w-full mt-2 py-2.5 bg-transparent border border-[rgba(16,185,129,0.3)] rounded-lg cursor-pointer text-[11px] font-bold font-mono text-[var(--color-success)] flex items-center justify-center gap-2"
                    title="Fixed 100mm x 80mm label per bag -- for the XP-402B and similar gap/die-cut label printers"
                  >
                    <span className="text-[14px]">🏷️</span> TAG PDF (100×80mm LABEL)
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 bg-[rgba(255,255,255,0.02)] p-4 md:mx-0 md:rounded-xl md:border border-y border-[var(--color-border)]">
              <div className="border-b border-[var(--color-border)] pb-1 mb-2">
                <span
                  style={{
                    fontFamily: "JetBrains Mono",
                    fontSize: 10,
                    color: "var(--color-success)",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                  }}
                >
                  ▸ NEW MARKETING ENTRY
                </span>
              </div>

              <div className="space-y-3">
                {/* Auto-generated tag ref — read-only, regenerates on New Entry */}
                <div className="flex items-center justify-between px-3 h-9 rounded bg-[var(--color-surface-1)] border border-[rgba(16,185,129,0.2)]">
                  <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Tag Ref</span>
                  <span className="text-[11px] font-mono text-[var(--color-success)] font-bold">{awb || 'Generating…'}</span>
                </div>
                <select
                  value={airline}
                  onChange={(e) => setAirline(e.target.value)}
                  className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
                >
                  {availableAirlines.map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <input
                  id="mkt-name"
                  name="name"
                  placeholder="Customer Name"
                  value={name}
                  onChange={upperOnChange(setName)}
                  className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
                />
                <div className="relative">
                  <MessageSquare size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
                  <input
                    id="mkt-phone"
                    name="phone"
                    type="tel"
                    placeholder="Phone (required) -- include country code for foreign customers (e.g. +44, +1, +233)"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={`w-full h-11 pl-9 pr-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
                  />
                </div>

                <div className="flex space-x-3">
                  <select
                    value={route}
                    onChange={(e) => setRoute(e.target.value)}
                    className={`flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans min-w-0 ${mktgFocusClasses}`}
                  >
                    {Object.keys(pricingMatrix).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as any)}
                    className={`flex-1 h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans min-w-0 ${mktgFocusClasses}`}
                  >
                    <option value="Cash">Cash</option>
                    <option value="Transfer">Transfer (Bank)</option>
                    <option value="TransferCash">Transfer → Cash</option>
                    <option value="POS">POS</option>
                    <option value="Wallet">💰 Customer Credit Wallet</option>
                    <option value="Debt">Debt / Credit</option>
                  </select>
                </div>

                {mode === "Wallet" && (
                  <div className="mb-3 space-y-2">
                    <CustomerWalletPicker
                      wallets={customerWallets}
                      selectedWallet={activeWallet}
                      onSelectWallet={(w) => setSelectedWalletOverride(w)}
                      currentCustomerName={name}
                    />
                    {activeWallet && activeWallet.balance < totalAmount && (
                      <WalletRemainderSelector
                        walletName={activeWallet.customer_name}
                        coverage={activeWallet.balance}
                        remainder={totalAmount - activeWallet.balance}
                        mode={walletRemainderMode}
                        bank={walletRemainderBank}
                        onModeChange={setWalletRemainderMode}
                        onBankChange={setWalletRemainderBank}
                      />
                    )}
                  </div>
                )}

                {(mode === "Transfer" || mode === "TransferCash" || mode === "POS") && (
                  <div className="space-y-2">
                    {mode === "TransferCash" && (
                      <div className="text-[11px] font-mono text-amber-400 bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.2)] rounded px-3 py-2">
                        Customer paid via bank transfer but handed cash physically
                      </div>
                    )}
                    <select
                      value={bank}
                      onChange={(e) => setBank(e.target.value)}
                      className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
                    >
                      <option disabled value="">Bank / POS Terminal</option>
                      {banks.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    {mode === "Transfer" && <PaymentNarrationBox narrationCode={narrationCode} />}
                  </div>
                )}

                {mode === "Debt" && (
                  <div className="space-y-2">
                    <input
                      id="mkt-debtor-name"
                      name="debtor-name"
                      type="text"
                      placeholder="Debtor Name / Company"
                      value={debtorName}
                      onChange={upperOnChange(setDebtorName)}
                      className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
                    />
                  </div>
                )}

                {/* Mobile-friendly bag steppers — large tap targets */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "bb", label: "Big Bag", abbr: "BB", val: bb, set: setBb },
                    { key: "mb", label: "Med Bag", abbr: "MB", val: mb, set: setMb },
                    { key: "sb", label: "Small Bag", abbr: "SB", val: sb, set: setSb },
                  ].map((bag) => (
                    <div
                      key={bag.key}
                      className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)] flex flex-col items-center py-3 gap-2"
                    >
                      <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">{bag.abbr}</span>
                      <span className="text-[22px] font-bold font-mono text-[var(--color-foreground)] leading-none w-10 text-center">{bag.val}</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => bag.set(Math.max(0, bag.val - 1))}
                          className="w-9 h-9 rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)] text-xl font-bold flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <Minus size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => bag.set(bag.val + 1)}
                          className="w-9 h-9 rounded-full bg-[rgba(16,185,129,0.15)] text-[var(--color-success)] text-xl font-bold flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Weight per bag category -- airlines fly/bill by kg, not
                    bag count, so this is needed to reconcile against what
                    the airline actually charges for the shipment. */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "bbKg", label: "BB KG", val: bbKg, set: setBbKg },
                    { key: "mbKg", label: "MB KG", val: mbKg, set: setMbKg },
                    { key: "sbKg", label: "SB KG", val: sbKg, set: setSbKg },
                  ].map((f) => (
                    <div key={f.key} className="space-y-1">
                      <label htmlFor={`mkt-${f.key}`} className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider block text-center">{f.label}</label>
                      <input
                        id={`mkt-${f.key}`}
                        name={f.key}
                        type="number"
                        min="0"
                        step="0.1"
                        placeholder="0"
                        value={f.val}
                        onChange={(e) => f.set(e.target.value)}
                        className={`w-full h-10 px-2 text-[13px] text-center rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-mono ${mktgFocusClasses}`}
                      />
                    </div>
                  ))}
                </div>
                {totalKg > 0 && (
                  <div className="text-[10px] font-mono text-[var(--color-muted)] text-right -mt-2">
                    Total: <span className="text-[var(--color-success)] font-bold">{totalKg}kg</span>
                  </div>
                )}

                <div className="flex justify-between items-center py-2 bg-[var(--color-surface-1)] px-3 rounded border border-[var(--color-border)]">
                  <span className="text-[10px] font-mono text-[var(--color-light-muted)]">
                    TOTAL AMOUNT
                  </span>
                  <div className="flex items-center">
                    <span className="text-[14px] font-bold font-mono text-[var(--color-muted)] mr-1">₦</span>
                    <input
                      id="mkt-amount"
                      name="amount"
                      type="number"
                      min="0"
                      value={amountOverride !== "" ? amountOverride : (minAmount > 0 ? minAmount : "")}
                      onChange={(e) => setAmountOverride(e.target.value)}
                      onBlur={() => {
                        if (amountOverride !== "" && parsedOverride < minAmount) {
                          setAmountOverride("");
                        }
                      }}
                      placeholder={minAmount > 0 ? minAmount.toString() : "0"}
                      className={`w-24 bg-transparent border-none text-right text-[18px] font-bold font-mono p-0 focus:ring-0 ${totalAmount > 0 ? "text-[var(--color-success)]" : "text-[var(--color-muted)]"} ${amountOverride !== "" && parsedOverride < minAmount ? "text-[var(--color-error)]" : ""}`}
                      style={{ fontFamily: "JetBrains Mono" }}
                    />
                  </div>
                </div>

                <button
                  onClick={() => setShowMarketingReview(true)}
                  disabled={!isValid || submitting}
                  className={`w-full py-3 rounded font-bold font-mono text-[12px] flex items-center justify-center gap-2 transition-all focus:outline-none ${
                    submitting
                      ? "opacity-80 cursor-wait bg-[var(--color-success)] text-[var(--color-obsidian)]"
                      : !isValid
                        ? "bg-[var(--color-surface-2)] text-[var(--color-muted)] cursor-not-allowed"
                        : "bg-[var(--color-success)] text-[var(--color-obsidian)] cursor-pointer hover:bg-opacity-90"
                  }`}
                >
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  {submitting ? "ADDING ENTRY..." : (
                    <>
                      <Plus size={16} /> ADD ENTRY
                    </>
                  )}
                </button>
                {showMarketingReview && (
                  <ReviewEntryModal
                    title="Review Marketing Entry"
                    details={[
                      { label: 'Customer', value: name },
                      { label: 'Airline', value: airline },
                      { label: 'Route', value: route },
                      { label: 'Weight', value: `${totalKg} KG` },
                      { label: 'Amount', value: parseFloat(amountOverride) || minAmount },
                      { label: 'Payment Mode', value: mode === 'Debt' ? `Debt (${debtorName})` : mode }
                    ]}
                    onConfirm={() => {
                      setShowMarketingReview(false);
                      handleAddEntry();
                    }}
                    onCancel={() => setShowMarketingReview(false)}
                    confirmText="Add Entry"
                    isSubmitting={submitting}
                  />
                )}
              </div>
            </div>
          )}

          {/* Expense Section */}
          <div className="space-y-4 pt-4 border-t border-[var(--color-border)] md:border-none md:pt-0">
            <div className="border-b border-[var(--color-border)] pb-1 mb-2">
              <span
                style={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 10,
                  color: "var(--color-success)",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                ▸ LOG EXPENSE
              </span>
            </div>

            <div className="flex space-x-2">
              <select
                value={expType}
                onChange={(e) => setExpType(e.target.value)}
                className={`flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
              >
                {expenseCategoryNames.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <input
                id="mkt-exp-amount"
                name="exp-amount"
                type="number"
                min="0"
                placeholder="Amount"
                value={expAmount}
                onChange={(e) => setExpAmount(e.target.value)}
                className={`w-[100px] h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
              />
            </div>
            <div className="flex space-x-2">
              <input
                id="mkt-exp-desc"
                name="exp-desc"
                placeholder="Description (optional)"
                value={expDesc}
                onChange={upperOnChange(setExpDesc)}
                className={`flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
              />
              <button
                onClick={handleAddExpense}
                disabled={!(parseFloat(expAmount) > 0)}
                className="h-11 px-4 bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[12px] font-mono font-bold rounded disabled:opacity-50 cursor-pointer hover:bg-[var(--color-surface-3)] transition-colors"
              >
                LOG
              </button>
            </div>

            {/* Expense log today */}
            {expenses.length > 0 && (
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)] mt-2">
                {expenses.map((e, i) => (
                  <div key={i} className="flex justify-between px-3 py-2 text-[11px] font-mono">
                    <span className="text-[var(--color-muted)]">{e.type}{e.description ? ` — ${e.description}` : ''}</span>
                    <span className="text-red-400" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(e.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between px-3 py-2 text-[11px] font-mono font-bold">
                  <span className="text-[var(--color-foreground)]">Total Expenses</span>
                  <span className="text-red-400" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(totalExpenses)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column — Sales Analysis (mirrors notebook format) */}
        <aside className="space-y-4">
          <div className="sticky top-4 space-y-4">
            {/* Sales Analysis Card */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
                <span className="text-[10px] font-mono text-[var(--color-success)] uppercase tracking-widest font-bold">▸ SALES ANALYSIS</span>
                <span className="text-[10px] font-mono text-[var(--color-muted)]">{marketingTxs.length} customers</span>
              </div>
              <div className="px-4 py-3 space-y-2 text-[12px] font-mono">
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Actual Sales</span>
                  <span className="font-bold text-[var(--color-foreground)]" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(totalSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Cash Sales</span>
                  <span className="text-[var(--color-foreground)]" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(cashSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Transfer Sales</span>
                  <span className="text-[var(--color-foreground)]" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(transferSales - transferCashSales)}</span>
                </div>
                {transferCashSales > 0 && (
                  <div className="flex justify-between">
                    <span className="text-amber-400">Transfer → Cash</span>
                    <span className="text-amber-400" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(transferCashSales)}</span>
                  </div>
                )}
                {debtSales > 0 && (
                  <div className="flex justify-between">
                    <span className="text-orange-400">Unpaid Credit Sales (Owed)</span>
                    <span className="text-orange-400 font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(debtSales)}</span>
                  </div>
                )}

                {/* Less Transfer adjustment */}
                <div className="border-t border-[var(--color-border)] pt-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-muted)] shrink-0">Less Transfer</span>
                    <div className="flex gap-1 items-center">
                      <input
                        id="mkt-less-transfer"
                        name="less-transfer"
                        type="number"
                        min="0"
                        placeholder="0"
                        value={lessTransferInput}
                        onChange={e => {
                          setLessTransferInput(e.target.value);
                          setLessTransfer(parseFloat(e.target.value) || 0);
                        }}
                        className="w-24 h-7 text-right text-[11px] font-mono bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-2 text-red-400 focus:outline-none"
                        style={{ fontFamily: 'JetBrains Mono' }}
                      />
                    </div>
                  </div>
                  {lessTransfer > 0 && (
                    <input
                      id="mkt-less-transfer-label"
                      name="less-transfer-label"
                      type="text"
                      placeholder="Who? (e.g. Govt/Honda/Zion)"
                      value={lessTransferLabel}
                      onChange={upperOnChange(setLessTransferLabel)}
                      className="w-full h-7 text-[10px] font-mono bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-2 text-[var(--color-muted)] focus:outline-none"
                    />
                  )}
                </div>

                <div className="border-t border-[var(--color-border)] pt-2 flex justify-between font-bold">
                  <span className="text-[var(--color-foreground)]">Total Sales (Net)</span>
                  <span className="text-[var(--color-success)]" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(totalSales - lessTransfer)}</span>
                </div>
              </div>
            </div>

            {/* Balance Cash card */}
            <div className="bg-[rgba(16,185,129,0.05)] rounded-xl border border-[rgba(16,185,129,0.2)] px-4 py-3 space-y-1 text-[12px] font-mono">
              <div className="flex justify-between text-[var(--color-muted)]">
                <span>Physical Cash</span>
                <span style={{ fontFamily: 'JetBrains Mono' }}>{fmt(physicalCash)}</span>
              </div>
              <div className="flex justify-between text-red-400">
                <span>Expenses</span>
                <span style={{ fontFamily: 'JetBrains Mono' }}>− {fmt(totalExpenses)}</span>
              </div>
              <div className="flex justify-between font-bold text-[15px] border-t border-[rgba(16,185,129,0.2)] pt-2 mt-1">
                <span className="text-[var(--color-success)]">Balance Cash</span>
                <span className={balanceToRemit >= 0 ? 'text-[var(--color-success)]' : 'text-red-400'} style={{ fontFamily: 'JetBrains Mono' }}>{fmt(Math.abs(balanceToRemit))}{balanceToRemit < 0 ? ' (deficit)' : ''}</span>
              </div>
            </div>

            {/* Route Counts */}
            {Object.keys(routeCounts).length > 0 && (
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)] overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
                  <BarChart2 size={12} className="text-[var(--color-success)]" />
                  <span className="text-[10px] font-mono text-[var(--color-success)] uppercase tracking-widest font-bold">ROUTES TODAY</span>
                </div>
                <div className="px-4 py-3 space-y-1.5">
                  {Object.entries(routeCounts).sort((a,b) => b[1]-a[1]).map(([r, cnt]) => (
                    <div key={r} className="flex justify-between items-center text-[12px] font-mono">
                      <span className="text-[var(--color-muted)] truncate mr-2">{r.split('/')[1] || r}</span>
                      <span className="font-bold text-[var(--color-foreground)] shrink-0">{cnt} pkg{cnt !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center text-[12px] font-mono border-t border-[var(--color-border)] pt-1.5 mt-1">
                    <span className="text-[var(--color-muted)]">Total</span>
                    <span className="font-bold text-[var(--color-success)]">{marketingTxs.length}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Entries Today */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <span className="text-[10px] font-mono text-[var(--color-success)] uppercase tracking-widest font-bold">▸ ENTRIES TODAY</span>
              </div>
              {marketingTxs.length === 0 ? (
                <EmptyState icon={<ClipboardList size={36} strokeWidth={1.5} />} message="No entries yet" />
              ) : (
                <div className="divide-y divide-[var(--color-border)] max-h-[340px] overflow-y-auto">
                  {[...marketingTxs].reverse().map((t) => (
                    <div key={t.id} className="flex justify-between items-center px-4 py-2.5">
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="text-[12px] font-bold text-[var(--color-foreground)] truncate">{t.name}</div>
                        <div className="text-[10px] font-mono text-[var(--color-muted)]">{t.detail}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[12px] font-bold font-mono text-[var(--color-success)]" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(t.amount)}</div>
                        <div className={`text-[9px] font-mono ${t.mode === 'Debt' ? 'text-orange-400' : t.mode === 'TransferCash' ? 'text-amber-400' : 'text-[var(--color-muted)]'}`}>
                          {t.mode === 'TransferCash' ? 'Trf→Cash' : t.mode}{t.bank ? ` · ${t.bank}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowCloseModal(true)}
              className="w-full py-4 bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] text-[var(--color-success)] text-[12px] font-bold font-mono rounded-xl border border-[rgba(16,185,129,0.2)] transition-colors cursor-pointer"
            >
              END DAY & SUBMIT
            </button>
          </div>
        </aside>
      </div>

      {showCloseModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              background: "var(--color-obsidian)",
              width: "100%",
              maxWidth: 480,
              maxHeight: "90vh",
              borderRadius: 16,
              border: "1px solid var(--color-surface-2)",
              padding: "24px 24px 0 24px",
              position: "relative",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <button
              onClick={() => setShowCloseModal(false)}
              aria-label="Close"
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                color: "var(--color-muted)",
              }}
            >
              ×
            </button>
            {/* Scrollable body -- same fix as TransactionLedger's Edit
                Transaction modal: expenses/routes lists here are
                unbounded, so without a scroll container the CONFIRM &
                CLOSE DAY button below can be pushed off-screen entirely
                on a short viewport with no way to reach it. */}
            <div style={{ overflowY: "auto", flex: 1 }}>
            {/* Header */}
            <div className="text-[10px] font-mono text-[var(--color-success)] tracking-widest font-bold mb-1">▸ ARENA SALES ANALYSIS</div>
            <div className="text-[12px] text-[var(--color-muted)] mb-4">
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              <br />Agent: <span className="text-[var(--color-foreground)]">{user.name}</span>
            </div>

            {/* Sales breakdown — matches notebook format exactly */}
            <div className="space-y-1.5 text-[13px] font-mono border-t border-[var(--color-border)] pt-4 mb-4">
              <div className="flex justify-between"><span className="text-[var(--color-muted)]">Actual Sales</span><span className="font-bold text-[var(--color-foreground)]">{fmt(totalSales)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-muted)]">Cash Sales</span><span className="text-[var(--color-foreground)]">{fmt(cashSales)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-muted)]">Transfer Sales</span><span className="text-[var(--color-foreground)]">{fmt(transferSales - transferCashSales)}</span></div>
              {transferCashSales > 0 && <div className="flex justify-between"><span className="text-amber-400">Transfer Rcvd as Cash</span><span className="text-amber-400">{fmt(transferCashSales)}</span></div>}
              {lessTransfer > 0 && <div className="flex justify-between"><span className="text-red-400">Less Transfer{lessTransferLabel ? ` (${lessTransferLabel})` : ''}</span><span className="text-red-400">− {fmt(lessTransfer)}</span></div>}
              {debtSales > 0 && <div className="flex justify-between"><span className="text-orange-400">Debt / Credit</span><span className="text-orange-400">{fmt(debtSales)}</span></div>}
              <div className="flex justify-between font-bold border-t border-[var(--color-border)] pt-1.5"><span className="text-[var(--color-foreground)]">Total Sales (Net)</span><span className="text-[var(--color-success)]">{fmt(totalSales - lessTransfer)}</span></div>
            </div>

            {/* Expenses */}
            <div className="border-t border-[var(--color-border)] pt-3 mb-4">
              <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-widest mb-2">Expenses</div>
              {expenses.length > 0 ? (
                <div className="space-y-1 text-[13px] font-mono">
                  {expenses.map((e, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="text-[var(--color-muted)]">{e.type}{e.description ? ` — ${e.description}` : ''}</span>
                      <span className="text-red-400">{fmt(e.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold border-t border-[var(--color-border)] pt-1 mt-1">
                    <span className="text-[var(--color-foreground)]">Total Expenses</span>
                    <span className="text-red-400">{fmt(totalExpenses)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-[12px] text-[var(--color-muted)] italic">No expenses logged</div>
              )}
            </div>

            {/* Route counts */}
            {Object.keys(routeCounts).length > 0 && (
              <div className="border-t border-[var(--color-border)] pt-3 mb-4">
                <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-widest mb-2">Routes</div>
                <div className="space-y-1 text-[13px] font-mono">
                  {Object.entries(routeCounts).sort((a,b)=>b[1]-a[1]).map(([r,cnt])=>(
                    <div key={r} className="flex justify-between">
                      <span className="text-[var(--color-muted)]">{r.split('/')[1] || r}</span>
                      <span className="text-[var(--color-foreground)]">{cnt}</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold border-t border-[var(--color-border)] pt-1"><span>Total</span><span>{marketingTxs.length}</span></div>
                </div>
              </div>
            )}

            {/* Balance cash — the big number */}
            <div className="bg-[rgba(16,185,129,0.1)] border border-[var(--color-success)] rounded-xl p-4 mb-6">
              <div className="flex justify-between items-center">
                <span className="text-[14px] text-[var(--color-success)] font-bold font-mono">BAL. CASH</span>
                <span className={`text-[22px] font-bold font-mono ${balanceToRemit >= 0 ? 'text-[var(--color-success)]' : 'text-red-400'}`} style={{ fontFamily: 'JetBrains Mono' }}>{fmt(Math.abs(balanceToRemit))}</span>
              </div>
              <div className="text-[11px] text-[rgba(16,185,129,0.7)] mt-1">
                ({fmt(cashSales + transferCashSales)} cash-in-hand{lessTransfer > 0 ? ` − ${fmt(lessTransfer)} less-transfer` : ''} − {fmt(totalExpenses)} expenses)
              </div>
            </div>
            </div>{/* end scrollable body */}

            <div className="flex gap-3" style={{ paddingTop: 16, paddingBottom: 24, flexShrink: 0 }}>
              <button
                onClick={handleDownloadSummary}
                style={{
                  flex: 1,
                  padding: 12,
                  background: "transparent",
                  border: "1px solid rgba(16,185,129,0.4)",
                  borderRadius: 8,
                  color: "var(--color-success)",
                  fontSize: 11,
                  fontFamily: "monospace",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                DOWNLOAD SUMMARY PDF
              </button>
              <button
                onClick={handleCloseDay}
                disabled={closingDay}
                style={{
                  flex: 1,
                  padding: 12,
                  background: "var(--color-success)",
                  border: "none",
                  borderRadius: 8,
                  color: "#000",
                  fontSize: 11,
                  fontFamily: "monospace",
                  fontWeight: "bold",
                  cursor: closingDay ? "not-allowed" : "pointer",
                  opacity: closingDay ? 0.6 : 1,
                }}
              >
                {closingDay ? 'CLOSING…' : 'CONFIRM & CLOSE DAY'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
