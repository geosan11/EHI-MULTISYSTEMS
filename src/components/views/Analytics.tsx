import { useState, useEffect, useMemo, useCallback } from 'react';
import { User, Transaction, Expense } from '../../lib/types';
import { fmt, uid } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';
import { normalizeAirlineName } from '../../lib/helpers';
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
  MapPin,
  Users,
  Download
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
  Pie 
} from 'recharts';

interface GeminiInsight {
  title: string;
  insight: string;
  priority: 'high' | 'medium' | 'low';
}

export const Analytics = ({ 
  user, 
  transactions,
  expenses = []
}: { 
  user: User; 
  transactions: Transaction[];
  expenses?: Expense[];
}) => {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'quarter'>('today');
  const [selectedHub, setSelectedHub] = useState<string>('all');
  const { showToast } = useToast();
  
  // AI Insights State
  const [insights, setInsights] = useState<GeminiInsight[]>([
    {
      title: "AI Insights Ready",
      insight: "Tap ↻ REFRESH to load AI-powered analysis for the current data period.",
      priority: "low"
    }
  ]);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  // Load real hub list from Supabase
  const [activeHubs, setActiveHubs] = useState<{ id: string; name: string; code: string; region: string }[]>([
    { id: 'all', name: 'All Hubs', code: 'ALL', region: 'Nigeria' }
  ]);

  useEffect(() => {
    supabase.from('hubs').select('id, name, code, state').order('name').then(({ data }) => {
      if (data) {
        setActiveHubs([
          { id: 'all', name: 'All Hubs', code: 'ALL', region: 'Nigeria' },
          ...data.map((h: any) => ({ id: h.id, name: h.name, code: h.code, region: h.state }))
        ]);
      }
    });
  }, []);

  // Airline commission rates — used to compute real airline payables (not general expenses)
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

  // Filtered transactions based on selected Hub using real hub_id
  const hubFilteredTxs = useMemo(() => {
    if (selectedHub === 'all') return transactions;
    // Match against real hub_id UUID stored on each transaction
    return transactions.filter(t => {
      if (t.hub_id) return t.hub_id === selectedHub;
      // Fallback: match hub_code in transaction detail if hub_id not set
      return false;
    });
  }, [transactions, selectedHub]);

  // Grouped Period Filtered Transactions
  const periodFilteredTxs = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    const quarterAgo = new Date(today);
    quarterAgo.setMonth(quarterAgo.getMonth() - 3);

    return hubFilteredTxs.filter(t => {
      let txDate = new Date();
      if (t.created_at) {
        txDate = new Date(t.created_at);
      }
      
      if (period === 'today') return txDate >= today;
      if (period === 'week') return txDate >= weekAgo;
      if (period === 'month') return txDate >= monthAgo;
      if (period === 'quarter') return txDate >= quarterAgo;
      return true;
    });
  }, [hubFilteredTxs, period]);

  const periodFilteredExpenses = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    const quarterAgo = new Date(today);
    quarterAgo.setMonth(quarterAgo.getMonth() - 3);

    return expenses.filter(e => {
      let expDate = new Date();
      if (e.time) {
        if (/^\d{4}-\d{2}-\d{2}/.test(e.time)) {
          expDate = new Date(e.time);
        }
      }
      
      if (period === 'today') return expDate >= today;
      if (period === 'week') return expDate >= weekAgo;
      if (period === 'month') return expDate >= monthAgo;
      if (period === 'quarter') return expDate >= quarterAgo;
      return true;
    });
  }, [expenses, period]);

  // Calculations for current period (Today state is live)
  const stats = useMemo(() => {
    const cargo = periodFilteredTxs.filter(t => t.type === 'cargo');
    const marketing = periodFilteredTxs.filter(t => t.type === 'marketing');
    const vj = periodFilteredTxs.filter(t => t.type === 'baggage');

    const cargoRev = cargo.reduce((sum, t) => sum + t.amount, 0);
    const mktgRev = marketing.reduce((sum, t) => sum + t.amount, 0);
    const vjRev = vj.reduce((sum, t) => sum + t.amount, 0);
    const totalRev = cargoRev + mktgRev + vjRev;

    const cargoKg = cargo.reduce((sum, t) => sum + (t.kg || 0), 0);
    const vjExcessKg = vj.reduce((sum, t) => sum + (t.kg || 0), 0);

    const cash = periodFilteredTxs.reduce((sum, t) => sum + (t.mode === 'Cash' ? t.amount : 0), 0);
    const transfer = periodFilteredTxs.reduce((sum, t) => sum + (t.mode === 'Transfer' || t.mode === 'POS' ? t.amount : 0), 0);
    const debt = periodFilteredTxs.reduce((sum, t) => sum + (t.mode === 'Debt' ? t.amount : 0), 0);
    
    const totalExpenses = periodFilteredExpenses.reduce((sum, e) => sum + e.amount, 0);

    // Real airline payables: for each cargo entry with an airline, we owe the
    // airline (100% - our commission %) of the amount. This is the same
    // calculation CreditDebit.tsx uses for "Total Due to Airlines".
    // Rate is the one locked in on the transaction at entry time -- only
    // transactions logged before that field existed fall back to the
    // current live config, since they have no other rate on record.
    const airlinePayables = cargo.reduce((sum, t) => {
      if (!t.airline) return sum;
      const normalizedAirline = normalizeAirlineName(t.airline);
      const commRate = t.commissionRate ?? airlineCommissions[normalizedAirline] ?? 0;
      return sum + t.amount * (1 - commRate / 100);
    }, 0);

    // Find top route in today's transactions
    const routesMap: Record<string, number> = {};
    periodFilteredTxs.forEach(t => {
      let r = t.route || '';
      if (!r && t.detail) {
        // extract route from detail (usually airline · details or route)
        const parts = t.detail.split('·');
        if (parts.length >= 4) {
          r = parts[3].trim();
        } else {
          r = parts[0].trim();
        }
      }
      if (r) routesMap[r] = (routesMap[r] || 0) + t.amount;
    });

    let topRoute = 'ABV (Abuja)';
    let maxRouteAmount = 0;
    Object.entries(routesMap).forEach(([r, amt]) => {
      if (amt > maxRouteAmount) {
        maxRouteAmount = amt;
        topRoute = r;
      }
    });

    return {
      cargoRev,
      mktgRev,
      vjRev,
      totalRev,
      cargoCount: cargo.length,
      cargoKg,
      mktgCount: marketing.length,
      vjCount: vj.length,
      vjExcessKg,
      cash,
      transfer,
      debt,
      topRoute,
      totalExpenses,
      airlinePayables
    };
  }, [periodFilteredTxs, periodFilteredExpenses, airlineCommissions]);

  // Real hourly revenue chart based on actual created_at timestamps
  const revenueChartData = useMemo(() => {
    const hours = Array.from({ length: 12 }, (_, i) => {
      const h = 7 + i; // 7am to 7pm
      const label = h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
      const txInHour = periodFilteredTxs.filter(t => {
        if (!t.created_at) return false;
        const txHour = new Date(t.created_at).getHours();
        return txHour === h;
      });
      return {
        time: label,
        cargo:     txInHour.filter(t => t.type === 'cargo').reduce((s, t) => s + t.amount, 0),
        marketing: txInHour.filter(t => t.type === 'marketing').reduce((s, t) => s + t.amount, 0),
        valuejet:  txInHour.filter(t => t.type === 'baggage').reduce((s, t) => s + t.amount, 0),
      };
    });
    return hours;
  }, [periodFilteredTxs]);

  // Top Routes data
  const routeChartData = useMemo(() => {
    const routeMap: Record<string, number> = {};
    periodFilteredTxs.forEach(t => {
      const route = t.route || t.detail?.split('·')[0]?.trim() || 'Unknown';
      routeMap[route] = (routeMap[route] || 0) + t.amount;
    });
    return Object.entries(routeMap)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));
  }, [periodFilteredTxs]);

  // Pie chart data for payment break
  const paymentChartData = useMemo(() => {
    const cash = periodFilteredTxs.filter(t => t.mode === 'Cash').reduce((s, t) => s + t.amount, 0);
    const transfer = periodFilteredTxs.filter(t => t.mode === 'Transfer').reduce((s, t) => s + t.amount, 0);
    const pos = periodFilteredTxs.filter(t => t.mode === 'POS').reduce((s, t) => s + t.amount, 0);
    const debt = periodFilteredTxs.filter(t => t.mode === 'Debt').reduce((s, t) => s + t.amount, 0);
    return [
      { name: 'Cash',     value: cash,     color: '#10B981' },
      { name: 'Transfer', value: transfer,  color: '#3B82F6' },
      { name: 'POS',      value: pos,       color: '#F59E0B' },
      { name: 'Debt',     value: debt,      color: '#EF4444' },
    ].filter(d => d.value > 0);
  }, [periodFilteredTxs]);

  // Top consignees computed from real transaction data
  const topConsignees = useMemo(() => {
    const map: Record<string, { entries: number; weight: number; revenue: number }> = {};
    periodFilteredTxs.filter(t => t.type === 'cargo').forEach(t => {
      const key = t.name || 'Unknown';
      if (!map[key]) map[key] = { entries: 0, weight: 0, revenue: 0 };
      map[key].entries++;
      map[key].weight += t.kg || 0;
      map[key].revenue += t.amount;
    });
    const total = Object.values(map).reduce((s, v) => s + v.revenue, 0) || 1;
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v, pct: Math.round((v.revenue / total) * 100) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [periodFilteredTxs]);

  // Marketing agents performance computed from real data
  const marketingAgentsData = useMemo(() => {
    const map: Record<string, { entries: number; revenue: number; expenses: number }> = {};

    // Process marketing revenues — grouped by the real agent name resolved
    // from entered_by via the user_profiles join, not a field that was never fetched
    periodFilteredTxs.filter(t => t.type === 'marketing').forEach(t => {
      const agentName = t.enteredByName || 'Unassigned';
      if (!map[agentName]) map[agentName] = { entries: 0, revenue: 0, expenses: 0 };
      map[agentName].entries++;
      map[agentName].revenue += t.amount;
    });

    // Process expenses by agent — logged_by is the agent's real name,
    // written directly at expense-creation time
    periodFilteredExpenses.forEach(e => {
      const agentName = e.logged_by || 'Unassigned';
      if (map[agentName]) {
        map[agentName].expenses += e.amount;
      } else {
        // If they only have expenses but no revenue in this period
        map[agentName] = { entries: 0, revenue: 0, expenses: e.amount };
      }
    });

    return Object.entries(map)
      .map(([name, data]) => ({
        name,
        entries: data.entries,
        revenue: data.revenue,
        expenses: data.expenses,
        remit: data.revenue - data.expenses
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [periodFilteredTxs, periodFilteredExpenses]);

  // Top airlines computed from real transaction data
  const topAirlines = useMemo(() => {
    const map: Record<string, number> = {};
    const cargoTxs = periodFilteredTxs.filter(t => t.type === 'cargo');
    let totalRevenue = 0;
    
    cargoTxs.forEach(t => {
      const airline = normalizeAirlineName(t.airline);
      if (!map[airline]) map[airline] = 0;
      map[airline] += t.amount;
      totalRevenue += t.amount;
    });
    
    return Object.entries(map)
      .map(([name, revenue]) => ({ name, revenue, pct: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 100) : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 3);
  }, [periodFilteredTxs]);

  // Trigger Gemini AI Insights from server proxy
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
          cargoRevenue: stats.cargoRev,
          marketingRevenue: stats.mktgRev,
          vjRevenue: stats.vjRev,
          topRoute: stats.topRoute,
          totalDebt: stats.debt,
          cargoCount: stats.cargoCount,
          marketingCount: stats.mktgCount
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
        setInsightError(data.error || "Failed to retrieve analytical parsing.");
      }
    } catch (err: any) {
      console.error(err);
      setInsightError("Connection offline / insight server unavailable.");
    } finally {
      setLoadingInsights(false);
    }
  }, [stats.cargoRev, stats.mktgRev, stats.vjRev, stats.topRoute, stats.debt, stats.cargoCount, stats.mktgCount]);

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
    <div className="flex flex-col p-4 space-y-6 pb-20 select-none animate-in fade-in duration-300">
      
      {/* Page Title */}
      <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-2">
        <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] tracking-[0.15em] uppercase font-bold ehi-desktop-only-inline">▸ ANALYTICS INTELLIGENCE</span>
        <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] tracking-[0.15em] uppercase font-bold ehi-mobile-only-inline">▸ ANALYTICS</span>
        
        <div className="flex items-center space-x-2">
          {/* Hub Selector */}
          <div className="relative">
            <select 
              value={selectedHub}
              onChange={(e) => setSelectedHub(e.target.value)}
              style={{ maxWidth: '160px' }}
              className="bg-[var(--color-surface-1)] text-[var(--color-foreground)] text-[10px] font-mono h-7 pl-2 pr-6 rounded border border-[rgba(255,255,255,0.15)] appearance-none cursor-pointer"
            >
              {activeHubs.map(hub => (
                <option key={hub.id} value={hub.id}>{hub.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-1.5 top-1.5 text-[var(--color-muted)] pointer-events-none" size={10} />
          </div>
          
          <button
            onClick={handleDownloadPDF}
            className="flex items-center justify-center bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] h-7 px-2 rounded transition-colors"
            title="Download PDF"
            aria-label="Download PDF"
          >
            <Download size={14} className="text-[var(--color-accent-amber)]" />
          </button>
        </div>
      </div>

      {/* Date Range Selector Tabs */}
      <div className="flex bg-[var(--color-surface-1)] p-0.5 rounded border border-[var(--color-border)] w-full">
        {(['today', 'week', 'month', 'quarter'] as const).map((tab) => (
          <button 
            key={tab}
            onClick={() => setPeriod(tab)}
            className={`flex-1 text-center py-1.5 text-[9px] font-mono uppercase tracking-wider rounded transition-all ${period === tab ? 'bg-[var(--color-accent-cobalt)] text-white font-bold' : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Revenue Stream KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* KPI 1 : Cargo Revenue */}
        <div className="ehi-card p-3 relative overflow-hidden flex flex-col justify-between h-[85px]">
          <div className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-[var(--color-accent-amber)]" />
          <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">Cargo Stream</div>
          <div className="text-[17px] font-bold font-mono text-[var(--color-accent-amber)] pl-1">
            {fmt(stats.cargoRev)}
          </div>
          <div className="text-[8px] font-mono text-[var(--color-light-muted)] pl-1 mt-1 truncate">
            {stats.cargoCount} waybills · {stats.cargoKg.toLocaleString()} KG
          </div>
        </div>

        {/* KPI 2 : Marketing Revenue */}
        <div className="ehi-card p-3 relative overflow-hidden flex flex-col justify-between h-[85px]">
          <div className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-[var(--color-success)]" />
          <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">Field Marketing</div>
          <div className="text-[17px] font-bold font-mono text-[var(--color-success)] pl-1">
            {fmt(stats.mktgRev)}
          </div>
          <div className="text-[8px] font-mono text-[var(--color-light-muted)] pl-1 mt-1 truncate">
            {stats.mktgCount} entries log
          </div>
        </div>

        {/* KPI 3 : ValueJet Baggage */}
        <div className="ehi-card p-3 relative overflow-hidden flex flex-col justify-between h-[85px]">
          <div className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-[var(--color-accent-cobalt)]" />
          <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">ValueJet Baggage</div>
          <div className="text-[17px] font-bold font-mono text-[var(--color-accent-cobalt)] pl-1">
            {fmt(stats.vjRev)}
          </div>
          <div className="text-[8px] font-mono text-[var(--color-light-muted)] pl-1 mt-1 truncate">
            {stats.vjCount} Pax · {stats.vjExcessKg.toLocaleString()} Excess KG
          </div>
        </div>

        {/* Dynamic Top Route Card */}
        <div className="ehi-card p-3 relative overflow-hidden flex flex-col justify-between h-[85px]">
          <div className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-purple-500" />
          <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1 font-bold">Leading Location</div>
          <div className="text-[13px] font-bold font-mono text-purple-300 pl-1 py-1 uppercase truncate">{stats.topRoute}</div>
          <div className="text-[8px] font-mono text-[var(--color-light-muted)] pl-1">highest volume density</div>
        </div>
      </div>

      {/* Grand Combined Revenue Card */}
      <div className="w-full bg-[rgba(16,185,129,0.04)] border border-[rgba(16,185,129,0.25)] rounded p-4 text-center">
        <div className="flex justify-between items-center px-2 md:px-8">
          <div className="flex flex-col items-start">
            <span className="text-[8px] font-mono text-[var(--color-error)] uppercase tracking-widest font-bold">● PAYABLES</span>
            <span className="text-[16px] md:text-[20px] font-bold font-mono text-[var(--color-foreground)] mt-1">
              <AnimatedNumber value={stats.airlinePayables} format={fmt} />
            </span>
            <span className="text-[7px] font-mono text-[var(--color-light-muted)] mt-0.5 uppercase ehi-desktop-only">Owed to airlines</span>
          </div>

          <div className="flex flex-col items-center">
            <div className="text-[8px] font-mono text-[var(--color-success)] uppercase tracking-widest font-bold">● COMBINED PORTFOLIO REVENUE</div>
            <div className="text-[20px] md:text-[26px] font-bold font-mono text-[var(--color-foreground)] mt-1.5">
              <AnimatedNumber value={stats.totalRev} format={fmt} />
            </div>
            <div className="text-[8px] font-mono text-[var(--color-light-muted)] mt-1 uppercase ehi-desktop-only">
              Consolidated across all 3 streams for {period}
            </div>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-[8px] font-mono text-[var(--color-accent-amber)] uppercase tracking-widest font-bold">● RECEIVABLES</span>
            <span className="text-[16px] md:text-[20px] font-bold font-mono text-[var(--color-foreground)] mt-1">
              <AnimatedNumber value={stats.debt} format={fmt} />
            </span>
          </div>
        </div>
      </div>

      {/* Revenue Trend Chart Section */}
      <div className="ehi-card p-4 space-y-3">
        <div className="text-[9px] font-mono text-[var(--color-foreground)] uppercase tracking-wider flex items-center space-x-1.5">
          <TrendingUp size={11} className="text-[var(--color-accent-cobalt)]" />
          <span>REVENUE PERFORMANCE TREND (Last 7 Days)</span>
        </div>
        <div className="w-full text-[9px] font-mono">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={revenueChartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
              <XAxis dataKey="time" stroke="#64748B" strokeWidth={0.5} tickLine={false} />
              <YAxis 
                stroke="#64748B" 
                strokeWidth={0.5} 
                tickLine={false} 
                tickFormatter={(val) => `₦${(val/1000)}k`} 
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1E293B', borderColor: 'var(--color-surface-2)', color: '#fff', fontSize: '10px' }}
                formatter={(value: any) => [fmt(Number(value)), '']}
              />
              <Area type="monotone" dataKey="cargo" stroke="var(--color-accent-amber)" fill="rgba(245,158,11,0.05)" strokeWidth={1.5} />
              <Area type="monotone" dataKey="marketing" stroke="var(--color-success)" fill="rgba(16,185,129,0.05)" strokeWidth={1.5} />
              <Area type="monotone" dataKey="valuejet" stroke="var(--color-accent-cobalt)" fill="rgba(59,130,246,0.05)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-center space-x-4 text-[8px] font-mono text-[var(--color-muted)]">
          <div className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent-amber)]" />
            <span>Cargo</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-[var(--color-success)]" />
            <span>Marketing</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent-cobalt)]" />
            <span>ValueJet</span>
          </div>
        </div>
      </div>

      {/* Route Performance & Payment Breakdown */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Horizontal Top Routes Table */}
        <div className="ehi-card p-4 space-y-3">
          <div className="text-[9px] font-mono text-[var(--color-foreground)] uppercase tracking-wider flex items-center space-x-2">
            <Layers size={11} className="text-purple-400" />
            <span>RANKED ROUTES BY REVENUE VOLUME</span>
          </div>
          <div className="space-y-2.5">
            {routeChartData.slice(0, 5).map((r, i) => {
              const maxVal = routeChartData[0]?.value || 1;
              const ratio = Math.max(8, Math.min(100, (r.value / maxVal) * 100));
              return (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-[var(--color-light-muted)]">{r.name}</span>
                    <span className="text-[var(--color-foreground)] font-bold">{fmt(r.value)}</span>
                  </div>
                  <div className="w-full bg-[var(--color-border)] h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-[var(--color-accent-amber)] h-full rounded-full" 
                      style={{ width: `${ratio}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Payment breakdown Donut style mapping */}
        <div className="ehi-card p-4 space-y-3">
          <div className="text-[9px] font-mono text-[var(--color-foreground)] uppercase tracking-wider">PAYMENT INSTRUMENT BREAKDOWN</div>
          <div className="flex items-center justify-between">
            {/* Legend Left */}
            <div className="space-y-3 w-[150px]">
              {paymentChartData.map((p, i) => {
                const total = paymentChartData.reduce((s, it) => s + it.value, 0);
                const pct = total > 0 ? Math.round((p.value / total) * 100) : 0;
                return (
                <div key={i} className="flex flex-col">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="text-[11px] font-mono font-bold text-[var(--color-foreground)]">{p.name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--color-muted)] pl-3">
                    {fmt(p.value)} ({pct}%)
                  </span>
                </div>
              )})}
            </div>

            {/* Micro Pie representation layout */}
            <div style={{ width: 100, height: 100 }} className="text-[9px] font-mono shrink-0 relative flex items-center justify-center">
              <ResponsiveContainer width={100} height={100}>
                <PieChart>
                  <Pie
                    data={paymentChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={28}
                    outerRadius={45}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {paymentChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute text-[8px] font-sans font-bold text-center text-[var(--color-muted)]">
                PAYMENT<br/>DIVIDE
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Intelligence & Matrix */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Cargo Intelligence Deep Dive */}
        <div className="ehi-card p-4 space-y-3 h-full">
        <div className="text-[9px] font-mono text-[var(--color-accent-amber)] uppercase tracking-wider flex items-center space-x-1.5 font-bold">
          <Package size={11} />
          <span>CARGO DESK REVENUE INTELLIGENCE</span>
        </div>
        
        <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase border-b border-[var(--color-border)] pb-1">
          Top Consignee Partnerships
        </div>
        
        <div className="space-y-2 overflow-x-auto pr-1">
          <table className="w-full text-left font-mono text-[10px]">
            <thead>
              <tr className="text-[var(--color-muted)] border-b border-[var(--color-border)] pb-1">
                <th className="py-1">Client</th>
                <th className="text-center py-1">Shipments</th>
                <th className="text-right py-1">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {topConsignees.map((c, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] hover:bg-[rgba(255,255,255,0.02)]">
                  <td className="py-2 text-[var(--color-foreground)] truncate max-w-[125px]">{c.name}</td>
                  <td className="text-center text-[var(--color-muted)] py-2">{c.entries}</td>
                  <td className={`text-right py-2 font-bold ${i === 0 ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-foreground)]'}`}>{fmt(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--color-border)]">
          {topAirlines.length > 0 ? topAirlines.map((item, index) => {
            const colors = [
              { color: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)' },
              { color: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)' },
              { color: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.2)' }
            ];
            const theme = colors[index % colors.length];
            return (
            <div 
              key={index} 
              style={{ backgroundColor: theme.color, borderColor: theme.border }}
              className="border rounded p-2 text-center"
            >
              <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase truncate">{item.name}</div>
              <div className="text-[12px] font-bold font-mono text-[var(--color-foreground)] mt-1">
                {item.pct}%
              </div>
            </div>
            );
          }) : (
            <div className="col-span-3 text-center text-[10px] text-[var(--color-muted)] py-2">No airline data for this period</div>
          )}
        </div>
      </div>

      {/* Field Marketing intelligence deep dive */}
      <div className="ehi-card p-4 space-y-3 h-full">
        <div className="text-[9px] font-mono text-[var(--color-success)] uppercase tracking-wider flex items-center space-x-1.5 font-bold">
          <TrendingUp size={11} />
          <span>FIELD MARKETING AGENT RECORD</span>
        </div>

        <div className="space-y-2.5 overflow-x-auto">
          <table className="w-full text-left font-mono text-[10px]">
            <thead>
              <tr className="text-[var(--color-muted)] border-b border-[var(--color-border)]">
                <th className="py-1">Agent</th>
                <th className="text-center py-1">Entries</th>
                <th className="text-right py-1">Gross Rev</th>
                <th className="text-right py-1">Remit</th>
              </tr>
            </thead>
            <tbody>
              {marketingAgentsData.length > 0 ? marketingAgentsData.map((agent, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] text-[10px]">
                  <td className="py-2 text-[var(--color-foreground)] font-bold truncate max-w-[125px]">{agent.name}</td>
                  <td className="text-center py-2 text-[var(--color-light-muted)]">{agent.entries}</td>
                  <td className="text-right py-2 text-[var(--color-foreground)]">{fmt(agent.revenue)}</td>
                  <td className={`text-right py-2 font-bold ${agent.remit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                    {fmt(agent.remit)}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={4} className="text-center text-[10px] text-[var(--color-muted)] py-4">No field marketing activity for this period</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Multi-Hub Performance Matrix Section */}
        <div className="ehi-card p-4 space-y-3 h-full">
        <div className="text-[9px] font-mono text-[var(--color-foreground)] uppercase tracking-wider flex items-center space-x-1.5 font-bold">
          <MapPin size={11} className="text-purple-400" />
          <span>MULTI-HUB LOGISTICS DISTRIBUTION</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {activeHubs.slice(1).map((hub) => {
            // Compute real hub revenue from periodFilteredTxs based on hub_id
            const hubRevenue = periodFilteredTxs
              .filter(t => t.hub_id === hub.id)
              .reduce((sum, t) => sum + t.amount, 0);
            
            return (
              <div 
                key={hub.id} 
                onClick={() => setSelectedHub(hub.id)}
                className={`bg-[rgba(255,255,255,0.02)] p-2.5 rounded border border-[var(--color-border)] flex flex-col justify-between cursor-pointer hover:border-[var(--color-accent-cobalt)] transition-colors ${selectedHub === hub.id ? 'border-[var(--color-accent-cobalt)] bg-[rgba(59,130,246,0.05)]' : ''}`}
              >
                <div>
                  <div className="text-[10px] font-sans font-bold text-[var(--color-foreground)] truncate">{hub.name}</div>
                  <div className="text-[8px] font-mono text-[var(--color-muted)] truncate">{hub.region}</div>
                </div>
                <div className="mt-2 flex justify-between items-end border-t border-[rgba(255,255,255,0.04)] pt-1.5">
                  <span className="text-[7.5px] font-mono text-[var(--color-success)] uppercase">● Active</span>
                  <span className="text-[11px] font-mono font-bold text-[var(--color-foreground)]">{fmt(hubRevenue)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Insights panel Powered by Gemini */}
      <div className="ehi-card overflow-hidden h-full flex flex-col">
        {/* Header bar */}
        <div className="bg-[rgba(16,185,129,0.08)] border-b border-[var(--color-border)] p-3 flex justify-between items-center">
          <div className="flex items-center space-x-1.5">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-success)]"></span>
            </span>
            <span className="text-[10px] font-mono text-[var(--color-foreground)] tracking-[0.05em] uppercase font-bold flex items-center gap-1.5">
              <Sparkles size={11} className="text-[var(--color-success)]" />
              AI INSIGHTS & AUDIT LOG
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchAIInsights}
              disabled={loadingInsights}
              style={{
                fontSize: 9, fontFamily: 'monospace',
                color: 'var(--color-success)',
                background: 'rgba(16,185,129,0.1)',
                border: '1px solid rgba(16,185,129,0.2)',
                borderRadius: 4, padding: '3px 8px',
                cursor: loadingInsights ? 'wait' : 'pointer',
                opacity: loadingInsights ? 0.6 : 1,
              }}
            >
              {loadingInsights ? 'LOADING...' : '↻ REFRESH'}
            </button>
            <span className="text-[8px] font-mono text-[var(--color-success)] px-1.5 py-0.5 bg-[rgba(16,185,129,0.15)] rounded uppercase font-bold">
              Gemini 2.0
            </span>
          </div>
        </div>

        {/* Content body */}
        <div className="p-3 space-y-3">
          {loadingInsights ? (
            <div className="py-8 flex flex-col justify-center items-center space-y-2">
              <Loader2 className="animate-spin text-[var(--color-success)]" size={20} />
              <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider">
                Consulting Logistic Analyst models...
              </div>
            </div>
          ) : insightError ? (
            <div className="py-4 px-2 border border-dashed border-[rgba(239,68,68,0.2)] rounded bg-[rgba(239,68,68,0.03)] text-center text-xs">
              <AlertCircle size={14} className="mx-auto text-[var(--color-error)] mb-1" />
              <div className="text-[9px] font-mono text-[var(--color-error)] uppercase mb-1">Audit Stream Blocked</div>
              <p className="text-[10px] text-[var(--color-muted)]">{insightError}</p>
              <button 
                onClick={fetchAIInsights}
                className="mt-2 text-[9px] text-[var(--color-success)] font-mono border border-[rgba(16,185,129,0.3)] bg-transparent px-2.5 py-1 rounded hover:bg-[rgba(16,185,129,0.05)] text-center"
              >
                Retry Request
              </button>
            </div>
          ) : insights.length === 0 ? (
            <div className="text-center py-6 text-[10px] font-mono text-[var(--color-muted)]">
              No insights compiled for current stats.
            </div>
          ) : (
            <div className="space-y-2.5">
              {insights.map((ins, i) => (
                <div 
                  key={i} 
                  className="p-2.5 rounded bg-[rgba(255,255,255,0.015)] border border-[var(--color-border)] space-y-1.5"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] font-sans font-bold text-[var(--color-foreground)] uppercase">{ins.title}</span>
                    <span className={`text-[7px] font-mono px-1.5 py-0.5 rounded font-bold uppercase ${
                      ins.priority === 'high' ? 'bg-[rgba(239,68,68,0.15)] text-[var(--color-error)] border border-[rgba(239,68,68,0.3)]' :
                      ins.priority === 'medium' ? 'bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)] border border-[rgba(245,158,11,0.3)]' :
                      'bg-[rgba(16,185,129,0.15)] text-[var(--color-success)] border border-[rgba(16,185,129,0.3)]'
                    }`}>
                      {ins.priority} priority
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-light-muted)] leading-relaxed font-sans mt-1">
                    {ins.insight}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      </div>
    </div>
  );
};
