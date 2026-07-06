import { useState, useEffect } from "react";
import { User, Transaction, Expense } from "../../lib/types";
import { PRICING, BANKS, EXPENSE_CATEGORIES, AIRLINES } from "../../lib/constants";
import { fmt, uid, tnow } from "../../lib/helpers";
import { Plus, CheckCircle, Loader2, ClipboardList, MessageSquare, Printer, Minus, TrendingDown, BarChart2 } from "lucide-react";
import { motion } from "motion/react";
import { supabase } from "../../lib/supabase";

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

  const generateMktAwb = () => `AWB-MK-${Math.floor(100000 + Math.random() * 900000)}`;
  const [awb, setAwb] = useState(generateMktAwb);

  // Available airlines — loaded from Supabase Storage (uploaded via AirlineLogoManager)
  const [availableAirlines, setAvailableAirlines] = useState<string[]>(
    AIRLINES.map(a => a.name)
  );
  const [airline, setAirline] = useState(AIRLINES[0]?.name || '');

  useEffect(() => {
    import('../../lib/airlineLogos').then(({ listAirlineLogos }) => {
      listAirlineLogos().then(logos => {
        if (logos.length > 0) {
          const names = logos.map(l => l.name);
          setAvailableAirlines(names);
          setAirline(names[0]);
        }
      }).catch(() => {});
    });
  }, []);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [route, setRoute] = useState<string>(Object.keys(pricingMatrix)[0]);
  const [mode, setMode] = useState<string>("Transfer");
  const [bank, setBank] = useState<string>(BANKS[0]);
  const [bb, setBb] = useState(0);
  const [mb, setMb] = useState(0);
  const [sb, setSb] = useState(0);
  const [amountOverride, setAmountOverride] = useState("");
  const [debtorName, setDebtorName] = useState("");

  const [narrationCode, setNarrationCode] = useState<string>("");

  useEffect(() => {
    if ((mode === "Transfer" || mode === "TransferCash" || mode === "POS") && !narrationCode) {
      import("../../lib/helpers").then(({ generatePaymentNarration }) => {
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

  useEffect(() => {
    if (successTx) {
      document.querySelectorAll('.overflow-y-auto, main').forEach(el => {
        el.scrollTop = 0;
      });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [successTx]);

  // Expense State
  const [expType, setExpType] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [expAmount, setExpAmount] = useState("");
  const [expDesc, setExpDesc] = useState("");

  const routePrices = pricingMatrix[route] || { BB: 0, MB: 0, SB: 0 };
  const minAmount = bb * routePrices.BB + mb * routePrices.MB + sb * routePrices.SB;
  const parsedOverride = parseFloat(amountOverride) || 0;
  const totalAmount = amountOverride !== "" ? parsedOverride : minAmount;

  const isValid = name.trim().length > 0 && totalAmount > 0 && (amountOverride === "" || parsedOverride >= minAmount);

  // "Less Transfer" — daily adjustment for 3rd-party/corporate transfers (Govt/Honda/Zion)
  // that belong to other accounts and should be excluded from the day's cash tally
  const [lessTransfer, setLessTransfer] = useState(0);
  const [lessTransferInput, setLessTransferInput] = useState('');
  const [lessTransferLabel, setLessTransferLabel] = useState('');

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

  const handleDownloadReceipt = async () => {
    if (successTx) {
      const { downloadMarketingReceipt } = await import("./MarketingReceipt");
      const data = {
        entryRef: successTx.id,
        awbTagNumber: successTx.awb_tag_number,
        airline: successTx.airline,
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

  const handleCloseDay = async () => {
    if (!window.confirm('Close today\'s marketing session? This cannot be undone.')) return;
    try {
      setShowCloseModal(false);
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
      alert('Day closed successfully');
    } catch (err: any) {
      alert('Failed to close day: ' + err.message);
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

  const handleAddEntry = () => {
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
    setAmountOverride("");
    setMode("Transfer");
    setNarrationCode("");
    setSuccessTx(null);
    setAwb(generateMktAwb());
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
                  <span className="text-[10px] font-mono text-[var(--color-muted)]">AWB</span>
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
                    import('../../lib/escposMarketingPrinting').then(async (m) => {
                      // Build the MarketingReceiptPrintData object
                      const printData = {
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
                        airline: successTx.airline,
                        trackingUrl: `https://ehimultisystems.com/track/${successTx.id}`,
                      };
                      const bytes = await m.compileMarketingReceiptStream(printData, '80mm');
                      const { printViaBluetooth } = await import('../../lib/escpos');
                      await printViaBluetooth(bytes);
                    });
                  }}
                  className="py-2.5 bg-[var(--color-success)] text-[#0D1117] text-[11px] font-bold font-mono rounded cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-opacity-95 border-none"
                >
                  <span className="text-[14px] mb-0.5">🖨️</span>
                  <span>PRINT POS (80mm)</span>
                </button>

                <button
                  onClick={() => {
                    import('../../lib/escposMarketingPrinting').then(async (m) => {
                      const printData = {
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
                        airline: successTx.airline,
                        trackingUrl: `https://ehimultisystems.com/track/${successTx.id}`,
                      };
                      const bytes = await m.compileMarketingReceiptStream(printData, '58mm');
                      const { printViaBluetooth } = await import('../../lib/escpos');
                      await printViaBluetooth(bytes);
                    });
                  }}
                  className="py-2.5 bg-[var(--color-success)] bg-opacity-80 text-[#0D1117] text-[11px] font-bold font-mono rounded cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-opacity-95 border-none"
                >
                  <span className="text-[14px] mb-0.5">🖨️</span>
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
                        }).catch(() => alert('Bluetooth printer not connected'));
                      }}
                      className="py-2.5 bg-[rgba(16,185,129,0.12)] border border-[rgba(16,185,129,0.3)] text-[var(--color-success)] text-[11px] font-bold font-mono rounded-lg cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-[rgba(16,185,129,0.2)] transition-colors"
                    >
                      <span className="text-[14px] mb-0.5">🏷️</span>
                      <span>TAGS (80mm)</span>
                    </button>
                    <button
                      onClick={() => {
                        import('../../lib/escposTagPrinting').then(async (m) => {
                          await m.printMarketingTags(successTx!, bb, mb, sb, '58mm');
                        }).catch(() => alert('Bluetooth printer not connected'));
                      }}
                      className="py-2.5 bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.2)] text-[var(--color-success)] text-[11px] font-bold font-mono rounded-lg cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-[rgba(16,185,129,0.15)] transition-colors"
                    >
                      <span className="text-[14px] mb-0.5">🏷️</span>
                      <span>TAGS (58mm)</span>
                    </button>
                  </div>
                </div>
              )}
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
                {/* Auto-generated AWB — read-only, regenerates on New Entry */}
                <div className="flex items-center justify-between px-3 h-9 rounded bg-[var(--color-surface-1)] border border-[rgba(16,185,129,0.2)]">
                  <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">AWB</span>
                  <span className="text-[11px] font-mono text-[var(--color-success)] font-bold">{awb}</span>
                </div>
                <select
                  value={airline}
                  onChange={(e) => setAirline(e.target.value)}
                  className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
                >
                  {availableAirlines.map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
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
                    <option value="Transfer">Transfer (Bank)</option>
                    <option value="TransferCash">Transfer → Cash</option>
                    <option value="POS">POS</option>
                    <option value="Debt">Debt / Credit</option>
                  </select>
                </div>

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
                      className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
                    >
                      <option disabled value="">Bank / POS Terminal</option>
                      {BANKS.map((b) => (
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
                      type="text"
                      placeholder="Debtor Name / Company"
                      value={debtorName}
                      onChange={(e) => setDebtorName(e.target.value)}
                      className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${mktgFocusClasses}`}
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
                      className="bg-[var(--color-surface-1)] rounded-xl border border-[rgba(255,255,255,0.07)] flex flex-col items-center py-3 gap-2"
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

            {/* Expense log today */}
            {expenses.length > 0 && (
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[rgba(255,255,255,0.07)] divide-y divide-[rgba(255,255,255,0.04)] mt-2">
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
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[rgba(255,255,255,0.07)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.07)]">
                <span className="text-[10px] font-mono text-[#10B981] uppercase tracking-widest font-bold">▸ SALES ANALYSIS</span>
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
                    <span className="text-[var(--color-muted)]">Debt / Credit</span>
                    <span className="text-orange-400" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(debtSales)}</span>
                  </div>
                )}

                {/* Less Transfer adjustment */}
                <div className="border-t border-[rgba(255,255,255,0.07)] pt-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-muted)] shrink-0">Less Transfer</span>
                    <div className="flex gap-1 items-center">
                      <input
                        type="number"
                        placeholder="0"
                        value={lessTransferInput}
                        onChange={e => {
                          setLessTransferInput(e.target.value);
                          setLessTransfer(parseFloat(e.target.value) || 0);
                        }}
                        className="w-24 h-7 text-right text-[11px] font-mono bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] rounded px-2 text-red-400 focus:outline-none"
                        style={{ fontFamily: 'JetBrains Mono' }}
                      />
                    </div>
                  </div>
                  {lessTransfer > 0 && (
                    <input
                      type="text"
                      placeholder="Who? (e.g. Govt/Honda/Zion)"
                      value={lessTransferLabel}
                      onChange={e => setLessTransferLabel(e.target.value)}
                      className="w-full h-7 text-[10px] font-mono bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] rounded px-2 text-[var(--color-muted)] focus:outline-none"
                    />
                  )}
                </div>

                <div className="border-t border-[rgba(255,255,255,0.07)] pt-2 flex justify-between font-bold">
                  <span className="text-[var(--color-foreground)]">Total Sales (Net)</span>
                  <span className="text-[#10B981]" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(totalSales - lessTransfer)}</span>
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
                <span className="text-[#10B981]">Balance Cash</span>
                <span className={balanceToRemit >= 0 ? 'text-[#10B981]' : 'text-red-400'} style={{ fontFamily: 'JetBrains Mono' }}>{fmt(Math.abs(balanceToRemit))}{balanceToRemit < 0 ? ' (deficit)' : ''}</span>
              </div>
            </div>

            {/* Route Counts */}
            {Object.keys(routeCounts).length > 0 && (
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[rgba(255,255,255,0.07)] overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[rgba(255,255,255,0.07)]">
                  <BarChart2 size={12} className="text-[#10B981]" />
                  <span className="text-[10px] font-mono text-[#10B981] uppercase tracking-widest font-bold">ROUTES TODAY</span>
                </div>
                <div className="px-4 py-3 space-y-1.5">
                  {Object.entries(routeCounts).sort((a,b) => b[1]-a[1]).map(([r, cnt]) => (
                    <div key={r} className="flex justify-between items-center text-[12px] font-mono">
                      <span className="text-[var(--color-muted)] truncate mr-2">{r.split('/')[1] || r}</span>
                      <span className="font-bold text-[var(--color-foreground)] shrink-0">{cnt} pkg{cnt !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center text-[12px] font-mono border-t border-[rgba(255,255,255,0.07)] pt-1.5 mt-1">
                    <span className="text-[var(--color-muted)]">Total</span>
                    <span className="font-bold text-[#10B981]">{marketingTxs.length}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Entries Today */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[rgba(255,255,255,0.07)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.07)]">
                <span className="text-[10px] font-mono text-[#10B981] uppercase tracking-widest font-bold">▸ ENTRIES TODAY</span>
              </div>
              {marketingTxs.length === 0 ? (
                <div className="text-[11px] text-[var(--color-muted)] font-mono py-6 text-center">
                  No entries yet
                </div>
              ) : (
                <div className="divide-y divide-[rgba(255,255,255,0.04)] max-h-[340px] overflow-y-auto">
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
            {/* Header */}
            <div className="text-[10px] font-mono text-[#10B981] tracking-widest font-bold mb-1">▸ ARENA SALES ANALYSIS</div>
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
              <div className="flex justify-between font-bold border-t border-[var(--color-border)] pt-1.5"><span className="text-[var(--color-foreground)]">Total Sales (Net)</span><span className="text-[#10B981]">{fmt(totalSales - lessTransfer)}</span></div>
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
            <div className="bg-[rgba(16,185,129,0.1)] border border-[#10B981] rounded-xl p-4 mb-6">
              <div className="flex justify-between items-center">
                <span className="text-[14px] text-[#10B981] font-bold font-mono">BAL. CASH</span>
                <span className={`text-[22px] font-bold font-mono ${balanceToRemit >= 0 ? 'text-[#10B981]' : 'text-red-400'}`} style={{ fontFamily: 'JetBrains Mono' }}>{fmt(Math.abs(balanceToRemit))}</span>
              </div>
              <div className="text-[11px] text-[rgba(16,185,129,0.7)] mt-1">
                ({fmt(cashSales + transferCashSales)} cash-in-hand{lessTransfer > 0 ? ` − ${fmt(lessTransfer)} less-transfer` : ''} − {fmt(totalExpenses)} expenses)
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
