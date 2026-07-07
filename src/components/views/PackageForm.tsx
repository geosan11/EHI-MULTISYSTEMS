import { useState, useEffect } from "react";
import { User, Transaction, Expense } from "../../lib/types";
import { BANKS, EXPENSE_CATEGORIES } from "../../lib/constants";
import { fmt, uid, tnow, generatePaymentNarration } from "../../lib/helpers";
import { Plus, CheckCircle, Loader2, ClipboardList, BarChart2, Printer, MessageSquare } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { sendReceiptWhatsApp, buildPackageWhatsApp } from "../../lib/notifications";

export const PackageForm = ({
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
  // Destinations are the live hub list from Supabase (not a hardcoded
  // constant) so a new hub added in Settings shows up here immediately --
  // each option is prefixed with its IATA-style hub code for consistency
  // with the Cargo/ValueJet route pickers. Cached to localStorage for an
  // instant first paint / offline fallback while the fetch is in flight.
  const HUB_DEST_CACHE_KEY = 'ehi_hub_destinations';
  const [destinations, setDestinations] = useState<string[]>(() => {
    try {
      const cached = localStorage.getItem(HUB_DEST_CACHE_KEY);
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    supabase.from('hubs').select('name, code').eq('active', true).order('name').then(({ data, error }) => {
      if (data && !error && data.length > 0) {
        const formatted = data.map((h: any) => `${h.code}/${h.name}`);
        setDestinations(formatted);
        setDestination(prev => prev || formatted[0]);
        try { localStorage.setItem(HUB_DEST_CACHE_KEY, JSON.stringify(formatted)); } catch {}
      }
    });
  }, []);

  const [trackingRef, setTrackingRef] = useState<string>('');
  useEffect(() => {
    // Tracking numbers are allocated atomically server-side so two agents
    // can never be issued the same one, unlike the old client-random AWB
    // fallback that caused a real collision risk under concurrent entry.
    const allocate = async () => {
      const { data, error } = await supabase.rpc('allocate_package_tracking');
      if (!error && data) setTrackingRef(data);
    };
    allocate();
  }, []);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [destination, setDestination] = useState<string>(() => destinations[0] || "");
  const [contentType, setContentType] = useState<'Package' | 'Parcel'>('Package');
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<string>("Cash");
  const [bank, setBank] = useState<string>(BANKS[0]);
  const [debtorName, setDebtorName] = useState("");
  const [narrationCode, setNarrationCode] = useState<string>("");

  useEffect(() => {
    if ((mode === "Transfer" || mode === "POS") && !narrationCode) {
      setNarrationCode(generatePaymentNarration(user.hub_code || user.hub, Math.floor(Math.random() * 900) + 100));
    }
  }, [mode, narrationCode, user.hub, user.hub_code]);

  const [successTx, setSuccessTx] = useState<Transaction | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [expType, setExpType] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [expAmount, setExpAmount] = useState("");
  const [expDesc, setExpDesc] = useState("");

  const parsedAmount = parseFloat(amount) || 0;
  const isValid = (mode === "Debt" ? debtorName.trim().length > 0 : name.trim().length > 0)
    && parsedAmount > 0 && destination.trim().length > 0 && !!trackingRef;

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
  const totalExpenses = expenses.filter(e => isToday(e.created_at)).reduce((sum, e) => sum + e.amount, 0);
  const physicalCash = cashSales;
  const balanceCash = physicalCash - totalExpenses;

  const destinationCounts: Record<string, number> = {};
  packageTxs.forEach(t => {
    const d = t.destination || 'Unknown';
    destinationCounts[d] = (destinationCounts[d] || 0) + 1;
  });

  const unpaidDebts = packageTxs.filter(t => t.mode === 'Debt' && !t.debtPaid);

  const [showCloseModal, setShowCloseModal] = useState(false);

  const handleAddEntry = () => {
    if (!isValid || submitting) return;
    setSubmitting(true);

    const tx: Transaction = {
      id: trackingRef,
      name: mode === "Debt" ? debtorName.trim() : name.trim(),
      detail: `${destination} · ${contentType}`,
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
      hub: user.hub,
      hub_id: user.hub_id,
      debtPaid: mode === "Debt" ? false : undefined,
    };

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
    setAmount("");
    setMode("Cash");
    setNarrationCode("");
    setSuccessTx(null);
    supabase.rpc('allocate_package_tracking').then(({ data, error }) => {
      if (!error && data) setTrackingRef(data);
    });
  };

  const handleAddExpense = () => {
    const amt = parseFloat(expAmount);
    if (!amt || amt <= 0) return;
    onAddExpense({ id: uid('EX' as any), type: expType, amount: amt, description: expDesc.trim(), time: tnow() });
    setExpAmount("");
    setExpDesc("");
  };

  const handleMarkDebtPaid = (tx: Transaction) => {
    onAddTx({ ...tx, debtPaid: true, debtPaidAt: new Date().toISOString() });
  };

  const handleCloseDay = async () => {
    if (!window.confirm("Close today's Package Desk session? This cannot be undone.")) return;
    try {
      setShowCloseModal(false);
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
      alert('Day closed successfully');
    } catch (err: any) {
      alert('Failed to close day: ' + err.message);
    }
  };

  const focusClasses = "focus:outline-none focus:ring-2 focus:ring-[rgba(59,130,246,0.5)] focus:border-[rgba(59,130,246,0.5)] transition-colors";

  return (
    <div className="overflow-y-auto overflow-x-hidden pb-24 p-4 max-w-5xl mx-auto" style={{ width: "100%", boxSizing: "border-box", minHeight: 0, flex: 1 }}>
      <div className="flex justify-between items-center text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-widest border-b border-[var(--color-border)] pb-2 mb-6">
        <div>{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
        <div className="flex items-center gap-3">
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
                    import('../../lib/escposPackagePrinting').then(async (m) => {
                      const printData = {
                        entryRef: successTx.id,
                        date: new Date().toLocaleDateString("en-GB"),
                        agentName: user.name,
                        customerName: successTx.name,
                        phone: phone || undefined,
                        destination,
                        contentType,
                        amount: successTx.amount,
                        paymentMode: successTx.mode,
                        paymentNarration: successTx.paymentNarration,
                        bankName: bank || undefined,
                        trackingUrl: `https://ehimultisystems.com/track/${successTx.id}`,
                      };
                      const bytes = await m.compilePackageReceiptStream(printData, '80mm');
                      const { printViaBluetooth } = await import('../../lib/escpos');
                      await printViaBluetooth(bytes);
                    }).catch(() => alert('Bluetooth printer not connected'));
                  }}
                  className="py-2.5 bg-[var(--color-accent-cobalt)] text-white text-[11px] font-bold font-mono rounded cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-opacity-95 border-none"
                >
                  <span className="text-[14px] mb-0.5">🖨️</span>
                  <span>PRINT POS (80mm)</span>
                </button>

                <button
                  onClick={() => {
                    import('../../lib/escposPackagePrinting').then(async (m) => {
                      const printData = {
                        entryRef: successTx.id,
                        date: new Date().toLocaleDateString("en-GB"),
                        agentName: user.name,
                        customerName: successTx.name,
                        phone: phone || undefined,
                        destination,
                        contentType,
                        amount: successTx.amount,
                        paymentMode: successTx.mode,
                        paymentNarration: successTx.paymentNarration,
                        bankName: bank || undefined,
                        trackingUrl: `https://ehimultisystems.com/track/${successTx.id}`,
                      };
                      const bytes = await m.compilePackageReceiptStream(printData, '58mm');
                      const { printViaBluetooth } = await import('../../lib/escpos');
                      await printViaBluetooth(bytes);
                    }).catch(() => alert('Bluetooth printer not connected'));
                  }}
                  className="py-2.5 bg-[var(--color-accent-cobalt)] bg-opacity-80 text-white text-[11px] font-bold font-mono rounded cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-opacity-95 border-none"
                >
                  <span className="text-[14px] mb-0.5">🖨️</span>
                  <span>PRINT POS (58mm)</span>
                </button>
              </div>

              <button
                onClick={() => {
                  import('./PackageReceipt').then(m => m.downloadPackageReceipt({
                    entryRef: successTx.id,
                    date: new Date().toLocaleDateString("en-GB"),
                    agentName: user.name,
                    customerName: successTx.name,
                    phone: phone || undefined,
                    destination,
                    contentType,
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
            </div>
          ) : (
            <div className="space-y-4 bg-[rgba(255,255,255,0.02)] p-4 md:mx-0 md:rounded-xl md:border border-y border-[var(--color-border)]">
              <div className="border-b border-[rgba(255,255,255,0.07)] pb-1 mb-2">
                <span style={{ fontFamily: "JetBrains Mono", fontSize: 10, color: "#3B82F6", letterSpacing: "0.12em", textTransform: "uppercase" }}>
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
                      placeholder="Customer Name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${focusClasses}`}
                    />
                    <div className="relative">
                      <MessageSquare size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
                      <input
                        type="tel"
                        placeholder="Phone (optional, for WhatsApp receipt)"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className={`w-full h-11 pl-9 pr-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${focusClasses}`}
                      />
                    </div>
                  </>
                )}

                <div className="flex space-x-3">
                  <select
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    className={`flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans min-w-0 ${focusClasses}`}
                  >
                    {destinations.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value as 'Package' | 'Parcel')}
                    className={`flex-1 h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans min-w-0 ${focusClasses}`}
                  >
                    <option value="Package">Package</option>
                    <option value="Parcel">Parcel</option>
                  </select>
                </div>

                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${focusClasses}`}
                >
                  <option value="Cash">Cash</option>
                  <option value="POS">POS</option>
                  <option value="Transfer">Bank Transfer</option>
                  <option value="Debt">Debt / Credit</option>
                </select>

                {(mode === "Transfer" || mode === "POS") && (
                  <select
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${focusClasses}`}
                  >
                    {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                )}

                {mode === "Debt" && (
                  <input
                    type="text"
                    placeholder="Debtor Name"
                    value={debtorName}
                    onChange={(e) => setDebtorName(e.target.value)}
                    className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${focusClasses}`}
                  />
                )}

                <div className="flex justify-between items-center py-2 bg-[var(--color-surface-1)] px-3 rounded border border-[rgba(255,255,255,0.07)]">
                  <span className="text-[10px] font-mono text-[var(--color-light-muted)]">AMOUNT</span>
                  <div className="flex items-center">
                    <span className="text-[14px] font-bold font-mono text-[var(--color-muted)] mr-1">₦</span>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0"
                      className="w-24 bg-transparent border-none text-right text-[18px] font-bold font-mono p-0 focus:ring-0 text-[var(--color-accent-cobalt)]"
                    />
                  </div>
                </div>

                <button
                  onClick={handleAddEntry}
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
              </div>
            </div>
          )}

          {/* Expense Section */}
          <div className="space-y-4 pt-4 border-t border-[rgba(255,255,255,0.07)] md:border-none md:pt-0">
            <div className="border-b border-[rgba(255,255,255,0.07)] pb-1 mb-2">
              <span style={{ fontFamily: "JetBrains Mono", fontSize: 10, color: "#3B82F6", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                ▸ LOG EXPENSE
              </span>
            </div>
            <div className="flex space-x-2">
              <select value={expType} onChange={(e) => setExpType(e.target.value)} className={`flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${focusClasses}`}>
                {EXPENSE_CATEGORIES.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <input type="number" placeholder="Amount" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} className={`w-[100px] h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${focusClasses}`} />
            </div>
            <div className="flex space-x-2">
              <input placeholder="Description (optional)" value={expDesc} onChange={(e) => setExpDesc(e.target.value)} className={`flex-1 h-11 px-3 text-[13px] rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans ${focusClasses}`} />
              <button onClick={handleAddExpense} disabled={!expAmount} className="h-11 px-4 bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[12px] font-mono font-bold rounded disabled:opacity-50 cursor-pointer hover:bg-[var(--color-surface-3)] transition-colors">
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
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[rgba(255,255,255,0.07)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.07)]">
                <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] uppercase tracking-widest font-bold">▸ SALES ANALYSIS</span>
                <span className="text-[10px] font-mono text-[var(--color-muted)]">{packageTxs.length} entries</span>
              </div>
              <div className="px-4 py-3 space-y-2 text-[12px] font-mono">
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Total Sales</span><span className="font-bold text-[var(--color-foreground)]">{fmt(totalSales)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Cash</span><span className="text-[var(--color-foreground)]">{fmt(cashSales)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">POS</span><span className="text-[var(--color-foreground)]">{fmt(posSales)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Bank Transfer</span><span className="text-[var(--color-foreground)]">{fmt(transferSales)}</span></div>
                {debtSales > 0 && <div className="flex justify-between"><span className="text-orange-400">Debt / Credit</span><span className="text-orange-400">{fmt(debtSales)}</span></div>}
              </div>
            </div>

            <div className="bg-[rgba(59,130,246,0.05)] rounded-xl border border-[rgba(59,130,246,0.2)] px-4 py-3 space-y-1 text-[12px] font-mono">
              <div className="flex justify-between text-[var(--color-muted)]"><span>Cash on Hand</span><span>{fmt(physicalCash)}</span></div>
              <div className="flex justify-between text-red-400"><span>Expenses</span><span>− {fmt(totalExpenses)}</span></div>
              <div className="flex justify-between font-bold text-[15px] border-t border-[rgba(59,130,246,0.2)] pt-2 mt-1">
                <span className="text-[var(--color-accent-cobalt)]">Balance Cash</span>
                <span className={balanceCash >= 0 ? 'text-[var(--color-accent-cobalt)]' : 'text-red-400'}>{fmt(Math.abs(balanceCash))}{balanceCash < 0 ? ' (deficit)' : ''}</span>
              </div>
            </div>

            {Object.keys(destinationCounts).length > 0 && (
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[rgba(255,255,255,0.07)] overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[rgba(255,255,255,0.07)]">
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

            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[rgba(255,255,255,0.07)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.07)]">
                <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] uppercase tracking-widest font-bold">▸ ENTRIES TODAY</span>
              </div>
              {packageTxs.length === 0 ? (
                <div className="text-[11px] text-[var(--color-muted)] font-mono py-6 text-center">No entries yet</div>
              ) : (
                <div className="divide-y divide-[rgba(255,255,255,0.04)] max-h-[340px] overflow-y-auto">
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
          <div style={{ background: "var(--color-obsidian)", width: "100%", maxWidth: 480, borderRadius: 16, border: "1px solid var(--color-surface-2)", padding: 24, position: "relative" }}>
            <button onClick={() => setShowCloseModal(false)} style={{ position: "absolute", top: 16, right: 16, color: "var(--color-muted)" }}>×</button>
            <div className="text-[10px] font-mono text-[var(--color-accent-cobalt)] tracking-widest font-bold mb-1">▸ PACKAGE DESK SALES ANALYSIS</div>
            <div className="text-[12px] text-[var(--color-muted)] mb-4">
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              <br />Agent: <span className="text-[var(--color-foreground)]">{user.name}</span>
            </div>
            <div className="space-y-1.5 text-[13px] font-mono border-t border-[var(--color-border)] pt-4 mb-4">
              <div className="flex justify-between"><span className="text-[var(--color-muted)]">Total Sales</span><span className="font-bold text-[var(--color-foreground)]">{fmt(totalSales)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-muted)]">Cash</span><span className="text-[var(--color-foreground)]">{fmt(cashSales)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-muted)]">POS</span><span className="text-[var(--color-foreground)]">{fmt(posSales)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-muted)]">Bank Transfer</span><span className="text-[var(--color-foreground)]">{fmt(transferSales)}</span></div>
              {debtSales > 0 && <div className="flex justify-between"><span className="text-orange-400">Debt / Credit</span><span className="text-orange-400">{fmt(debtSales)}</span></div>}
            </div>
            <div className="bg-[rgba(59,130,246,0.1)] border border-[var(--color-accent-cobalt)] rounded-xl p-4 mb-6">
              <div className="flex justify-between items-center">
                <span className="text-[14px] text-[var(--color-accent-cobalt)] font-bold font-mono">BAL. CASH</span>
                <span className={`text-[22px] font-bold font-mono ${balanceCash >= 0 ? 'text-[var(--color-accent-cobalt)]' : 'text-red-400'}`}>{fmt(Math.abs(balanceCash))}</span>
              </div>
              <div className="text-[11px] text-[rgba(59,130,246,0.7)] mt-1">({fmt(cashSales)} cash-in-hand − {fmt(totalExpenses)} expenses)</div>
            </div>
            <div className="flex gap-3">
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
              <button onClick={handleCloseDay} style={{ flex: 1, padding: 12, background: "var(--color-accent-cobalt)", border: "none", borderRadius: 8, color: "#fff", fontSize: 11, fontFamily: "monospace", fontWeight: "bold", cursor: "pointer" }}>
                CONFIRM & CLOSE DAY
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
