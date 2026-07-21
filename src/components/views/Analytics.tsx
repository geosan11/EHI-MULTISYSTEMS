import { useState, useEffect, useMemo, useCallback } from 'react';
import { User, Transaction, Expense } from '../../lib/types';
import { fmt, getShiftBoundary, normalizeAirlineName } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';
import { AnimatedNumber } from '../ui/AnimatedNumber';
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
  Layers,
  Users,
  Download,
  Scale,
  DollarSign,
  AlertTriangle,
  PieChart as PieIcon,
  BarChart3,
  Clock,
  Filter,
  FileSpreadsheet,
  CheckCircle2,
  HelpCircle
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  BarChart, 
  Bar, 
  Cell, 
  PieChart, 
  Pie,
  ComposedChart,
  Line
} from 'recharts';
import * as XLSX from 'xlsx';

interface GeminiInsight {
  title: string;
  insight: string;
  priority: 'high' | 'medium' | 'low';
}

export const Analytics = ({ 
  user, 
  transactions,
  expenses = [],
  dateRange,
  setDateRange
}: { 
  user: User; 
  transactions: Transaction[];
  expenses?: Expense[];
  dateRange: { start: string; end: string };
  setDateRange: (range: { start: string; end: string }) => void;
}) => {
  const [period, setPeriod] = useState<'shift' | 'today' | '7days' | 'month' | 'custom'>('shift');
  const [selectedHub, setSelectedHub] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'overview' | 'pareto' | 'cargo_types' | 'terminal_shifts' | 'cash_flow' | 'past_shifts'>(() => {
    return (sessionStorage.getItem('ehi_analytics_tab') as any) || 'overview';
  });

  useEffect(() => {
    sessionStorage.setItem('ehi_analytics_tab', activeTab);
  }, [activeTab]);

  const [pastShifts, setPastShifts] = useState<any[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [selectedPastShift, setSelectedPastShift] = useState<any | null>(null);
  const [shiftHistory, setShiftHistory] = useState<any[]>([]);

  useEffect(() => {
    if (activeTab === 'past_shifts') {
      const fetchShifts = async () => {
        setLoadingShifts(true);
        const { data } = await supabase
          .from('hub_shifts')
          .select('*')
          .eq('status', 'closed')
          .order('ended_at', { ascending: false })
          .limit(50);
        if (data) setPastShifts(data);
        setLoadingShifts(false);
      };
      fetchShifts();
    }
  }, [activeTab]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Custom Date Range State
  const defaultShift = useMemo(() => {
    const b = getShiftBoundary(18);
    return {
      start: b.start.toISOString().slice(0, 16),
      end: b.end.toISOString().slice(0, 16)
    };
  }, []);
  const [customStart, setCustomStart] = useState(defaultShift.start);
  const [customEnd, setCustomEnd] = useState(defaultShift.end);

  const handlePeriodChange = (newPeriod: typeof period) => {
    setPeriod(newPeriod);
    const now = new Date();
    
    // Ensure parent EHIApp fetches enough data to satisfy our internal exact filters
    if (newPeriod === 'today' || newPeriod === 'shift') {
      const start = new Date(now.getTime() - 86400000 * 2).toISOString().split('T')[0]; // fetch extra day to cover 6pm boundary
      const end = new Date().toISOString().split('T')[0];
      setDateRange({ start, end });
    } else if (newPeriod === '7days') {
      const start = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
      const end = new Date().toISOString().split('T')[0];
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

  const { showToast } = useToast();

  // AI Insights State
  const [insights, setInsights] = useState<GeminiInsight[]>([
    {
      title: "Yield & Leakage Scanner Active",
      insight: "Tap REFRESH AI to generate real-time revenue leakage signals & Pareto client breakdowns.",
      priority: "low"
    }
  ]);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  // Load real hub list from Supabase
  const [activeHubs, setActiveHubs] = useState<{ id: string; name: string; code: string; state: string }[]>([
    { id: 'all', name: 'All Hubs & Terminals', code: 'ALL', state: 'Nigeria' }
  ]);

  useEffect(() => {
    supabase.from('hubs').select('id, name, code, state').order('name').then(({ data }) => {
      if (data) {
        setActiveHubs([
          { id: 'all', name: 'All Hubs & Terminals', code: 'ALL', state: 'Nigeria' },
          ...data.map((h: any) => ({ id: h.id, name: h.name, code: h.code, state: h.state }))
        ]);
      }
    });
  }, []);

  // Airline commission rates
  const [airlineCommissions, setAirlineCommissions] = useState<Record<string, number>>({});

  useEffect(() => {
    supabase.from('pricing_config').select('config_value').eq('config_key', 'airline_commissions').single().then(({ data }) => {
      if (data?.config_value) {
        const normalized: Record<string, number> = {};
        Object.entries(data.config_value as Record<string, number>).forEach(([k, v]) => {
          normalized[normalizeAirlineName(k)] = v;
        });
        setAirlineCommissions(normalized);
      }
    });
  }, []);

  // Filtered transactions by Hub
  const hubFilteredTxs = useMemo(() => {
    if (selectedHub === 'all') return transactions;
    return transactions.filter(t => t.hub_id === selectedHub);
  }, [transactions, selectedHub]);

  // Date/Time Filtered Transactions
  const periodFilteredTxs = useMemo(() => {
    const now = new Date();
    const shiftBoundary = getShiftBoundary(18);

    return hubFilteredTxs.filter(t => {
      const txDate = t.created_at ? new Date(t.created_at) : new Date();

      if (period === 'shift') {
        return txDate >= shiftBoundary.start && txDate <= shiftBoundary.end;
      }
      if (period === 'today') {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        return txDate >= todayStart;
      }
      if (period === '7days') {
        const weekAgo = new Date(now.getTime() - 7 * 86400000);
        return txDate >= weekAgo;
      }
      if (period === 'month') {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        return txDate >= monthStart;
      }
      if (period === 'custom') {
        const start = new Date(customStart);
        const end = new Date(customEnd);
        return txDate >= start && txDate <= end;
      }
      return true;
    }).filter(t => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      const text = `${t.id} ${t.name} ${t.detail} ${t.mode} ${t.airline || ''} ${t.route || ''} ${t.awb_tag_number || ''}`.toLowerCase();
      return text.includes(q);
    });
  }, [hubFilteredTxs, period, customStart, customEnd, searchQuery]);

  // Core Cargo & Revenue Metrics
  const metrics = useMemo(() => {
    const cargo = periodFilteredTxs.filter(t => t.type === 'cargo');
    const baggage = periodFilteredTxs.filter(t => t.type === 'baggage');
    const marketing = periodFilteredTxs.filter(t => t.type === 'marketing');
    const packages = periodFilteredTxs.filter(t => t.type === 'package');

    // Identify non-liquid/non-revenue transactions
    const debtTxs = periodFilteredTxs.filter(t => t.mode === 'Debt');
    const officeWorkTxs = debtTxs.filter(t => t.clientType === 'Office Work');
    const individualDebtTxs = debtTxs.filter(t => t.clientType !== 'Office Work');
    const retrievedTxs = periodFilteredTxs.filter(t => t.retrieved === true);

    // Liquid Transactions (The actual real money we can count as Revenue)
    // We also consider 'is_debt_clearance' as liquid since it's money coming in today for past debts!
    const validLiquidTxs = periodFilteredTxs.filter(t => (t.mode !== 'Debt' && !t.retrieved) || t.is_debt_clearance);

    const totalRevenue = validLiquidTxs.reduce((sum, t) => sum + t.amount, 0); // Pure liquid
    const cargoRevenue = validLiquidTxs.filter(t => t.type === 'cargo').reduce((sum, t) => sum + t.amount, 0);
    const baggageRevenue = validLiquidTxs.filter(t => t.type === 'baggage').reduce((sum, t) => sum + t.amount, 0);
    const marketingRevenue = validLiquidTxs.filter(t => t.type === 'marketing').reduce((sum, t) => sum + t.amount, 0);
    const packagesRevenue = validLiquidTxs.filter(t => t.type === 'package').reduce((sum, t) => sum + t.amount, 0);

    const grossVolumeValue = periodFilteredTxs.reduce((sum, t) => sum + t.amount, 0);

    const totalKg = periodFilteredTxs.reduce((sum, t) => sum + (t.kg || 0), 0);
    const cargoKg = cargo.reduce((sum, t) => sum + (t.kg || 0), 0);
    const baggageKg = baggage.reduce((sum, t) => sum + (t.kg || 0), 0);

    const totalPcs = periodFilteredTxs.reduce((sum, t) => sum + (t.pieces || 1), 0);
    const totalWaybills = periodFilteredTxs.length;

    // Unit Economics Metrics
    const avgYieldPerKg = totalKg > 0 ? totalRevenue / totalKg : 0;
    const avgRevenuePerShipment = totalWaybills > 0 ? totalRevenue / totalWaybills : 0;

    // Payment Collection Breakdown
    const cashRevenue = periodFilteredTxs.filter(t => t.mode === 'Cash').reduce((sum, t) => sum + t.amount, 0);
    const transferRevenue = periodFilteredTxs.filter(t => t.mode === 'Transfer').reduce((sum, t) => sum + t.amount, 0);
    const posRevenue = periodFilteredTxs.filter(t => t.mode === 'POS').reduce((sum, t) => sum + t.amount, 0);
    const walletDeductions = periodFilteredTxs.reduce((sum, t) => sum + (t.wallet_deduction_amount || (t.mode === 'Wallet' ? t.amount : 0)), 0);
    const debtOutstanding = debtTxs.reduce((sum, t) => sum + t.amount, 0);
    const officeWorkValue = officeWorkTxs.reduce((sum, t) => sum + t.amount, 0);
    const retrievedValue = retrievedTxs.reduce((sum, t) => sum + t.amount, 0);

    const unconfirmedTransfers = periodFilteredTxs.filter(t => t.mode === 'Transfer' && !t.paymentConfirmed).reduce((sum, t) => sum + t.amount, 0);
    const unverifiedCash = periodFilteredTxs.filter(t => t.mode === 'Cash' && !t.paymentConfirmed).reduce((sum, t) => sum + t.amount, 0);

    const totalCollected = cashRevenue + transferRevenue + posRevenue + walletDeductions - unconfirmedTransfers - unverifiedCash;
    const collectionEfficiency = totalRevenue > 0 ? Math.min(100, Math.round((totalCollected / totalRevenue) * 100)) : 100;

    // Airline Payables (remittance)
    const airlinePayables = cargo.reduce((sum, t) => {
      if (!t.airline) return sum;
      const normalizedAirline = normalizeAirlineName(t.airline);
      const commRate = t.commissionRate ?? airlineCommissions[normalizedAirline] ?? 0;
      return sum + (t.amount * (1 - commRate / 100));
    }, 0);

    return {
      totalRevenue,
      grossVolumeValue,
      cargoRevenue,
      baggageRevenue,
      marketingRevenue,
      packagesRevenue,
      totalKg,
      cargoKg,
      baggageKg,
      totalPcs,
      totalWaybills,
      avgYieldPerKg,
      avgRevenuePerShipment,
      cashRevenue,
      transferRevenue,
      posRevenue,
      walletDeductions,
      debtOutstanding,
      officeWorkValue,
      retrievedValue,
      unconfirmedTransfers,
      unverifiedCash,
      totalCollected,
      collectionEfficiency,
      airlinePayables
    };
  }, [periodFilteredTxs, airlineCommissions]);

  // Client Pareto 80/20 Analysis
  const clientParetoData = useMemo(() => {
    const map: Record<string, { clientName: string; category: string; count: number; weightKg: number; revenue: number; debt: number }> = {};

    periodFilteredTxs.forEach(t => {
      const clientName = t.name?.trim() || 'Walk-in Customer';
      const category = t.type === 'cargo' ? (t.clientType || 'Cargo Consignee') : t.type === 'baggage' ? 'Baggage Pax' : t.type === 'marketing' ? 'Field Agent Client' : 'Package Sender';

      if (!map[clientName]) {
        map[clientName] = { clientName, category, count: 0, weightKg: 0, revenue: 0, debt: 0 };
      }
      map[clientName].count++;
      map[clientName].weightKg += t.kg || 0;
      map[clientName].revenue += t.amount;
      if (t.mode === 'Debt') map[clientName].debt += t.amount;
    });

    const sorted = Object.values(map).sort((a, b) => b.revenue - a.revenue);
    const grandTotal = sorted.reduce((sum, c) => sum + c.revenue, 0) || 1;

    let runningTotal = 0;
    return sorted.map((c, idx) => {
      runningTotal += c.revenue;
      const cumulativePct = Math.round((runningTotal / grandTotal) * 100);
      const isTop20 = cumulativePct <= 80 || idx < Math.max(1, Math.ceil(sorted.length * 0.2));
      const yieldPerKg = c.weightKg > 0 ? c.revenue / c.weightKg : 0;
      return {
        ...c,
        sharePct: Math.round((c.revenue / grandTotal) * 100),
        cumulativePct,
        isTop20,
        yieldPerKg
      };
    });
  }, [periodFilteredTxs]);

  // Top 80/20 Summary
  const top20ClientsCount = useMemo(() => clientParetoData.filter(c => c.isTop20).length, [clientParetoData]);
  const top20RevenueShare = useMemo(() => {
    const top20Rev = clientParetoData.filter(c => c.isTop20).reduce((sum, c) => sum + c.revenue, 0);
    return metrics.totalRevenue > 0 ? Math.round((top20Rev / metrics.totalRevenue) * 100) : 0;
  }, [clientParetoData, metrics.totalRevenue]);

  // Cargo Category & Content Type Yield Matrix
  const cargoCategoryData = useMemo(() => {
    const map: Record<string, { category: string; count: number; weightKg: number; revenue: number }> = {};

    periodFilteredTxs.forEach(t => {
      let category = 'General Package';
      if (t.contentType) category = t.contentType;
      else if (t.type === 'baggage') category = 'Excess Passenger Baggage';
      else if (t.type === 'marketing') category = 'Field Bags (BB/MB/SB)';
      else if (t.type === 'package') category = 'Express Parcel';
      else if (t.detail?.toLowerCase().includes('electrical')) category = 'Electrical Parts';
      else if (t.detail?.toLowerCase().includes('spares')) category = 'Automotive Spares';

      if (!map[category]) map[category] = { category, count: 0, weightKg: 0, revenue: 0 };
      map[category].count++;
      map[category].weightKg += t.kg || 0;
      map[category].revenue += t.amount;
    });

    const grandTotal = metrics.totalRevenue || 1;
    return Object.values(map)
      .map(c => ({
        ...c,
        pctShare: Math.round((c.revenue / grandTotal) * 100),
        yieldPerKg: c.weightKg > 0 ? c.revenue / c.weightKg : 0
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [periodFilteredTxs, metrics.totalRevenue]);

  // Shift & Terminal Distribution
  const shiftDistributionData = useMemo(() => {
    const morning = { shift: 'Morning Shift (06:00 - 12:00)', revenue: 0, weightKg: 0, count: 0 };
    const afternoon = { shift: 'Afternoon Shift (12:00 - 17:00)', revenue: 0, weightKg: 0, count: 0 };
    const eveningNight = { shift: 'Evening / Night Shift (17:00 - 06:00)', revenue: 0, weightKg: 0, count: 0 };

    periodFilteredTxs.forEach(t => {
      const hour = t.created_at ? new Date(t.created_at).getHours() : 12;
      let target = afternoon;
      if (hour >= 6 && hour < 12) target = morning;
      else if (hour >= 12 && hour < 17) target = afternoon;
      else target = eveningNight;

      target.revenue += t.amount;
      target.weightKg += t.kg || 0;
      target.count++;
    });

    return [morning, afternoon, eveningNight];
  }, [periodFilteredTxs]);

  // Dual-Axis Volume (KG) vs Revenue Trend Chart Data (24-hour / Multi-day)
  const dualAxisTrendData = useMemo(() => {
    if (period === 'shift' || period === 'today') {
      // 24 Hourly Bins
      const bins = Array.from({ length: 24 }, (_, i) => {
        const hourLabel = `${i < 10 ? '0' : ''}${i}:00`;
        const txInHour = periodFilteredTxs.filter(t => {
          if (!t.created_at) return false;
          return new Date(t.created_at).getHours() === i;
        });
        const revenue = txInHour.reduce((s, t) => s + t.amount, 0);
        const weightKg = txInHour.reduce((s, t) => s + (t.kg || 0), 0);
        const yieldPerKg = weightKg > 0 ? Math.round(revenue / weightKg) : 0;
        return { label: hourLabel, revenue, weightKg, yieldPerKg };
      });
      return bins;
    } else {
      // Daily Bins
      const dateMap: Record<string, { label: string; revenue: number; weightKg: number }> = {};
      periodFilteredTxs.forEach(t => {
        const dateStr = t.created_at ? new Date(t.created_at).toISOString().slice(5, 10) : 'Today';
        if (!dateMap[dateStr]) dateMap[dateStr] = { label: dateStr, revenue: 0, weightKg: 0 };
        dateMap[dateStr].revenue += t.amount;
        dateMap[dateStr].weightKg += t.kg || 0;
      });

      return Object.values(dateMap).map(d => ({
        ...d,
        yieldPerKg: d.weightKg > 0 ? Math.round(d.revenue / d.weightKg) : 0
      }));
    }
  }, [periodFilteredTxs, period]);

  // Potential Revenue Leakage Anomaly Warning Signal
  const leakageWarningSignal = useMemo(() => {
    if (dualAxisTrendData.length < 2) return null;
    const avgYield = metrics.avgYieldPerKg;
    if (avgYield === 0) return null;

    // Find any bin where Weight is > 1.5x average weight but yield drops below 60% of average yield
    const anomalyBin = dualAxisTrendData.find(d => d.weightKg > 50 && d.yieldPerKg < avgYield * 0.6);
    if (anomalyBin) {
      return {
        label: anomalyBin.label,
        weightKg: anomalyBin.weightKg,
        yieldPerKg: anomalyBin.yieldPerKg,
        expectedYield: Math.round(avgYield)
      };
    }
    return null;
  }, [dualAxisTrendData, metrics.avgYieldPerKg]);

  // Excel Export Handler
  const exportExcelReport = useCallback(() => {
    try {
      const summaryRows = [
        { Metric: 'Total Handling Revenue', Value: `₦${metrics.totalRevenue.toLocaleString()}` },
        { Metric: 'Total Handling Tonnage', Value: `${metrics.totalKg.toLocaleString()} KG` },
        { Metric: 'Total Waybills Processed', Value: metrics.totalWaybills },
        { Metric: 'Average Revenue per KG (Yield)', Value: `₦${metrics.avgYieldPerKg.toFixed(2)}/KG` },
        { Metric: 'Average Revenue per Shipment', Value: `₦${metrics.avgRevenuePerShipment.toFixed(2)}` },
        { Metric: 'Collection Efficiency Rate', Value: `${metrics.collectionEfficiency}%` },
        { Metric: 'Outstanding Debt', Value: `₦${metrics.debtOutstanding.toLocaleString()}` },
        { Metric: 'Owed to Airlines (Net Payables)', Value: `₦${metrics.airlinePayables.toLocaleString()}` },
      ];

      const clientRows = clientParetoData.map(c => ({
        'Client / Airline': c.clientName,
        'Category': c.category,
        'Shipments': c.count,
        'Tonnage (KG)': c.weightKg,
        'Revenue (NGN)': c.revenue,
        'Yield (NGN/KG)': Math.round(c.yieldPerKg),
        'Share %': `${c.sharePct}%`,
        'Top 20% Driver': c.isTop20 ? 'YES' : 'NO',
        'Outstanding Debt': c.debt
      }));

      const entryRows = periodFilteredTxs.map(t => ({
        'Entry Ref': t.id,
        'Type': t.type,
        'Client / Consignee': t.name,
        'Airline': t.airline || '',
        'Route': t.route || '',
        'AWB Tag': t.awb_tag_number || '',
        'Weight (KG)': t.kg || 0,
        'Pieces': t.pieces || 1,
        'Amount (NGN)': t.amount,
        'Payment Mode': t.mode,
        'Confirmed': t.paymentConfirmed ? 'YES' : 'NO',
        'Date Time': t.created_at ? new Date(t.created_at).toLocaleString() : ''
      }));

      const wb = XLSX.utils.book_new();
      const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
      const wsClients = XLSX.utils.json_to_sheet(clientRows);
      const wsEntries = XLSX.utils.json_to_sheet(entryRows);

      XLSX.utils.book_append_sheet(wb, wsSummary, 'Sales Summary');
      XLSX.utils.book_append_sheet(wb, wsClients, 'Top Clients & Pareto');
      XLSX.utils.book_append_sheet(wb, wsEntries, 'Raw Handling Entries');

      XLSX.writeFile(wb, `EHI_Sales_Revenue_Analysis_${period}_${new Date().toISOString().slice(0,10)}.xlsx`);
      showToast({ message: 'Sales analysis exported to Excel successfully!', type: 'success' });
    } catch (err: any) {
      showToast({ message: 'Failed to export Excel report: ' + err.message, type: 'error' });
    }
  }, [metrics, clientParetoData, periodFilteredTxs, period, showToast]);

  // AI Insights Trigger
  const fetchAIInsights = useCallback(async () => {
    setLoadingInsights(true);
    setInsightError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token || '';
      const response = await fetch('/api/gemini/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          cargoRevenue: metrics.cargoRevenue,
          marketingRevenue: metrics.marketingRevenue,
          vjRevenue: metrics.baggageRevenue,
          totalRevenue: metrics.totalRevenue,
          avgYieldPerKg: metrics.avgYieldPerKg,
          topClient: clientParetoData[0]?.clientName || 'N/A',
          top20Share: top20RevenueShare,
          outstandingDebt: metrics.debtOutstanding
        })
      });
      let data: any = {};
      try {
        const text = await response.text();
        if (text) data = JSON.parse(text);
      } catch(e) {}
      
      if (data.success && Array.isArray(data.insights)) {
        setInsights(data.insights);
      } else {
        setInsightError(data.error || "Could not retrieve analytical parsing.");
      }
    } catch (err: any) {
      setInsightError("Connection offline / insight server unavailable.");
    } finally {
      setLoadingInsights(false);
    }
  }, [metrics, clientParetoData, top20RevenueShare]);

  const handleDownloadPDF = async () => {
    try {
      if (!periodFilteredTxs || periodFilteredTxs.length === 0) {
        showToast({ message: "No transactions available to download for this period.", type: "warning" });
        return;
      }
      const { downloadAnalyticsPDF } = await import('./AnalyticsPDF');
      await downloadAnalyticsPDF({
        period,
        transactions: periodFilteredTxs,
      });
    } catch (err: any) {
      showToast({ message: "Error downloading PDF: " + err.message, type: "error" });
    }
  };

  return (
    <div className="flex flex-col p-4 md:p-6 space-y-6 pb-24 select-none animate-in fade-in duration-300">
      
      {/* ── Zone 1: Header & Control Bar ─────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-[0.15em] uppercase font-bold">
              ▸ CARGO SALES & REVENUE INTELLIGENCE
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[rgba(245,158,11,0.12)] border border-[rgba(245,158,11,0.3)] text-[var(--color-accent-amber)] text-[10px] font-mono font-bold">
              EHI PRO 2
            </span>
          </div>
          <h2 className="text-[18px] font-bold font-sans text-[var(--color-foreground)] tracking-tight mt-0.5">
            Handling Revenue & Yield Analytics
          </h2>
        </div>
        
        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Hub Filter */}
          <div className="relative">
            <select 
              value={selectedHub}
              onChange={(e) => setSelectedHub(e.target.value)}
              className="bg-[var(--color-surface-1)] text-[var(--color-foreground)] text-[11px] font-mono h-8 pl-3 pr-7 rounded-lg border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent-amber)] appearance-none cursor-pointer"
            >
              {activeHubs.map(hub => (
                <option key={hub.id} value={hub.id}>{hub.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 text-[var(--color-muted)] pointer-events-none" size={12} />
          </div>

          {/* Excel Export */}
          <button
            onClick={exportExcelReport}
            className="h-8 px-3 bg-[rgba(16,185,129,0.15)] hover:bg-[rgba(16,185,129,0.25)] text-[var(--color-success)] border border-[rgba(16,185,129,0.3)] rounded-lg text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            title="Export Excel Worksheet"
          >
            <FileSpreadsheet size={14} />
            <span className="hidden sm:inline">Excel Export</span>
          </button>

          {/* PDF Export */}
          <button
            onClick={handleDownloadPDF}
            className="h-8 px-3 bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] rounded-lg text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            title="Export PDF Report"
          >
            <Download size={14} className="text-[var(--color-accent-amber)]" />
            <span className="hidden sm:inline">PDF</span>
          </button>
        </div>
      </div>

      {/* ── Zone 2: Time Range & Search Controls ─────────────────────── */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-3">
        {/* Period Buttons */}
        <div className="flex items-center gap-1 bg-[var(--color-surface-1)] p-1 rounded-lg border border-[var(--color-border)] flex-wrap">
          <button
            onClick={() => handlePeriodChange('shift')}
            className={`px-3 py-1 text-[10px] font-mono font-bold uppercase rounded-md transition-all cursor-pointer ${period === 'shift' ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] shadow-sm' : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
          >
            Current Shift
          </button>
          <button
            onClick={() => handlePeriodChange('today')}
            className={`px-3 py-1 text-[10px] font-mono font-bold uppercase rounded-md transition-all cursor-pointer ${period === 'today' ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] shadow-sm' : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
          >
            Today
          </button>
          <button
            onClick={() => handlePeriodChange('7days')}
            className={`px-3 py-1 text-[10px] font-mono font-bold uppercase rounded-md transition-all cursor-pointer ${period === '7days' ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] shadow-sm' : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
          >
            7 Days
          </button>
          <button
            onClick={() => handlePeriodChange('month')}
            className={`px-3 py-1 text-[10px] font-mono font-bold uppercase rounded-md transition-all cursor-pointer ${period === 'month' ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] shadow-sm' : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
          >
            This Month
          </button>
          <button
            onClick={() => handlePeriodChange('custom')}
            className={`px-3 py-1 text-[10px] font-mono font-bold uppercase rounded-md transition-all cursor-pointer ${period === 'custom' ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] shadow-sm' : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
          >
            Custom Range
          </button>
        </div>

        {/* Custom Range Inputs if Active */}
        {period === 'custom' && (
          <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--color-muted)]">
            <input
              type="datetime-local"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-[var(--color-surface-1)] text-[var(--color-foreground)] px-2 py-1 rounded border border-[var(--color-border)] text-[10px]"
            />
            <span>to</span>
            <input
              type="datetime-local"
              value={customEnd}
              onChange={(e) => {
                setCustomEnd(e.target.value);
                handleCustomRangeApply();
              }}
              className="bg-[var(--color-surface-1)] text-[var(--color-foreground)] px-2 py-1 rounded border border-[var(--color-border)] text-[10px]"
            />
            <button 
              onClick={handleCustomRangeApply}
              className="ml-2 px-3 py-1 bg-[var(--color-surface-3)] text-[var(--color-foreground)] rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-4)] text-[10px] font-bold cursor-pointer"
            >
              Apply Range
            </button>
          </div>
        )}

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <input
            type="text"
            placeholder="Search client, route, waybill..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg text-[11px] font-sans text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
          />
          <Filter size={12} className="absolute left-2.5 top-2.5 text-[var(--color-muted)]" />
        </div>
      </div>

      {/* ── Zone 3: Executive Yield & Handling KPI Cards ─────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {/* KPI 1: Handling Revenue */}
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-3.5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[var(--color-accent-amber)]" />
          <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Total Handling Revenue</div>
          <div className="text-[20px] font-bold font-mono text-[var(--color-foreground)] my-1">
            <AnimatedNumber value={metrics.totalRevenue} format={fmt} />
          </div>
          <div className="text-[10px] font-mono text-[var(--color-accent-amber)] flex items-center justify-between">
            <span>{metrics.totalWaybills} waybills</span>
            <span>{metrics.totalPcs} pcs</span>
          </div>
        </div>

        {/* KPI 2: Total Tonnage Handled */}
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-3.5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[var(--color-accent-cobalt)]" />
          <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Handling Tonnage</div>
          <div className="text-[20px] font-bold font-mono text-[var(--color-accent-cobalt)] my-1">
            {metrics.totalKg.toLocaleString()} <span className="text-[12px] font-normal">KG</span>
          </div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">
            {(metrics.totalKg / 1000).toFixed(2)} Metric Tons
          </div>
        </div>

        {/* KPI 3: Unit Yield per KG (Revenue/KG) */}
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-3.5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[var(--color-success)]" />
          <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Unit Yield Rate</div>
          <div className="text-[20px] font-bold font-mono text-[var(--color-success)] my-1">
            ₦{metrics.avgYieldPerKg.toFixed(1)} <span className="text-[11px] font-normal text-[var(--color-muted)]">/KG</span>
          </div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">
            Avg Ticket: ₦{Math.round(metrics.avgRevenuePerShipment).toLocaleString()}
          </div>
        </div>

        {/* KPI 4: Collection Efficiency */}
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-3.5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[var(--color-purple)]" />
          <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Collection Efficiency</div>
          <div className="text-[20px] font-bold font-mono text-[var(--color-purple)] my-1">
            {metrics.collectionEfficiency}%
          </div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">
            Collected: ₦{metrics.totalCollected.toLocaleString()}
          </div>
        </div>

        {/* KPI 5: Outstanding Debt & Receivables */}
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-3.5 relative overflow-hidden flex flex-col justify-between col-span-2 lg:col-span-1">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[var(--color-error)]" />
          <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Outstanding Receivables</div>
          <div className="text-[20px] font-bold font-mono text-[var(--color-error)] my-1">
            ₦{metrics.debtOutstanding.toLocaleString()}
          </div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">
            Net Airline Payable: ₦{metrics.airlinePayables.toLocaleString()}
          </div>
        </div>
      </div>

      {/* ── Zone 4: Revenue Leakage Anomaly Warning Banner (if triggered) ─ */}
      {leakageWarningSignal && (
        <div className="bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.3)] rounded-xl p-4 flex items-start gap-3 animate-in slide-in-from-top-2 duration-300">
          <AlertTriangle size={18} className="text-[var(--color-accent-amber)] shrink-0 mt-0.5" />
          <div className="flex-1 text-[12px]">
            <div className="font-bold text-[var(--color-accent-amber)] font-mono uppercase tracking-wider mb-0.5">
              ⚠️ Revenue Leakage Anomaly Detected ({leakageWarningSignal.label})
            </div>
            <div className="text-[var(--color-foreground)]">
              Tonnage peaked at <span className="font-bold font-mono">{leakageWarningSignal.weightKg.toLocaleString()} KG</span>, but unit yield dropped to <span className="font-bold font-mono text-[var(--color-error)]">₦{leakageWarningSignal.yieldPerKg}/KG</span> (baseline average is ₦{leakageWarningSignal.expectedYield}/KG). Verify underbilled demurrage, uncaptured handling surcharges, or manual tariff overrides for this period.
            </div>
          </div>
        </div>
      )}

      {/* ── Zone 5: Analysis Navigation Tabs ─────────────────────────── */}
      <div className="flex border-b border-[var(--color-border)] overflow-x-auto no-scrollbar gap-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={`pb-2.5 px-3 text-[12px] font-sans font-bold flex items-center gap-1.5 cursor-pointer transition-colors border-b-2 ${activeTab === 'overview' ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)]' : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
        >
          <BarChart3 size={14} />
          <span>Revenue vs Volume Trend</span>
        </button>

        <button
          onClick={() => setActiveTab('pareto')}
          className={`pb-2.5 px-3 text-[12px] font-sans font-bold flex items-center gap-1.5 cursor-pointer transition-colors border-b-2 ${activeTab === 'pareto' ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)]' : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
        >
          <Users size={14} />
          <span>Client Pareto 80/20</span>
        </button>

        <button
          onClick={() => setActiveTab('cargo_types')}
          className={`pb-2.5 px-3 text-[12px] font-sans font-bold flex items-center gap-1.5 cursor-pointer transition-colors border-b-2 ${activeTab === 'cargo_types' ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)]' : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
        >
          <Layers size={14} />
          <span>Cargo Categories & Yield</span>
        </button>

        <button
          onClick={() => setActiveTab('terminal_shifts')}
          className={`pb-2.5 px-3 text-[12px] font-sans font-bold flex items-center gap-1.5 cursor-pointer transition-colors border-b-2 ${activeTab === 'terminal_shifts' ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)]' : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
        >
          <Clock size={14} /> Time Analysis
        </button>
        <button
          onClick={() => setActiveTab('past_shifts')}
          className={`pb-2.5 px-3 text-[12px] font-sans font-bold flex items-center gap-1.5 cursor-pointer transition-colors border-b-2 ${activeTab === 'past_shifts' ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)]' : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
        >
          <Calendar size={14} /> Past Shifts
        </button>

        <button
          onClick={() => setActiveTab('cash_flow')}
          className={`pb-2.5 px-3 text-[12px] font-sans font-bold flex items-center gap-1.5 cursor-pointer transition-colors border-b-2 ${activeTab === 'cash_flow' ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)]' : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
        >
          <DollarSign size={14} />
          <span>Cash Capture & Debts</span>
        </button>
      </div>

      {/* ── Tab 1: Overview Dual-Axis Trend ──────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Dual Axis Chart */}
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 md:p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--color-border)] pb-2">
              <div>
                <h3 className="text-[14px] font-bold font-sans text-[var(--color-foreground)]">
                  Dual-Axis Revenue (₦) vs Handling Volume (KG) Trend
                </h3>
                <p className="text-[11px] text-[var(--color-muted)] font-mono">
                  Compares revenue captured against actual physical weight processed to isolate rate deviations.
                </p>
              </div>
              <div className="flex items-center gap-4 text-[10px] font-mono text-[var(--color-muted)]">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-[var(--color-accent-amber)]" /> Revenue (₦)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-[var(--color-accent-cobalt)]" /> Weight (KG)
                </span>
              </div>
            </div>

            <div className="w-full h-[260px] text-[10px] font-mono">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dualAxisTrendData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <XAxis dataKey="label" stroke="var(--color-muted)" strokeWidth={0.5} tickLine={false} />
                  <YAxis yAxisId="left" stroke="var(--color-accent-amber)" strokeWidth={0.5} tickLine={false} tickFormatter={(val) => `₦${val/1000}k`} />
                  <YAxis yAxisId="right" orientation="right" stroke="var(--color-accent-cobalt)" strokeWidth={0.5} tickLine={false} tickFormatter={(val) => `${val}kg`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--color-surface-card)', borderColor: 'var(--color-surface-2)', color: 'var(--color-foreground)', fontSize: '11px', borderRadius: '8px' }}
                    formatter={(val: any, name: any) => [
                      name === 'revenue' ? `₦${Number(val).toLocaleString()}` : `${Number(val).toLocaleString()} KG`,
                      name === 'revenue' ? 'Revenue' : 'Handling Weight'
                    ]}
                  />
                  <Bar yAxisId="left" dataKey="revenue" fill="rgba(245,158,11,0.2)" stroke="var(--color-accent-amber)" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="weightKg" stroke="var(--color-accent-cobalt)" strokeWidth={2} dot={{ r: 3, fill: 'var(--color-accent-cobalt)' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Revenue Stream Breakdown Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Cargo Stream */}
            <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-[var(--color-muted)] uppercase">Air Cargo Stream</span>
                <Package size={16} className="text-[var(--color-accent-amber)]" />
              </div>
              <div className="text-[22px] font-bold font-mono text-[var(--color-accent-amber)] my-2">
                ₦{metrics.cargoRevenue.toLocaleString()}
              </div>
              <div className="text-[11px] font-mono text-[var(--color-muted)] space-y-0.5">
                <div>Weight: {metrics.cargoKg.toLocaleString()} KG</div>
                <div>Yield: ₦{metrics.cargoKg > 0 ? (metrics.cargoRevenue / metrics.cargoKg).toFixed(1) : 0}/KG</div>
              </div>
            </div>

            {/* Field Marketing Stream */}
            <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-[var(--color-muted)] uppercase">Field Marketing</span>
                <TrendingUp size={16} className="text-[var(--color-success)]" />
              </div>
              <div className="text-[22px] font-bold font-mono text-[var(--color-success)] my-2">
                ₦{metrics.marketingRevenue.toLocaleString()}
              </div>
              <div className="text-[11px] font-mono text-[var(--color-muted)] space-y-0.5">
                <div>Bag Sales (BB/MB/SB)</div>
                <div>{periodFilteredTxs.filter(t => t.type === 'marketing').length} Entries</div>
              </div>
            </div>

            {/* Excess Baggage Stream */}
            <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-[var(--color-muted)] uppercase">Excess Baggage</span>
                <Plane size={16} className="text-[var(--color-accent-cobalt)]" />
              </div>
              <div className="text-[22px] font-bold font-mono text-[var(--color-accent-cobalt)] my-2">
                ₦{metrics.baggageRevenue.toLocaleString()}
              </div>
              <div className="text-[11px] font-mono text-[var(--color-muted)] space-y-0.5">
                <div>Weight: {metrics.baggageKg.toLocaleString()} KG</div>
                <div>Pax Manifests: {periodFilteredTxs.filter(t => t.type === 'baggage').length}</div>
              </div>
            </div>

            {/* Express Packages Stream */}
            <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-[var(--color-muted)] uppercase">Express Packages</span>
                <Sparkles size={16} className="text-[var(--color-purple)]" />
              </div>
              <div className="text-[22px] font-bold font-mono text-[var(--color-purple)] my-2">
                ₦{metrics.packagesRevenue.toLocaleString()}
              </div>
              <div className="text-[11px] font-mono text-[var(--color-muted)] space-y-0.5">
                <div>Parcels & Envelopes</div>
                <div>{periodFilteredTxs.filter(t => t.type === 'package').length} Waybills</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 2: Client Pareto 80/20 Analysis ──────────────────────── */}
      {activeTab === 'pareto' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-[10px] font-mono text-[var(--color-accent-amber)] uppercase font-bold tracking-wider mb-0.5">
                ● PARETO REVENUE PRINCIPLE (80/20 RULE)
              </div>
              <div className="text-[15px] font-bold font-sans text-[var(--color-foreground)]">
                <span className="text-[var(--color-accent-amber)] font-mono">{top20ClientsCount} key clients</span> drive <span className="text-[var(--color-success)] font-mono">{top20RevenueShare}%</span> of total handling revenue.
              </div>
              <p className="text-[11px] text-[var(--color-muted)] mt-0.5">
                Focus commercial priority and account relationship management on these top 20% accounts.
              </p>
            </div>
          </div>

          {/* Pareto Client Table */}
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="bg-[var(--color-surface-1)] text-[var(--color-muted)] border-b border-[var(--color-border)]">
                    <th className="py-2.5 px-3">Rank & Client / Airline</th>
                    <th className="py-2.5 px-3">Segment</th>
                    <th className="py-2.5 px-3 text-center">Shipments</th>
                    <th className="py-2.5 px-3 text-right">Tonnage (KG)</th>
                    <th className="py-2.5 px-3 text-right">Revenue (₦)</th>
                    <th className="py-2.5 px-3 text-right">Yield (₦/KG)</th>
                    <th className="py-2.5 px-3 text-center">Share %</th>
                    <th className="py-2.5 px-3 text-right">Outstanding Debt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {clientParetoData.map((c, i) => (
                    <tr key={i} className={`hover:bg-[rgba(255,255,255,0.02)] ${c.isTop20 ? 'bg-[rgba(245,158,11,0.03)]' : ''}`}>
                      <td className="py-2.5 px-3 font-sans font-medium text-[var(--color-foreground)]">
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold ${i < 3 ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'}`}>
                            {i + 1}
                          </span>
                          <span className="truncate max-w-[180px]">{c.clientName}</span>
                          {c.isTop20 && (
                            <span className="px-1.5 py-0.2 rounded bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)] text-[9px] font-mono font-bold">
                              TOP 20%
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-[var(--color-muted)] font-mono text-[10px]">{c.category}</td>
                      <td className="py-2.5 px-3 text-center text-[var(--color-foreground)]">{c.count}</td>
                      <td className="py-2.5 px-3 text-right text-[var(--color-foreground)]">{c.weightKg.toLocaleString()} KG</td>
                      <td className="py-2.5 px-3 text-right font-bold text-[var(--color-accent-amber)]">₦{fmt(c.revenue)}</td>
                      <td className="py-2.5 px-3 text-right text-[var(--color-success)] font-bold">₦{Math.round(c.yieldPerKg)}/KG</td>
                      <td className="py-2.5 px-3 text-center font-bold text-[var(--color-foreground)]">{c.sharePct}%</td>
                      <td className={`py-2.5 px-3 text-right font-bold ${c.debt > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-muted)]'}`}>
                        {c.debt > 0 ? `₦${fmt(c.debt)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 3: Cargo Categories & Yield Matrix ──────────────────── */}
      {activeTab === 'cargo_types' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Cargo Category Table */}
            <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
              <h3 className="text-[13px] font-bold font-sans text-[var(--color-foreground)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
                <Layers size={14} className="text-[var(--color-accent-amber)]" />
                <span>Cargo Category Yield Breakdown</span>
              </h3>

              <div className="space-y-3">
                {cargoCategoryData.map((cat, i) => (
                  <div key={i} className="space-y-1 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg p-3">
                    <div className="flex items-center justify-between text-[12px] font-sans font-bold text-[var(--color-foreground)]">
                      <span>{cat.category}</span>
                      <span className="text-[var(--color-accent-amber)] font-mono">₦{fmt(cat.revenue)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-[var(--color-muted)]">
                      <span>{cat.count} shipments · {cat.weightKg.toLocaleString()} KG</span>
                      <span className="text-[var(--color-success)] font-bold">Yield: ₦{Math.round(cat.yieldPerKg)}/KG ({cat.pctShare}%)</span>
                    </div>
                    <div className="w-full bg-[var(--color-border)] h-1.5 rounded-full overflow-hidden mt-1">
                      <div className="bg-[var(--color-accent-amber)] h-full rounded-full" style={{ width: `${cat.pctShare}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cargo Category Distribution Pie Chart */}
            <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col justify-between">
              <h3 className="text-[13px] font-bold font-sans text-[var(--color-foreground)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
                <PieIcon size={14} className="text-[var(--color-accent-cobalt)]" />
                <span>Revenue Share by Content Category</span>
              </h3>

              <div className="h-[240px] w-full flex items-center justify-center text-[10px] font-mono">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={cargoCategoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="revenue"
                      nameKey="category"
                    >
                      {cargoCategoryData.map((_, idx) => (
                        <Cell key={idx} fill={['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6'][idx % 6]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val: any) => [`₦${fmt(Number(val))}`, 'Revenue']} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono pt-2 border-t border-[var(--color-border)]">
                {cargoCategoryData.slice(0, 4).map((cat, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 truncate">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6'][idx % 6] }} />
                    <span className="truncate text-[var(--color-muted)]">{cat.category} ({cat.pctShare}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 4: Terminal & Operational Shift Matrix ──────────────── */}
      {activeTab === 'terminal_shifts' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {shiftDistributionData.map((s, i) => (
              <div key={i} className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
                  <span className="text-[12px] font-bold font-sans text-[var(--color-foreground)]">{s.shift}</span>
                  <Clock size={16} className="text-[var(--color-accent-amber)]" />
                </div>
                <div className="text-[24px] font-bold font-mono text-[var(--color-accent-amber)] my-3">
                  ₦{fmt(s.revenue)}
                </div>
                <div className="text-[11px] font-mono text-[var(--color-muted)] space-y-1">
                  <div className="flex justify-between">
                    <span>Handled Weight:</span>
                    <span className="text-[var(--color-foreground)] font-bold">{s.weightKg.toLocaleString()} KG</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Transactions:</span>
                    <span className="text-[var(--color-foreground)] font-bold">{s.count} entries</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Average Yield:</span>
                    <span className="text-[var(--color-success)] font-bold">₦{s.weightKg > 0 ? Math.round(s.revenue / s.weightKg) : 0}/KG</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'past_shifts' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {selectedPastShift ? (
            <div className="space-y-4">
              <button 
                onClick={() => setSelectedPastShift(null)} 
                className="flex items-center gap-2 text-[12px] font-bold text-[var(--color-muted)] hover:text-white transition-colors"
              >
                <ChevronDown className="rotate-90" size={16} /> Back to Shifts
              </button>
              
              <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-6">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-[var(--color-border)]">
                  <div>
                    <h2 className="text-[16px] font-bold text-white mb-1 flex items-center gap-2">
                      Shift Sales Details
                      {selectedPastShift.department && selectedPastShift.department !== 'all' && (
                        <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-[rgba(59,130,246,0.15)] text-[var(--color-accent-cobalt)] border border-[rgba(59,130,246,0.3)]">
                          {selectedPastShift.department}
                        </span>
                      )}
                    </h2>
                    <div className="text-[12px] font-mono text-[var(--color-muted)]">
                      {new Date(selectedPastShift.started_at).toLocaleString()} — {new Date(selectedPastShift.ended_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-[var(--color-muted)] mb-1">Opened by: {selectedPastShift.opened_by}</div>
                    <div className="text-[11px] text-[var(--color-muted)]">Closed by: {selectedPastShift.closed_by}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                  <div className="bg-[var(--color-surface-1)] p-4 rounded-lg">
                    <div className="text-[11px] text-[var(--color-muted)] mb-1">Total Sales</div>
                    <div className="text-[18px] font-bold text-[var(--color-success)] font-mono">₦{fmt(selectedPastShift.sales_summary?.totalSales || 0)}</div>
                  </div>
                  <div className="bg-[var(--color-surface-1)] p-4 rounded-lg">
                    <div className="text-[11px] text-[var(--color-muted)] mb-1">Cash</div>
                    <div className="text-[18px] font-bold text-[var(--color-accent-amber)] font-mono">₦{fmt(selectedPastShift.sales_summary?.cashSales || 0)}</div>
                  </div>
                  <div className="bg-[var(--color-surface-1)] p-4 rounded-lg">
                    <div className="text-[11px] text-[var(--color-muted)] mb-1">Transfer</div>
                    <div className="text-[18px] font-bold text-[var(--color-accent-cobalt)] font-mono">₦{fmt(selectedPastShift.sales_summary?.transferSales || 0)}</div>
                  </div>
                  <div className="bg-[var(--color-surface-1)] p-4 rounded-lg">
                    <div className="text-[11px] text-[var(--color-muted)] mb-1">POS</div>
                    <div className="text-[18px] font-bold text-[var(--color-success)] font-mono">₦{fmt(selectedPastShift.sales_summary?.posSales || 0)}</div>
                  </div>
                  <div className="bg-[var(--color-surface-1)] p-4 rounded-lg">
                    <div className="text-[11px] text-[var(--color-muted)] mb-1">Entries</div>
                    <div className="text-[18px] font-bold text-white font-mono">{selectedPastShift.sales_summary?.totalTxCount || 0}</div>
                  </div>
                </div>

                <div>
                  <h3 className="text-[14px] font-bold text-white mb-4 border-b border-[var(--color-surface-2)] pb-2">Shift Transaction History</h3>
                  {shiftHistory.length === 0 ? (
                    <div className="text-center p-8 text-[var(--color-muted)] font-mono text-[12px]">No transactions found for this shift.</div>
                  ) : (
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-[var(--color-surface-card)] z-10">
                          <tr>
                            <th className="p-2 border-b border-[var(--color-border)] text-[10px] font-mono text-[var(--color-muted)]">TIME</th>
                            <th className="p-2 border-b border-[var(--color-border)] text-[10px] font-mono text-[var(--color-muted)]">TYPE</th>
                            <th className="p-2 border-b border-[var(--color-border)] text-[10px] font-mono text-[var(--color-muted)]">CUSTOMER</th>
                            <th className="p-2 border-b border-[var(--color-border)] text-[10px] font-mono text-[var(--color-muted)]">MODE</th>
                            <th className="p-2 border-b border-[var(--color-border)] text-[10px] font-mono text-[var(--color-muted)] text-right">AMOUNT</th>
                          </tr>
                        </thead>
                        <tbody className="text-[12px] font-mono">
                          {shiftHistory.map((tx, i) => (
                            <tr key={i} className="border-b border-[var(--color-surface-2)] hover:bg-[var(--color-surface-1)]">
                              <td className="p-2 text-[var(--color-muted)]">{new Date(tx.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                              <td className="p-2 text-[var(--color-foreground)]">{tx.type}</td>
                              <td className="p-2 text-[var(--color-foreground)]">{tx.name}</td>
                              <td className="p-2 text-[var(--color-muted)]">{tx.mode}</td>
                              <td className="p-2 text-right text-[var(--color-success)] font-bold">₦{fmt(tx.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : loadingShifts ? (
            <div className="flex justify-center p-8"><Loader2 className="animate-spin text-[var(--color-muted)]" size={24} /></div>
          ) : pastShifts.length === 0 ? (
            <div className="text-center p-8 text-[var(--color-muted)] font-mono text-[12px]">No closed shifts found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pastShifts.map((s, i) => (
                <div 
                  key={i} 
                  onClick={() => {
                    setSelectedPastShift(s);
                    // Read the frozen line-item snapshot captured at close
                    // time (EHIApp.tsx's handleEndShift) instead of
                    // re-querying live data -- a live re-query could drift
                    // from the summary totals shown above if any of these
                    // transactions were edited, retrieved, or voided after
                    // the shift closed, defeating the point of a locked
                    // snapshot. Older shifts closed before this snapshot
                    // field existed will just show an empty list here.
                    setShiftHistory(s.sales_summary?.transactions || []);
                  }}
                  className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col justify-between cursor-pointer hover:border-[var(--color-accent-amber)] transition-all"
                >
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-bold font-sans text-[var(--color-foreground)]">
                        {new Date(s.started_at).toLocaleDateString()}
                      </span>
                      {/* Each department (Cargo/Package/Marketing/Baggage/GAT)
                          now Starts/Ends its own shift independently, so this
                          list can hold several open-at-once departments for
                          the same hub/day -- the badge is what tells them apart. */}
                      {s.department && s.department !== 'all' && (
                        <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-[rgba(59,130,246,0.15)] text-[var(--color-accent-cobalt)] border border-[rgba(59,130,246,0.3)]">
                          {s.department}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono bg-[var(--color-surface-2)] px-2 py-0.5 rounded text-[var(--color-muted)]">
                      {new Date(s.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(s.ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  
                  <div className="text-[20px] font-bold font-mono text-[var(--color-success)] mb-1">
                    ₦{fmt(s.sales_summary?.totalSales || 0)}
                  </div>
                  <div className="text-[11px] font-mono text-[var(--color-muted)] space-y-1 mt-2">
                    <div className="flex justify-between">
                      <span>Total Tx:</span>
                      <span className="text-[var(--color-foreground)] font-bold">{s.sales_summary?.totalTxCount || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cash Sales:</span>
                      <span className="text-[var(--color-accent-amber)] font-bold">₦{fmt(s.sales_summary?.cashSales || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Transfer Sales:</span>
                      <span className="text-[var(--color-accent-cobalt)] font-bold">₦{fmt(s.sales_summary?.transferSales || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>POS Sales:</span>
                      <span className="text-[var(--color-success)] font-bold">₦{fmt(s.sales_summary?.posSales || 0)}</span>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-[var(--color-border)] text-[10px] font-mono text-[var(--color-muted)] flex justify-between">
                    <span>Opened by: {s.opened_by}</span>
                    <span>Closed by: {s.closed_by}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 5: Cash Capture & Debt Breakdown ───────────────────── */}
      {activeTab === 'cash_flow' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-200">
          {/* Collected Cash Flow */}
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
            <h3 className="text-[13px] font-bold font-sans text-[var(--color-foreground)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[var(--color-success)]" />
              <span>Collected & Settlement Instruments</span>
            </h3>

            <div className="space-y-2 font-mono text-[11px]">
              <div className="flex justify-between p-2.5 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="text-[var(--color-muted)]">Cash Receipts:</span>
                <span className="text-[var(--color-success)] font-bold">₦{fmt(metrics.cashRevenue)}</span>
              </div>
              <div className="flex justify-between p-2.5 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="text-[var(--color-muted)]">Bank Transfers (Confirmed):</span>
                <span className="text-[var(--color-accent-cobalt)] font-bold">₦{fmt(metrics.transferRevenue)}</span>
              </div>
              <div className="flex justify-between p-2.5 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="text-[var(--color-muted)]">POS Terminal Payments:</span>
                <span className="text-[var(--color-accent-amber)] font-bold">₦{fmt(metrics.posRevenue)}</span>
              </div>
              <div className="flex justify-between p-2.5 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="text-[var(--color-muted)]">Customer Wallet Deductions:</span>
                <span className="text-[var(--color-purple)] font-bold">₦{fmt(metrics.walletDeductions)}</span>
              </div>
            </div>
          </div>

          {/* Uncollected & Outstanding Debt */}
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
            <h3 className="text-[13px] font-bold font-sans text-[var(--color-foreground)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <AlertCircle size={16} className="text-[var(--color-error)]" />
              <span>Outstanding Debt & Pending Verification</span>
            </h3>

            <div className="space-y-2 font-mono text-[11px]">
              <div className="flex justify-between p-2.5 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="text-[var(--color-muted)]">Active Corporate / Waybill Debt:</span>
                <span className="text-[var(--color-error)] font-bold">₦{fmt(metrics.debtOutstanding)}</span>
              </div>
              <div className="flex justify-between p-2.5 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="text-[var(--color-muted)]">Unconfirmed Bank Transfers:</span>
                <span className="text-[var(--color-accent-amber)] font-bold">₦{fmt(metrics.unconfirmedTransfers)}</span>
              </div>
              <div className="flex justify-between p-2.5 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="text-[var(--color-muted)]">Unverified Cash Entries:</span>
                <span className="text-[var(--color-accent-amber)] font-bold">₦{fmt(metrics.unverifiedCash)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Zone 6: AI Automated Revenue Insights ──────────────────── */}
      <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[var(--color-accent-amber)]" />
            <span className="text-[13px] font-bold font-sans text-[var(--color-foreground)]">AI Revenue & Anomaly Intelligence</span>
          </div>
          <button
            onClick={fetchAIInsights}
            disabled={loadingInsights}
            className="px-3 py-1 bg-[rgba(245,158,11,0.15)] hover:bg-[rgba(245,158,11,0.25)] text-[var(--color-accent-amber)] border border-[rgba(245,158,11,0.3)] rounded-lg text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer transition-colors"
          >
            {loadingInsights ? <Loader2 size={12} className="animate-spin" /> : <span>↻ REFRESH AI</span>}
          </button>
        </div>

        {insightError && (
          <div className="text-[11px] font-mono text-[var(--color-error)] bg-[rgba(239,68,68,0.1)] p-2 rounded border border-[rgba(239,68,68,0.2)]">
            {insightError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {insights.map((ins, idx) => (
            <div key={idx} className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg p-3 space-y-1">
              <div className="text-[11px] font-bold font-sans text-[var(--color-foreground)] flex items-center justify-between">
                <span>{ins.title}</span>
                <span className={`px-1.5 py-0.2 rounded text-[8px] font-mono font-bold uppercase ${ins.priority === 'high' ? 'bg-[rgba(239,68,68,0.15)] text-[var(--color-error)]' : ins.priority === 'medium' ? 'bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)]' : 'bg-[rgba(16,185,129,0.15)] text-[var(--color-success)]'}`}>
                  {ins.priority}
                </span>
              </div>
              <p className="text-[10px] font-mono text-[var(--color-muted)] leading-relaxed">
                {ins.insight}
              </p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
