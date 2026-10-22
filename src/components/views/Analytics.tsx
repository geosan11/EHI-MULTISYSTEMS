import { useState, useEffect, useMemo, useCallback } from 'react';
import { User, Transaction, Expense } from '../../lib/types';
import { fmt, getShiftBoundary, sanitizeSpreadsheetRows, lagosBusinessDate } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import {
  TrendingUp,
  Package,
  Plane,
  Sparkles,
  ChevronDown,
  AlertCircle,
  Loader2,
  Calendar,
  Download,
  DollarSign,
  Filter,
  FileSpreadsheet,
  CheckCircle2,
  Radar,
  Wallet,
  CreditCard,
  Banknote,
  Building2,
} from 'lucide-react';

export const Analytics = ({
  user,
  transactions,
  expenses = [],
  setDateRange,
  dataLoading = false,
}: {
  user: User;
  transactions: Transaction[];
  expenses?: Expense[];
  dateRange: { start: string; end: string };
  setDateRange: (range: { start: string; end: string }) => void;
  dataLoading?: boolean;
}) => {
  const [period, setPeriod] = useState<'shift' | 'today' | '7days' | 'month' | 'custom'>('shift');
  const [selectedHub, setSelectedHub] = useState<string>('all');
  const [activeView, setActiveView] = useState<'summary' | 'customers' | 'past_shifts'>('summary');
  const [searchQuery, setSearchQuery] = useState('');
  const { showToast } = useToast();

  // Custom Date Range State
  const defaultShift = useMemo(() => {
    const b = getShiftBoundary((user as any).shift_start_hour ?? 18);
    return {
      start: b.start.toISOString().slice(0, 16),
      end: b.end.toISOString().slice(0, 16),
    };
  }, [user]);
  const [customStart, setCustomStart] = useState(defaultShift.start);
  const [customEnd, setCustomEnd] = useState(defaultShift.end);

  const handlePeriodChange = (newPeriod: typeof period) => {
    setPeriod(newPeriod);
    const now = new Date();

    if (newPeriod === 'today' || newPeriod === 'shift') {
      const start = new Date(now.getTime() - 86400000 * 2).toISOString().split('T')[0];
      const end = now.toISOString().split('T')[0];
      setDateRange({ start, end });
    } else if (newPeriod === '7days') {
      const start = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
      const end = now.toISOString().split('T')[0];
      setDateRange({ start, end });
    } else if (newPeriod === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      setDateRange({ start, end });
    }
  };

  const handleCustomRangeApply = () => {
    const start = customStart.split('T')[0];
    const end = customEnd.split('T')[0];
    setDateRange({ start, end });
  };

  // Load hub list (cached in sessionStorage to avoid refetching on every tab switch)
  const [activeHubs, setActiveHubs] = useState<{ id: string; name: string; code: string; state: string }[]>(() => {
    try {
      const cached = sessionStorage.getItem('ehi_hubs_list');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [{ id: 'all', name: 'All Hubs & Terminals', code: 'ALL', state: 'Nigeria' }];
  });

  useEffect(() => {
    if (activeHubs.length > 1) return;
    supabase
      .from('hubs')
      .select('id, name, code, state')
      .order('name')
      .then(({ data }) => {
        if (data) {
          const list = [
            { id: 'all', name: 'All Hubs & Terminals', code: 'ALL', state: 'Nigeria' },
            ...data.map((h: any) => ({ id: h.id, name: h.name, code: h.code, state: h.state })),
          ];
          setActiveHubs(list);
          try {
            sessionStorage.setItem('ehi_hubs_list', JSON.stringify(list));
          } catch {}
        }
      });
  }, [activeHubs.length]);

  // Flight attention badge (cache-only read)
  const [flightAttentionCount, setFlightAttentionCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(
      supabase
        .from('flight_status_cache')
        .select('status')
        .eq('flight_date', lagosBusinessDate())
        .in('status', ['delayed', 'diverted', 'cancelled'])
    )
      .then(({ data }) => {
        if (!cancelled) setFlightAttentionCount((data || []).length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Past Shifts (only loaded when user clicks "Past Shifts")
  const [pastShifts, setPastShifts] = useState<any[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [selectedPastShift, setSelectedPastShift] = useState<any | null>(null);

  useEffect(() => {
    if (activeView !== 'past_shifts') return;
    let active = true;
    setLoadingShifts(true);
    supabase
      .from('hub_shifts')
      .select('*')
      .eq('status', 'closed')
      .order('ended_at', { ascending: false })
      .limit(40)
      .then(({ data }) => {
        if (active && data) setPastShifts(data);
        if (active) setLoadingShifts(false);
      });
    return () => {
      active = false;
    };
  }, [activeView]);

  const hubIdToState = useMemo(() => {
    const m = new Map<string, string>();
    activeHubs.forEach((h) => {
      if (h.id !== 'all') m.set(h.id, h.state);
    });
    return m;
  }, [activeHubs]);

  const periodBounds = useMemo(() => {
    const now = new Date();
    const shiftBoundary = getShiftBoundary((user as any).shift_start_hour ?? 18);
    if (period === 'shift') return { startMs: shiftBoundary.start.getTime(), endMs: shiftBoundary.end.getTime() };
    if (period === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
      return { startMs: todayStart, endMs: Infinity };
    }
    if (period === '7days') return { startMs: now.getTime() - 7 * 86400000, endMs: Infinity };
    if (period === 'month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0).getTime();
      return { startMs: monthStart, endMs: Infinity };
    }
    if (period === 'custom') {
      return { startMs: new Date(customStart).getTime(), endMs: new Date(customEnd).getTime() };
    }
    return { startMs: 0, endMs: Infinity };
  }, [period, customStart, customEnd, user]);

  // Single-pass filter for transactions in selected hub & time period
  const periodFilteredTxs = useMemo(() => {
    const selectedState = selectedHub === 'all' ? null : hubIdToState.get(selectedHub);
    const q = searchQuery.trim().toLowerCase();
    const { startMs, endMs } = periodBounds;

    return transactions.filter((t) => {
      if (selectedHub !== 'all') {
        const matchesHub =
          t.hub_id === selectedHub ||
          (selectedState != null && t.hub_id != null && hubIdToState.get(t.hub_id) === selectedState);
        if (!matchesHub) return false;
      }
      const txMs = t.created_at ? Date.parse(t.created_at) : Date.now();
      if (txMs < startMs || txMs > endMs) return false;

      if (q) {
        const text = `${t.id} ${t.name} ${t.detail} ${t.mode} ${t.airline || ''} ${t.route || ''} ${t.awb_tag_number || ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, selectedHub, hubIdToState, periodBounds, searchQuery]);

  // Filtered expenses in the same period & hub
  const periodFilteredExpenses = useMemo(() => {
    const selectedState = selectedHub === 'all' ? null : hubIdToState.get(selectedHub);
    const { startMs, endMs } = periodBounds;

    return expenses.filter((e) => {
      if (e.status === 'rejected') return false;
      if (selectedHub !== 'all') {
        const matchesHub =
          e.hub_id === selectedHub ||
          (selectedState != null && e.hub_id != null && hubIdToState.get(e.hub_id) === selectedState);
        if (!matchesHub) return false;
      }
      const expMs = e.created_at ? Date.parse(e.created_at) : e.time ? Date.parse(e.time) : Date.now();
      return expMs >= startMs && expMs <= endMs;
    });
  }, [expenses, selectedHub, hubIdToState, periodBounds]);

  // Single-pass summary calculation (fast O(N) over filtered rows)
  const summary = useMemo(() => {
    let collectedTotal = 0;
    let grossBooked = 0;
    let unpaidDebt = 0;
    let debtCount = 0;

    let cashTotal = 0;
    let transferTotal = 0;
    let unconfirmedTransferTotal = 0;
    let posTotal = 0;
    let walletTotal = 0;

    let totalShipments = 0;
    let totalKg = 0;

    const depts = {
      cargo: { label: 'Air Cargo', revenue: 0, count: 0, kg: 0 },
      baggage: { label: 'Excess Baggage', revenue: 0, count: 0, kg: 0 },
      marketing: { label: 'Field Marketing', revenue: 0, count: 0, kg: 0 },
      package: { label: 'Package Desk', revenue: 0, count: 0, kg: 0 },
    };

    const customerMap = new Map<
      string,
      { name: string; dept: string; shipments: number; kg: number; paid: number; debt: number }
    >();

    for (const t of periodFilteredTxs) {
      const isDebtClearance = !!t.is_debt_clearance;
      const isRetrieved = !!t.retrieved;
      const isLiquid = (t.mode !== 'Debt' && t.mode !== 'Debt Paid' && !isRetrieved) || isDebtClearance;

      const custName = t.name?.trim() || 'Walk-in Customer';
      let cust = customerMap.get(custName);
      if (!cust) {
        cust = {
          name: custName,
          dept:
            t.type === 'cargo'
              ? 'Cargo'
              : t.type === 'baggage'
                ? 'Baggage'
                : t.type === 'marketing'
                  ? 'Marketing'
                  : 'Package',
          shipments: 0,
          kg: 0,
          paid: 0,
          debt: 0,
        };
        customerMap.set(custName, cust);
      }

      // Count physical shipments (exclude debt-clearance payment rows so shipments aren't counted twice)
      if (!isDebtClearance) {
        totalShipments++;
        totalKg += t.kg || 0;
        grossBooked += t.amount || 0;

        cust.shipments++;
        cust.kg += t.kg || 0;

        const d = depts[t.type as keyof typeof depts];
        if (d) {
          d.count++;
          d.kg += t.kg || 0;
        }

        if (t.mode === 'Debt') {
          const remaining = Math.max(
            0,
            (t.amount || 0) - (t.amountPaid || 0) - ((t.raw as any)?.retrieved_amount || 0)
          );
          if (remaining > 0) {
            unpaidDebt += remaining;
            debtCount++;
            cust.debt += remaining;
          }
        }
      }

      // Count actual collected money (including debt payments collected in this period)
      if (isLiquid) {
        const amt = t.amount || 0;
        collectedTotal += amt;
        cust.paid += amt;

        const d = depts[t.type as keyof typeof depts];
        if (d) d.revenue += amt;

        if (t.mode === 'Cash') {
          cashTotal += amt;
        } else if (t.mode === 'Transfer' || t.mode === 'TransferCash') {
          transferTotal += amt;
          if (!t.paymentConfirmed) unconfirmedTransferTotal += amt;
        } else if (t.mode === 'POS') {
          posTotal += amt;
        } else if (t.mode === 'Wallet' || (t.wallet_deduction_amount && t.wallet_deduction_amount > 0)) {
          walletTotal += t.wallet_deduction_amount || amt;
        }
      }
    }

    const totalExpenses = periodFilteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netCashAfterExpenses = collectedTotal - totalExpenses;

    const topCustomers = Array.from(customerMap.values())
      .sort((a, b) => b.paid + b.debt - (a.paid + a.debt))
      .slice(0, 25);

    return {
      collectedTotal,
      grossBooked,
      unpaidDebt,
      debtCount,
      cashTotal,
      transferTotal,
      unconfirmedTransferTotal,
      posTotal,
      walletTotal,
      totalShipments,
      totalKg,
      totalExpenses,
      expenseCount: periodFilteredExpenses.length,
      netCashAfterExpenses,
      depts,
      topCustomers,
    };
  }, [periodFilteredTxs, periodFilteredExpenses]);

  // Excel Export
  const exportExcelReport = useCallback(async () => {
    try {
      const [XLSX, { autoFitWorksheetColumns }] = await Promise.all([
        import('xlsx'),
        import('../../lib/excelExport'),
      ]);
      const summaryRows = [
        { Metric: 'Total Money Collected', Value: `₦${summary.collectedTotal.toLocaleString()}` },
        { Metric: 'Gross Sales Booked', Value: `₦${summary.grossBooked.toLocaleString()}` },
        { Metric: 'Unpaid Credit / Debt', Value: `₦${summary.unpaidDebt.toLocaleString()}` },
        { Metric: 'Total Expenses', Value: `₦${summary.totalExpenses.toLocaleString()}` },
        { Metric: 'Net Position (Collected - Expenses)', Value: `₦${summary.netCashAfterExpenses.toLocaleString()}` },
        { Metric: 'Total Shipments', Value: summary.totalShipments },
        { Metric: 'Total Weight (KG)', Value: `${summary.totalKg.toLocaleString()} KG` },
      ];

      const customerRows = summary.topCustomers.map((c) => ({
        Customer: c.name,
        Department: c.dept,
        Shipments: c.shipments,
        'Weight (KG)': c.kg,
        'Amount Paid (NGN)': c.paid,
        'Unpaid Debt (NGN)': c.debt,
      }));

      const entryRows = periodFilteredTxs.map((t) => ({
        'Entry Ref': t.id,
        Department: t.type,
        Customer: t.name,
        Airline: t.airline || '',
        Route: t.route || '',
        'AWB Tag': t.awb_tag_number || '',
        'Weight (KG)': t.kg || 0,
        Pieces: t.pieces || 1,
        'Amount (NGN)': t.amount,
        'Payment Mode': t.mode,
        Confirmed: t.paymentConfirmed ? 'YES' : 'NO',
        'Date Time': t.created_at ? new Date(t.created_at).toLocaleString() : '',
        Agent: t.enteredByName || '',
      }));

      const wb = XLSX.utils.book_new();
      const wsSummary = XLSX.utils.json_to_sheet(sanitizeSpreadsheetRows(summaryRows));
      const wsClients = XLSX.utils.json_to_sheet(sanitizeSpreadsheetRows(customerRows));
      const wsEntries = XLSX.utils.json_to_sheet(sanitizeSpreadsheetRows(entryRows));
      autoFitWorksheetColumns(wsSummary);
      autoFitWorksheetColumns(wsClients);
      autoFitWorksheetColumns(wsEntries);

      XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
      XLSX.utils.book_append_sheet(wb, wsClients, 'Top Customers');
      XLSX.utils.book_append_sheet(wb, wsEntries, 'Transactions');

      XLSX.writeFile(wb, `EHI_Summary_${period}_${new Date().toISOString().slice(0, 10)}.xlsx`);
      showToast({ message: 'Excel report exported!', type: 'success' });
    } catch (err: any) {
      showToast({ message: 'Failed to export Excel: ' + err.message, type: 'error' });
    }
  }, [summary, periodFilteredTxs, period, showToast]);

  const handleDownloadPDF = async () => {
    try {
      if (!periodFilteredTxs.length) {
        showToast({ message: 'No transactions in this period to export.', type: 'warning' });
        return;
      }
      const { downloadAnalyticsPDF } = await import('./AnalyticsPDF');
      await downloadAnalyticsPDF({ period, transactions: periodFilteredTxs });
    } catch (err: any) {
      showToast({ message: 'Error downloading PDF: ' + err.message, type: 'error' });
    }
  };

  return (
    <div className="flex flex-col p-4 md:p-6 space-y-5 pb-24 select-none">
      {/* ── 1. Simple Top Header & Actions ───────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
        <div>
          <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-[0.12em] uppercase font-bold">
            ▸ BUSINESS OVERVIEW
          </span>
          <h2 className="text-[18px] font-bold font-sans text-[var(--color-foreground)] tracking-tight">
            Sales &amp; Collections Summary
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Hub Filter */}
          <div className="relative">
            <select
              value={selectedHub}
              onChange={(e) => setSelectedHub(e.target.value)}
              className="bg-[var(--color-surface-1)] text-[var(--color-foreground)] text-[11px] font-mono h-8 pl-3 pr-7 rounded-lg border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent-amber)] appearance-none cursor-pointer"
            >
              {activeHubs.map((hub) => (
                <option key={hub.id} value={hub.id}>
                  {hub.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 text-[var(--color-muted)] pointer-events-none" size={12} />
          </div>

          <button
            onClick={() => window.dispatchEvent(new CustomEvent('ehi-nav', { detail: 'FlightRadar' }))}
            className="h-8 px-3 border rounded-lg text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer"
            style={
              flightAttentionCount > 0
                ? { background: 'var(--color-error-bg)', borderColor: 'var(--color-error-border)', color: 'var(--color-error)' }
                : { background: 'var(--color-surface-1)', borderColor: 'var(--color-border)', color: 'var(--color-foreground)' }
            }
          >
            <Radar size={14} />
            <span className="hidden sm:inline">Flights</span>
            {flightAttentionCount > 0 && <span>({flightAttentionCount})</span>}
          </button>

          <button
            onClick={exportExcelReport}
            className="h-8 px-3 bg-[var(--color-success-bg)] text-[var(--color-success)] border border-[var(--color-success-border)] rounded-lg text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet size={14} />
            <span className="hidden sm:inline">Excel</span>
          </button>

          <button
            onClick={handleDownloadPDF}
            className="h-8 px-3 bg-[var(--color-surface-1)] text-[var(--color-foreground)] border border-[var(--color-border)] rounded-lg text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Download size={14} className="text-[var(--color-accent-amber)]" />
            <span className="hidden sm:inline">PDF</span>
          </button>
        </div>
      </div>

      {/* ── 2. Time Period & Search Bar ──────────────────────────────── */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-3">
        <div className="flex items-center gap-1 bg-[var(--color-surface-1)] p-1 rounded-lg border border-[var(--color-border)] flex-wrap">
          {([
            ['shift', 'Current Shift'],
            ['today', 'Today'],
            ['7days', '7 Days'],
            ['month', 'This Month'],
            ['custom', 'Custom'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => handlePeriodChange(id)}
              className={`px-3 py-1 text-[11px] font-mono font-bold rounded-md cursor-pointer ${
                period === id
                  ? 'bg-[var(--color-accent-amber)] text-[var(--color-on-accent)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
              }`}
            >
              {label}
            </button>
          ))}
          {dataLoading && (
            <span className="flex items-center gap-1 pl-2 text-[10px] font-mono text-[var(--color-muted)]">
              <Loader2 size={11} className="animate-spin" />
              Loading…
            </span>
          )}
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--color-muted)] flex-wrap">
            <input
              type="datetime-local"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-[var(--color-surface-1)] text-[var(--color-foreground)] px-2 py-1 rounded border border-[var(--color-border)] text-[11px]"
            />
            <span>to</span>
            <input
              type="datetime-local"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-[var(--color-surface-1)] text-[var(--color-foreground)] px-2 py-1 rounded border border-[var(--color-border)] text-[11px]"
            />
            <button
              onClick={handleCustomRangeApply}
              className="px-3 py-1 bg-[var(--color-accent-amber)] text-[var(--color-on-accent)] rounded text-[11px] font-bold cursor-pointer"
            >
              Apply
            </button>
          </div>
        )}

        <div className="relative flex-1 max-w-xs">
          <input
            type="text"
            placeholder="Filter by customer, route, AWB..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg text-[11px] font-sans text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
          />
          <Filter size={12} className="absolute left-2.5 top-2.5 text-[var(--color-muted)]" />
        </div>
      </div>

      {/* ── 3. Four Simple Headline Cards ────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Money Collected */}
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 border-l-4 border-l-[var(--color-success)]">
          <div className="text-[11px] font-mono text-[var(--color-muted)] uppercase">Money Collected (Paid)</div>
          <div className="text-[22px] font-bold font-mono text-[var(--color-success)] my-1">
            ₦{fmt(summary.collectedTotal)}
          </div>
          <div className="text-[11px] font-mono text-[var(--color-muted)]">
            {summary.totalShipments.toLocaleString()} shipments · {summary.totalKg.toLocaleString()} KG
          </div>
        </div>

        {/* Card 2: Total Sales Booked */}
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 border-l-4 border-l-[var(--color-accent-amber)]">
          <div className="text-[11px] font-mono text-[var(--color-muted)] uppercase">Total Sales Booked</div>
          <div className="text-[22px] font-bold font-mono text-[var(--color-foreground)] my-1">
            ₦{fmt(summary.grossBooked)}
          </div>
          <div className="text-[11px] font-mono text-[var(--color-muted)]">
            Includes paid sales + credit bookings
          </div>
        </div>

        {/* Card 3: Unpaid Credit / Debt */}
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 border-l-4 border-l-[var(--color-error)]">
          <div className="text-[11px] font-mono text-[var(--color-muted)] uppercase">Unpaid Credit (Debt)</div>
          <div className="text-[22px] font-bold font-mono text-[var(--color-error)] my-1">
            ₦{fmt(summary.unpaidDebt)}
          </div>
          <div className="text-[11px] font-mono text-[var(--color-muted)]">
            {summary.debtCount} unpaid credit {summary.debtCount === 1 ? 'entry' : 'entries'}
          </div>
        </div>

        {/* Card 4: Expenses & Net */}
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 border-l-4 border-l-[var(--color-accent-cobalt)]">
          <div className="text-[11px] font-mono text-[var(--color-muted)] uppercase">Net After Expenses</div>
          <div className="text-[22px] font-bold font-mono text-[var(--color-accent-cobalt)] my-1">
            ₦{fmt(summary.netCashAfterExpenses)}
          </div>
          <div className="text-[11px] font-mono text-[var(--color-muted)]">
            Expenses: ₦{fmt(summary.totalExpenses)} ({summary.expenseCount})
          </div>
        </div>
      </div>

      {/* ── 4. Simple 3-Button View Switcher ─────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2">
        {([
          ['summary', 'Department & Payment Breakdown', DollarSign],
          ['customers', `Top Customers (${summary.topCustomers.length})`, Building2],
          ['past_shifts', 'Past Closed Shifts', Calendar],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setActiveView(id)}
            className={`px-3.5 py-2 rounded-lg text-[12px] font-sans font-bold flex items-center gap-2 cursor-pointer ${
              activeView === id
                ? 'bg-[var(--color-accent-amber)] text-[var(--color-on-accent)]'
                : 'bg-[var(--color-surface-card)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] border border-[var(--color-border)]'
            }`}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* ── View 1: Department & Payment Method Breakdown ────────────── */}
      {activeView === 'summary' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Sales by Department */}
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
            <h3 className="text-[14px] font-bold font-sans text-[var(--color-foreground)] border-b border-[var(--color-border)] pb-2">
              1. Money Collected by Department
            </h3>

            <div className="space-y-2.5">
              {([
                { key: 'cargo', icon: Package, color: 'var(--color-accent-amber)' },
                { key: 'baggage', icon: Plane, color: 'var(--color-accent-cobalt)' },
                { key: 'marketing', icon: TrendingUp, color: 'var(--color-success)' },
                { key: 'package', icon: Sparkles, color: 'var(--color-purple)' },
              ] as const).map(({ key, icon: Icon, color }) => {
                const d = summary.depts[key];
                const pct = summary.collectedTotal > 0 ? Math.round((d.revenue / summary.collectedTotal) * 100) : 0;
                return (
                  <div
                    key={key}
                    className="p-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-[13px] font-bold text-[var(--color-foreground)]">
                        <Icon size={15} style={{ color }} />
                        {d.label}
                      </span>
                      <span className="text-[15px] font-bold font-mono" style={{ color }}>
                        ₦{fmt(d.revenue)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-[var(--color-muted)]">
                      <span>
                        {d.count} {d.count === 1 ? 'entry' : 'entries'}
                        {d.kg > 0 ? ` · ${d.kg.toLocaleString()} KG` : ''}
                      </span>
                      <span>{pct}% of total</span>
                    </div>
                    <div className="w-full bg-[var(--color-border)] h-1.5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: How Customers Paid */}
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
            <h3 className="text-[14px] font-bold font-sans text-[var(--color-foreground)] border-b border-[var(--color-border)] pb-2">
              2. How Customers Paid
            </h3>

            <div className="space-y-2.5 font-mono text-[12px]">
              <div className="flex items-center justify-between p-3 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="flex items-center gap-2 text-[var(--color-foreground)] font-sans font-medium">
                  <Banknote size={16} className="text-[var(--color-success)]" />
                  Cash
                </span>
                <span className="text-[15px] font-bold text-[var(--color-success)]">₦{fmt(summary.cashTotal)}</span>
              </div>

              <div className="flex items-center justify-between p-3 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <div>
                  <div className="flex items-center gap-2 text-[var(--color-foreground)] font-sans font-medium">
                    <CheckCircle2 size={16} className="text-[var(--color-accent-cobalt)]" />
                    Bank Transfer
                  </div>
                  {summary.unconfirmedTransferTotal > 0 && (
                    <div className="text-[10px] text-[var(--color-warning)] mt-0.5">
                      ₦{fmt(summary.unconfirmedTransferTotal)} awaiting bank confirmation
                    </div>
                  )}
                </div>
                <span className="text-[15px] font-bold text-[var(--color-accent-cobalt)]">
                  ₦{fmt(summary.transferTotal)}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="flex items-center gap-2 text-[var(--color-foreground)] font-sans font-medium">
                  <CreditCard size={16} className="text-[var(--color-accent-amber)]" />
                  POS Terminal
                </span>
                <span className="text-[15px] font-bold text-[var(--color-accent-amber)]">₦{fmt(summary.posTotal)}</span>
              </div>

              <div className="flex items-center justify-between p-3 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="flex items-center gap-2 text-[var(--color-foreground)] font-sans font-medium">
                  <Wallet size={16} className="text-[var(--color-purple)]" />
                  Customer Wallet
                </span>
                <span className="text-[15px] font-bold text-[var(--color-purple)]">₦{fmt(summary.walletTotal)}</span>
              </div>

              <div className="flex items-center justify-between p-3 bg-[var(--color-error-bg)] rounded-lg border border-[var(--color-error-border)]">
                <span className="flex items-center gap-2 text-[var(--color-error)] font-sans font-bold">
                  <AlertCircle size={16} />
                  Unpaid Credit (Debt Owed)
                </span>
                <span className="text-[15px] font-bold text-[var(--color-error)]">₦{fmt(summary.unpaidDebt)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── View 2: Top Customers Table ──────────────────────────────── */}
      {activeView === 'customers' && (
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)]">
            <h3 className="text-[14px] font-bold text-[var(--color-foreground)]">Top Customers in Selected Period</h3>
            <p className="text-[11px] text-[var(--color-muted)]">Ranked by total business volume (paid + credit)</p>
          </div>
          {summary.topCustomers.length === 0 ? (
            <div className="p-8 text-center text-[12px] font-mono text-[var(--color-muted)]">
              No customer records found for this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[12px]">
                <thead>
                  <tr className="bg-[var(--color-surface-1)] text-[var(--color-muted)] border-b border-[var(--color-border)] text-[10px] uppercase">
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">Dept</th>
                    <th className="py-2.5 px-3 text-center">Shipments</th>
                    <th className="py-2.5 px-3 text-right">Weight</th>
                    <th className="py-2.5 px-3 text-right">Paid (₦)</th>
                    <th className="py-2.5 px-3 text-right">Unpaid Debt (₦)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {summary.topCustomers.map((c, i) => (
                    <tr key={c.name} className="hover:bg-[var(--color-surface-hover)]">
                      <td className="py-2.5 px-3 text-[var(--color-muted)]">{i + 1}</td>
                      <td className="py-2.5 px-3 font-sans font-bold text-[var(--color-foreground)]">{c.name}</td>
                      <td className="py-2.5 px-3 text-[var(--color-muted)]">{c.dept}</td>
                      <td className="py-2.5 px-3 text-center text-[var(--color-foreground)]">{c.shipments}</td>
                      <td className="py-2.5 px-3 text-right text-[var(--color-foreground)]">{c.kg.toLocaleString()} KG</td>
                      <td className="py-2.5 px-3 text-right font-bold text-[var(--color-success)]">₦{fmt(c.paid)}</td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold ${
                          c.debt > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-muted)]'
                        }`}
                      >
                        {c.debt > 0 ? `₦${fmt(c.debt)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── View 3: Past Closed Shifts ───────────────────────────────── */}
      {activeView === 'past_shifts' && (
        <div className="space-y-4">
          {selectedPastShift ? (
            <div className="space-y-4">
              <button
                onClick={() => setSelectedPastShift(null)}
                className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
              >
                <ChevronDown className="rotate-90" size={16} /> Back to Closed Shifts
              </button>

              <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--color-border)]">
                  <div>
                    <h3 className="text-[15px] font-bold text-[var(--color-foreground)] flex items-center gap-2">
                      Shift Summary
                      {selectedPastShift.department && selectedPastShift.department !== 'all' && (
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[var(--color-info-bg)] text-[var(--color-accent-cobalt)]">
                          {selectedPastShift.department}
                        </span>
                      )}
                    </h3>
                    <div className="text-[11px] font-mono text-[var(--color-muted)]">
                      {new Date(selectedPastShift.started_at).toLocaleString()} —{' '}
                      {new Date(selectedPastShift.ended_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-[11px] font-mono text-[var(--color-muted)]">
                    Opened: {selectedPastShift.opened_by} · Closed: {selectedPastShift.closed_by}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 font-mono">
                  <div className="bg-[var(--color-surface-1)] p-3 rounded-lg">
                    <div className="text-[10px] text-[var(--color-muted)]">Total Sales</div>
                    <div className="text-[16px] font-bold text-[var(--color-success)]">
                      ₦{fmt(selectedPastShift.sales_summary?.totalSales || 0)}
                    </div>
                  </div>
                  <div className="bg-[var(--color-surface-1)] p-3 rounded-lg">
                    <div className="text-[10px] text-[var(--color-muted)]">Cash</div>
                    <div className="text-[16px] font-bold text-[var(--color-accent-amber)]">
                      ₦{fmt(selectedPastShift.sales_summary?.cashSales || 0)}
                    </div>
                  </div>
                  <div className="bg-[var(--color-surface-1)] p-3 rounded-lg">
                    <div className="text-[10px] text-[var(--color-muted)]">Transfer</div>
                    <div className="text-[16px] font-bold text-[var(--color-accent-cobalt)]">
                      ₦{fmt(selectedPastShift.sales_summary?.transferSales || 0)}
                    </div>
                  </div>
                  <div className="bg-[var(--color-surface-1)] p-3 rounded-lg">
                    <div className="text-[10px] text-[var(--color-muted)]">POS</div>
                    <div className="text-[16px] font-bold text-[var(--color-success)]">
                      ₦{fmt(selectedPastShift.sales_summary?.posSales || 0)}
                    </div>
                  </div>
                  <div className="bg-[var(--color-surface-1)] p-3 rounded-lg">
                    <div className="text-[10px] text-[var(--color-muted)]">Entries</div>
                    <div className="text-[16px] font-bold text-[var(--color-foreground)]">
                      {selectedPastShift.sales_summary?.totalTxCount || 0}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : loadingShifts ? (
            <div className="flex justify-center p-8">
              <Loader2 className="animate-spin text-[var(--color-muted)]" size={24} />
            </div>
          ) : pastShifts.length === 0 ? (
            <div className="text-center p-8 text-[var(--color-muted)] font-mono text-[12px]">No closed shifts found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pastShifts.map((s, i) => (
                <div
                  key={s.id || i}
                  onClick={() => setSelectedPastShift(s)}
                  className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 cursor-pointer hover:border-[var(--color-accent-amber)]"
                >
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-2">
                    <span className="text-[12px] font-bold text-[var(--color-foreground)]">
                      {new Date(s.started_at).toLocaleDateString()}
                    </span>
                    {s.department && s.department !== 'all' && (
                      <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--color-info-bg)] text-[var(--color-accent-cobalt)]">
                        {s.department}
                      </span>
                    )}
                  </div>
                  <div className="text-[18px] font-bold font-mono text-[var(--color-success)]">
                    ₦{fmt(s.sales_summary?.totalSales || 0)}
                  </div>
                  <div className="text-[11px] font-mono text-[var(--color-muted)] mt-1">
                    {s.sales_summary?.totalTxCount || 0} entries · Closed by {s.closed_by}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
