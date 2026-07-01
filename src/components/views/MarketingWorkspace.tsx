import { useState, useEffect } from "react";
import { User, Transaction, Expense } from "../../lib/types";
import { PRICING, BANKS, EXPENSE_CATEGORIES } from "../../lib/constants";
import { fmt, uid, tnow } from "../../lib/helpers";
import { Plus, CheckCircle, Loader2, ClipboardList, MessageSquare, Printer } from "lucide-react";
import { motion } from "motion/react";

import {
  sendReceiptWhatsApp,
  buildMarketingWhatsApp,
} from "../../lib/notifications";
import { PaymentNarrationBox } from "../PaymentNarrationBox";

export const MarketingWorkspace = ({
  user,
  transactions,
  expenses,
  onAddTx,
  onAddExpense,
  onShowHistory,
}: {
  user: User;
  transactions: Transaction[];
  expenses: Expense[];
  onAddTx: (tx: Transaction) => void;
  onAddExpense: (exp: Expense) => void;
  onShowHistory?: () => void;
}) => {
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

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [route, setRoute] = useState<string>(Object.keys(pricingMatrix)[0]);
  const [mode, setMode] = useState<string>("Transfer");
  const [bank, setBank] = useState<string>(BANKS[0]);
  const [bb, setBb] = useState(0);
  const [mb, setMb] = useState(0);
  const [sb, setSb] = useState(0);
  const [amountOverride, setAmountOverride] = useState("");

  const [narrationCode, setNarrationCode] = useState<string>("");

  useEffect(() => {
    if (mode === "Transfer" && !narrationCode) {
      import("../../lib/helpers").then(({ generatePaymentNarration }) => {
        // use a random serial for marketing if none exists
        setNarrationCode(
          generatePaymentNarration(
            user.hub_code || user.hub,
            Math.floor(Math.random() * 900) + 100,
          ),
        );
      });
    }
  }, [mode, narrationCode, user.hub]);

  const [successTx, setSuccessTx] = useState<Transaction | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Expense State
  const [expType, setExpType] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [expAmount, setExpAmount] = useState("");
  const [expDesc, setExpDesc] = useState("");

  const routePrices = pricingMatrix[route] || { BB: 0, MB: 0, SB: 0 };
  const minAmount = bb * routePrices.BB + mb * routePrices.MB + sb * routePrices.SB;
  const parsedOverride = parseFloat(amountOverride) || 0;
  const totalAmount = amountOverride !== "" ? parsedOverride : minAmount;

  const isValid = name.trim().length > 0 && totalAmount > 0 && (amountOverride === "" || parsedOverride >= minAmount);

  const marketingTxs = transactions.filter((t) => t.type === "marketing");
  const totalSales = marketingTxs.reduce((sum, t) => sum + t.amount, 0);
  const cashSales = marketingTxs.reduce(
    (sum, t) => sum + (t.mode === "Cash" ? t.amount : 0),
    0,
  );
  const transferSales = marketingTxs.reduce(
    (sum, t) =>
      sum + (t.mode === "Transfer" || t.mode === "POS" ? t.amount : 0),
    0,
  );

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const balanceToRemit = cashSales - totalExpenses; // Usually, expenses are taken from cash

  const [showCloseModal, setShowCloseModal] = useState(false);

  const handleDownloadReceipt = async () => {
    if (successTx) {
      const { downloadMarketingReceipt } = await import("./MarketingReceipt");
      const data = {
        entryRef: successTx.id,
        date: new Date().toLocaleDateString("en-GB"),
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

  const handleCloseDay = () => {
    setShowCloseModal(false);
    // In a real app we'd trigger a cloud function to seal these. For now reset. Let's just alert.
    alert("Day closed and submitted successfully!");
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

  const handleAddEntry = () => {
    if (!isValid || submitting) return;

    setSubmitting(true);

    let details = [];
    if (bb > 0) details.push(`${bb}BB`);
    if (mb > 0) details.push(`${mb}MB`);
    if (sb > 0) details.push(`${sb}SB`);

    const tx: Transaction = {
      id: uid("MK"),
      name: name.trim(),
      detail: `${route} · ${details.join(" ")}`,
      amount: totalAmount,
      mode,
      bank: mode === "Transfer" ? bank : undefined,
      paymentNarration: mode === "Transfer" ? narrationCode : undefined,
      time: tnow(),
      type: "marketing",
      status: "Intake",
      route,
      // Explicit fields so EHIApp doesn't need to parse the detail string
      ...(bb > 0 || mb > 0 || sb > 0 ? { _bb: bb, _mb: mb, _sb: sb } as any : {}),
    };

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
          bank: mode === "Transfer" ? bank : undefined,
        }),
      });
    }
  };

  const handleReset = () => {
    setName("");
    setPhone("");
    setBb(0);
    setMb(0);
    setSb(0);
    setAmountOverride("");
    setMode("Transfer");
    setSuccessTx(null);
  };

  const handleAddExpense = () => {
    const amt = parseFloat(expAmount);
    if (!amt || amt <= 0) return;

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

  return (
    <div
      className="overflow-y-auto pb-24 p-4"
      style={{ width: "100%", boxSizing: "border-box" }}
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

      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        {/* Left Column - Forms */}
        <div className="space-y-6">
          {successTx ? (
            <div className="bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.2)] rounded p-4 flex flex-col animate-in fade-in zoom-in-95 duration-200">
              <div className="flex justify-center animate-pulse">
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

              <div className="flex w-full space-x-2">
                <button
                  onClick={handleReset}
                  className="flex-1 py-3 bg-[var(--color-surface-1)] text-[var(--color-foreground)] text-[11px] font-bold font-mono rounded cursor-pointer flex justify-center items-center gap-2 border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                >
                  <Plus size={14} /> NEW ENTRY
                </button>
                <button
                  onClick={() => {
                    let bagsList: string[] = [];
                    if (bb > 0) bagsList.push(`${bb} BB`);
                    if (mb > 0) bagsList.push(`${mb} MB`);
                    if (sb > 0) bagsList.push(`${sb} SB`);
                    
                    import('../../lib/escposReceipts').then(m => m.printBluetoothReceipt({
                      entryRef: successTx.id,
                      hubName: 'Marketing Desk',
                      name: successTx.name,
                      route: route,
                      destination: bagsList.join(' · '),
                      amount: successTx.amount,
                      paymentMode: successTx.mode,
                      bank: successTx.bank
                    }, 'marketing'));
                  }}
                  className="flex-1 py-3 bg-[var(--color-success)] text-[#0D1117] text-[11px] font-bold font-mono rounded cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-opacity-95 border-none"
                >
                  <span className="text-[14px] mb-0.5">🖨️</span>
                  <span>POS PRINT</span>
                </button>
              </div>
              <button
                onClick={handleDownloadReceipt}
                style={{
                  width: "100%",
                  padding: "11px",
                  background: "transparent",
                  border: "1px solid rgba(16,185,129,0.3)",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 11,
                  fontFamily: "monospace",
                  fontWeight: 700,
                  color: "var(--color-success)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  marginTop: 8,
                }}
              >
                <Printer size={14} /> PRINT RECEIPT
              </button>
            </div>
          ) : (
            <div className="space-y-4 bg-[rgba(255,255,255,0.02)] p-4 md:mx-0 md:rounded-xl md:border border-y border-[var(--color-border)]">
              <div className="border-b border-[rgba(255,255,255,0.07)] pb-1 mb-2">
                <span
                  style={{
                    fontFamily: "JetBrains Mono",
                    fontSize: 10,
                    color: "#10B981",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                  }}
                >
                  ▸ NEW MARKETING ENTRY
                </span>
              </div>

              <div className="space-y-3">
                <input
                  placeholder="Customer Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
                />
                <div className="relative">
                  <MessageSquare size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
                  <input
                    type="tel"
                    placeholder="Include country code for foreign customers (e.g. +44, +1, +233)"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={`w-full h-11 pl-9 pr-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
                  />
                </div>

                <div className="flex space-x-3">
                  <select
                    value={route}
                    onChange={(e) => setRoute(e.target.value)}
                    className={`flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans min-w-0 ${mktgFocusClasses}`}
                  >
                    {Object.keys(pricingMatrix).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                    className={`flex-1 h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans min-w-0 ${mktgFocusClasses}`}
                  >
                    <option value="Cash">Cash</option>
                    <option value="Transfer">Transfer</option>
                    <option value="POS">POS</option>
                  </select>
                </div>

                {mode === "Transfer" && (
                  <div className="space-y-2">
                    <select
                      value={bank}
                      onChange={(e) => setBank(e.target.value)}
                      className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
                    >
                      {BANKS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    <PaymentNarrationBox narrationCode={narrationCode} />
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {[
                    { key: "bb", label: "BB", val: bb, set: setBb },
                    { key: "mb", label: "MB", val: mb, set: setMb },
                    { key: "sb", label: "SB", val: sb, set: setSb },
                  ].map((bag) => (
                    <div
                      key={bag.key}
                      className="bg-[var(--color-surface-1)] rounded p-2 flex items-center justify-between border border-[rgba(255,255,255,0.07)]"
                      style={{ flex: "1 1 calc(33% - 8px)", minWidth: 90 }}
                    >
                      <span className="text-[11px] font-bold font-mono text-[var(--color-muted)]">
                        {bag.label}
                      </span>
                      <input
                        type="number"
                        min="0"
                        value={bag.val || ""}
                        onChange={(e) => bag.set(parseInt(e.target.value) || 0)}
                        className="w-10 h-7 text-center text-sm font-bold bg-transparent border-none p-0 focus:ring-0 text-[var(--color-foreground)]"
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex justify-between items-center py-2 bg-[var(--color-surface-1)] px-3 rounded border border-[rgba(255,255,255,0.07)]">
                  <span className="text-[10px] font-mono text-[var(--color-light-muted)]">
                    TOTAL AMOUNT
                  </span>
                  <div className="flex items-center">
                    <span className="text-[14px] font-bold font-mono text-[var(--color-muted)] mr-1">₦</span>
                    <input
                      type="number"
                      value={amountOverride !== "" ? amountOverride : (minAmount > 0 ? minAmount : "")}
                      onChange={(e) => setAmountOverride(e.target.value)}
                      placeholder={minAmount > 0 ? minAmount.toString() : "0"}
                      className={`w-24 bg-transparent border-none text-right text-[18px] font-bold font-mono p-0 focus:ring-0 ${totalAmount > 0 ? "text-[var(--color-success)]" : "text-[var(--color-muted)]"} ${amountOverride !== "" && parsedOverride < minAmount ? "text-[var(--color-error)]" : ""}`}
                      style={{ fontFamily: "JetBrains Mono" }}
                    />
                  </div>
                </div>

                <button
                  onClick={handleAddEntry}
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
              </div>
            </div>
          )}

          {/* Expense Section */}
          <div className="space-y-4 pt-4 border-t border-[rgba(255,255,255,0.07)] md:border-none md:pt-0">
            <div className="border-b border-[rgba(255,255,255,0.07)] pb-1 mb-2">
              <span
                style={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 10,
                  color: "#10B981",
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
                className={`flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
              >
                {EXPENSE_CATEGORIES.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Amount"
                value={expAmount}
                onChange={(e) => setExpAmount(e.target.value)}
                className={`w-[100px] h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
              />
            </div>
            <div className="flex space-x-2">
              <input
                placeholder="Description (optional)"
                value={expDesc}
                onChange={(e) => setExpDesc(e.target.value)}
                className={`flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
              />
              <button
                onClick={handleAddExpense}
                disabled={!expAmount}
                className="h-11 px-4 bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[12px] font-mono font-bold rounded disabled:opacity-50 cursor-pointer hover:bg-[var(--color-surface-3)] transition-colors"
              >
                LOG
              </button>
            </div>

            <div className="bg-[var(--color-border)] p-3 rounded mt-4 space-y-2">
              <div className="flex justify-between items-center text-[10px] font-mono uppercase">
                <span className="text-[var(--color-muted)]">
                  Expenses Today
                </span>
                <span
                  className="text-[var(--color-error)]"
                  style={{ fontFamily: "JetBrains Mono" }}
                >
                  {fmt(totalExpenses)}
                </span>
              </div>
              <div className="flex justify-between items-center text-[11px] font-bold font-mono uppercase border-t border-[rgba(255,255,255,0.07)] pt-2">
                <span className="text-[var(--color-light-muted)]">
                  Balance to Remit
                </span>
                <span
                  className="text-[var(--color-success)]"
                  style={{ fontFamily: "JetBrains Mono" }}
                >
                  {fmt(balanceToRemit)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Scoreboard & Entries */}
        <aside className="space-y-6">
          <div className="space-y-3 sticky top-4">
            <div className="border-b border-[rgba(255,255,255,0.07)] pb-1 mb-2">
              <span
                style={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 10,
                  color: "#10B981",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                ▸ TODAY'S RECORD
              </span>
            </div>

            <div className="flex w-full space-x-3">
              <div className="flex-1 bg-[rgba(16,185,129,0.05)] rounded border border-[rgba(16,185,129,0.2)] p-3 flex flex-col justify-between">
                <div
                  className="text-[20px] font-bold font-mono text-[var(--color-success)]"
                  style={{ fontFamily: "JetBrains Mono" }}
                >
                  {fmt(totalSales)}
                </div>
                <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase mt-1">
                  Total Sales
                </div>
              </div>
              <div className="flex-1 bg-[var(--color-surface-1)] rounded border border-[rgba(255,255,255,0.07)] p-3 flex flex-col justify-between">
                <div
                  className="text-[20px] font-bold font-mono text-[var(--color-foreground)]"
                  style={{ fontFamily: "JetBrains Mono" }}
                >
                  {marketingTxs.length}
                </div>
                <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase mt-1">
                  Customers
                </div>
              </div>
            </div>

            <div className="bg-[var(--color-surface-1)] p-3 rounded flex justify-between space-x-4">
              <div className="flex-1 text-center border-r border-[var(--color-border)]">
                <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase">
                  Cash
                </div>
                <div
                  className="text-[12px] font-bold font-mono text-[var(--color-success)] mt-1"
                  style={{ fontFamily: "JetBrains Mono" }}
                >
                  {fmt(cashSales)}
                </div>
              </div>
              <div className="flex-1 text-center">
                <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase">
                  Transfer
                </div>
                <div
                  className="text-[12px] font-bold font-mono text-[var(--color-success)] mt-1"
                  style={{ fontFamily: "JetBrains Mono" }}
                >
                  {fmt(transferSales)}
                </div>
              </div>
            </div>

            {/* Entries Today */}
            <div className="pt-4 border-t border-[rgba(255,255,255,0.07)] mt-4">
              <div className="border-b border-[rgba(255,255,255,0.07)] pb-1 mb-2">
                <span
                  style={{
                    fontFamily: "JetBrains Mono",
                    fontSize: 10,
                    color: "#10B981",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                  }}
                >
                  ▸ ENTRIES TODAY
                </span>
              </div>

              {marketingTxs.length === 0 ? (
                <div className="text-[11px] text-[var(--color-muted)] font-mono py-4 text-center border border-dashed border-[var(--color-surface-2)] rounded">
                  No entries yet
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {marketingTxs.map((t) => (
                    <div
                      key={t.id}
                      className="flex justify-between items-center bg-[var(--color-surface-1)] p-3 rounded border border-[var(--color-border)]"
                    >
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="text-[12px] font-bold text-[var(--color-foreground)] truncate">
                          {t.name}
                        </div>
                        <div className="text-[10px] font-mono text-[var(--color-muted)]">
                          {t.detail}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className="text-[12px] font-bold font-mono text-[var(--color-success)]"
                          style={{ fontFamily: "JetBrains Mono" }}
                        >
                          {fmt(t.amount)}
                        </div>
                        <div className="text-[9px] font-mono text-[var(--color-muted)]">
                          {t.mode} {t.bank ? `· ${t.bank}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowCloseModal(true)}
              className="w-full py-[14px] mt-4 bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] text-[var(--color-success)] text-[12px] font-bold font-mono rounded border border-[rgba(16,185,129,0.2)] transition-colors cursor-pointer"
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
              borderRadius: 16,
              border: "1px solid var(--color-surface-2)",
              padding: 24,
              position: "relative",
            }}
          >
            <button
              onClick={() => setShowCloseModal(false)}
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                color: "var(--color-muted)",
              }}
            >
              ×
            </button>
            <div
              style={{
                fontSize: 12,
                fontFamily: "monospace",
                color: "#10B981",
                letterSpacing: "0.1em",
                marginBottom: 12,
                fontWeight: "bold",
              }}
            >
              ▸ MARKETING DAILY CLOSE
            </div>

            <div
              style={{
                fontSize: 13,
                color: "var(--color-muted)",
                marginBottom: 20,
              }}
            >
              {new Date().toLocaleDateString("en-GB", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
              <br />
              Agent: {user.name}
            </div>

            <div
              style={{
                borderTop: "1px solid var(--color-border)",
                paddingTop: 16,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "var(--color-light-muted)",
                  marginBottom: 8,
                  letterSpacing: "0.05em",
                }}
              >
                ENTRIES THIS SESSION
              </div>
              <div
                className="flex justify-between"
                style={{ fontSize: 13, marginBottom: 4 }}
              >
                <span className="text-[var(--color-muted)]">
                  Customers served:
                </span>
                <span className="text-[var(--color-foreground)]">
                  {marketingTxs.length}
                </span>
              </div>
              <div className="flex justify-between" style={{ fontSize: 13 }}>
                <span className="text-[var(--color-muted)]">
                  Routes covered:
                </span>
                <span className="text-[var(--color-foreground)] text-right max-w-[200px] truncate">
                  {[
                    ...new Set(
                      marketingTxs.map((t) => t.detail.split(" · ")[0]),
                    ),
                  ].join(", ")}
                </span>
              </div>
            </div>

            <div
              style={{
                borderTop: "1px solid var(--color-border)",
                paddingTop: 16,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "var(--color-light-muted)",
                  marginBottom: 8,
                  letterSpacing: "0.05em",
                }}
              >
                REVENUE BREAKDOWN
              </div>
              <div
                className="flex justify-between"
                style={{ fontSize: 13, marginBottom: 4 }}
              >
                <span className="text-[var(--color-muted)]">Total Sales:</span>
                <span className="text-[var(--color-foreground)] font-mono font-bold">
                  {fmt(totalSales)}
                </span>
              </div>
              <div
                className="flex justify-between"
                style={{ fontSize: 13, marginBottom: 4 }}
              >
                <span className="text-[var(--color-muted)]">Cash Sales:</span>
                <span className="text-[var(--color-success)] font-mono">
                  {fmt(cashSales)}
                </span>
              </div>
              <div className="flex justify-between" style={{ fontSize: 13 }}>
                <span className="text-[var(--color-muted)]">
                  Transfer Sales:
                </span>
                <span className="text-[var(--color-accent-blue)] font-mono">
                  {fmt(transferSales)}
                </span>
              </div>
            </div>

            <div
              style={{
                borderTop: "1px solid var(--color-border)",
                paddingTop: 16,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "var(--color-light-muted)",
                  marginBottom: 8,
                  letterSpacing: "0.05em",
                }}
              >
                EXPENSES
              </div>
              {expenses.length > 0 ? (
                expenses.map((e, i) => (
                  <div
                    key={i}
                    className="flex justify-between"
                    style={{ fontSize: 13, marginBottom: 4 }}
                  >
                    <span className="text-[var(--color-muted)]">{e.type}:</span>
                    <span className="text-[var(--color-error)] font-mono">
                      {fmt(e.amount)}
                    </span>
                  </div>
                ))
              ) : (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--color-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No expenses logged.
                </div>
              )}
              <div
                className="flex justify-between"
                style={{
                  fontSize: 13,
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: "1px dashed var(--color-surface-2)",
                }}
              >
                <span className="text-[var(--color-foreground)]">
                  TOTAL EXPENSES:
                </span>
                <span className="text-[var(--color-error)] font-mono font-bold">
                  {fmt(totalExpenses)}
                </span>
              </div>
            </div>

            <div
              style={{
                background: "rgba(16,185,129,0.1)",
                border: "1px solid #10B981",
                borderRadius: 8,
                padding: 16,
                marginBottom: 24,
              }}
            >
              <div className="flex justify-between items-center">
                <span
                  style={{ fontSize: 14, color: "#10B981", fontWeight: "bold" }}
                >
                  BALANCE TO REMIT:
                </span>
                <span
                  style={{
                    fontSize: 20,
                    color: "#10B981",
                    fontWeight: "bold",
                    fontFamily: "monospace",
                  }}
                >
                  {fmt(balanceToRemit)}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(16,185,129,0.7)",
                  marginTop: 4,
                }}
              >
                (Cash collected minus expenses)
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleDownloadSummary}
                style={{
                  flex: 1,
                  padding: 12,
                  background: "transparent",
                  border: "1px solid rgba(16,185,129,0.4)",
                  borderRadius: 8,
                  color: "#10B981",
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
                style={{
                  flex: 1,
                  padding: 12,
                  background: "#10B981",
                  border: "none",
                  borderRadius: 8,
                  color: "#000",
                  fontSize: 11,
                  fontFamily: "monospace",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                CONFIRM & CLOSE DAY
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
