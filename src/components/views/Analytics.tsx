import { useState, useEffect, useMemo, useCallback } from 'react';
import { User, Transaction } from '../../lib/types';
import { fmt, uid } from '../../lib/helpers';
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
  transactions 
}: { 
  user: User; 
  transactions: Transaction[];
}) => {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'quarter'>('today');
  const [selectedHub, setSelectedHub] = useState<string>('all');
  
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

  // List of active hubs for Multi-Hub
  const activeHubs = useMemo(() => [
    { id: 'all',    name: 'All Hubs',               code: 'ALL', region: 'Nigeria' },
    { id: 'los',    name: 'Lagos HQ',               code: 'LOS', region: 'South West' },
    { id: 'abv',    name: 'Abuja Station',          code: 'ABV', region: 'North Central' },
    { id: 'phc',    name: 'Port Harcourt Station',  code: 'PHC', region: 'South South' },
    { id: 'kan',    name: 'Kano Station',           code: 'KAN', region: 'North West' },
    { id: 'enu',    name: 'Enugu Station',          code: 'ENU', region: 'South East' },
    { id: 'abb',    name: 'Asaba Station',          code: 'ABB', region: 'South South' },
    { id: 'akr',    name: 'Akure Station',          code: 'AKR', region: 'South West' },
    { id: 'bcu',    name: 'Bauchi Station',         code: 'BCU', region: 'North East' },
    { id: 'bni',    name: 'Benin City Station',     code: 'BNI', region: 'South South' },
    { id: 'cbq',    name: 'Calabar Station',        code: 'CBQ', region: 'South South' },
    { id: 'gmo',    name: 'Gombe Station',          code: 'GMO', region: 'North East' },
    { id: 'iba',    name: 'Ibadan Station',         code: 'IBA', region: 'South West' },
    { id: 'ilr',    name: 'Ilorin Station',         code: 'ILR', region: 'North Central' },
    { id: 'kad',    name: 'Kaduna Station',         code: 'KAD', region: 'North West' },
    { id: 'miu',    name: 'Maiduguri Station',      code: 'MIU', region: 'North East' },
    { id: 'qow',    name: 'Owerri Station',         code: 'QOW', region: 'South East' },
    { id: 'quo',    name: 'Uyo Station',            code: 'QUO', region: 'South South' },
    { id: 'qrw',    name: 'Warri (Osubi) Station',  code: 'QRW', region: 'South South' },
    { id: 'yol',    name: 'Yola Station',           code: 'YOL', region: 'North East' },
  ], []);

  // Filtered transactions based on selected Hub
  const hubFilteredTxs = useMemo(() => {
    if (selectedHub === 'all') return transactions;
    // Filter by transaction type based on which stream the hub supports
    // Since hub data comes from user.hub in real mode,
    // in demo mode show all transactions for 'all', stream-specific for others
    const hubObj = activeHubs.find(h => h.id === selectedHub);
    if (!hubObj) return transactions;
    // In demo: each hub shows a consistent subset by hash of tx.id
    return transactions.filter(t => {
      const charCode = t.id.charCodeAt(t.id.length - 1);
      const hubIndex = activeHubs.findIndex(h => h.id === selectedHub);
      return charCode % activeHubs.length === hubIndex % activeHubs.length;
    });
  }, [transactions, selectedHub, activeHubs]);

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
      topRoute
    };
  }, [periodFilteredTxs]);

  // Aggregate stats across simulated last 7 days for AreaChart
  const revenueChartData = useMemo(() => {
    const hours = Array.from({ length: 12 }, (_, i) => {
      const h = 7 + i; // 7am to 7pm
      const label = h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
      const txInHour = periodFilteredTxs.filter((_, idx) =>
        idx % 12 === i
      );
      return {
        time: label,
        cargo: txInHour.filter(t => t.type === 'cargo').reduce((s, t) => s + t.amount, 0),
        marketing: txInHour.filter(t => t.type === 'marketing').reduce((s, t) => s + t.amount, 0),
        valuejet: txInHour.filter(t => t.type === 'baggage').reduce((s, t) => s + t.amount, 0),
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

  // Top consignees list
  const topConsignees = useMemo(() => {
    return [
      { name: 'Aramax Logistics', entries: 14, weight: 1430, revenue: stats.cargoRev * 0.35 + 245000, pct: 35 },
      { name: 'SAHCO cargo', entries: 8, weight: 980, revenue: stats.cargoRev * 0.25 + 130000, pct: 25 },
      { name: 'DHL Express Ltd', entries: 12, weight: 750, revenue: stats.cargoRev * 0.18 + 92000, pct: 18 },
      { name: 'Globacom HQ', entries: 4, weight: 420, revenue: stats.cargoRev * 0.12 + 45000, pct: 12 },
      { name: 'FedEx Red Star', entries: 6, weight: 310, revenue: stats.cargoRev * 0.10 + 25000, pct: 10 },
    ].sort((a, b) => b.revenue - a.revenue);
  }, [stats]);

  // Trigger Gemini AI Insights from server proxy
  const fetchAIInsights = useCallback(async () => {
    setLoadingInsights(true);
    setInsightError(null);
    try {
      const response = await fetch('/api/gemini/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const data = await response.json();
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
  }, [stats]);

  const handleDownloadCSV = () => {
    if (!periodFilteredTxs || periodFilteredTxs.length === 0) return;
    
    const headers = ['ID', 'Date', 'Type', 'Status', 'Amount', 'Payment Mode', 'Route/Detail', 'AWB/Tag'];
    
    const rows = periodFilteredTxs.map(t => {
      let route = t.route || '';
      let awb = t.awb_tag_number || '';
      if (!route && t.detail) {
        route = t.detail.split('·')[0]?.trim() || '';
      }
      return [
        t.id,
        t.created_at || new Date().toISOString(),
        t.type,
        t.status,
        t.amount.toString(),
        t.mode || '',
        `"${route}"`,
        `"${awb}"`
      ].join(',');
    });
    
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ehi_transactions_${period}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col p-4 space-y-6 pb-20 select-none animate-in fade-in duration-300">
      
      {/* Page Title */}
      <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-2">
        <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] tracking-[0.15em] uppercase font-bold hidden md:inline">▸ ANALYTICS INTELLIGENCE</span>
        <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] tracking-[0.15em] uppercase font-bold md:hidden">▸ ANALYTICS</span>
        
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
            onClick={handleDownloadCSV}
            className="flex items-center justify-center bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] h-7 px-2 rounded transition-colors"
            title="Download CSV"
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
          <div className="text-[17px] font-bold font-mono text-[var(--color-accent-amber)] pl-1">{fmt(stats.cargoRev)}</div>
          <div className="text-[8px] font-mono text-[var(--color-light-muted)] pl-1 mt-1 truncate">
            {stats.cargoCount} waybills · {stats.cargoKg.toLocaleString()} KG
          </div>
        </div>

        {/* KPI 2 : Marketing Revenue */}
        <div className="ehi-card p-3 relative overflow-hidden flex flex-col justify-between h-[85px]">
          <div className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-[var(--color-success)]" />
          <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">Field Marketing</div>
          <div className="text-[17px] font-bold font-mono text-[var(--color-success)] pl-1">{fmt(stats.mktgRev)}</div>
          <div className="text-[8px] font-mono text-[var(--color-light-muted)] pl-1 mt-1 truncate">
            {stats.mktgCount} entries log
          </div>
        </div>

        {/* KPI 3 : ValueJet Baggage */}
        <div className="ehi-card p-3 relative overflow-hidden flex flex-col justify-between h-[85px]">
          <div className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-[var(--color-accent-cobalt)]" />
          <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">ValueJet Baggage</div>
          <div className="text-[17px] font-bold font-mono text-[var(--color-accent-cobalt)] pl-1">{fmt(stats.vjRev)}</div>
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
        <div className="text-[8px] font-mono text-[var(--color-success)] uppercase tracking-widest font-bold">● COMBINED PORTFOLIO REVENUE</div>
        <div className="text-[26px] font-bold font-mono text-[var(--color-foreground)] mt-1.5">{fmt(stats.totalRev)}</div>
        <div className="text-[8px] font-mono text-[var(--color-light-muted)] mt-1 uppercase">
          Consolidated across all 3 streams for {period}
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
                contentStyle={{ backgroundColor: '#1E293B', borderColor: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: '10px' }}
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
                  <div className="w-full bg-[rgba(255,255,255,0.03)] h-1.5 rounded-full overflow-hidden">
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
        
        <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase border-b border-[rgba(255,255,255,0.05)] pb-1">
          Top Consignee Partnerships
        </div>
        
        <div className="space-y-2 overflow-x-auto pr-1">
          <table className="w-full text-left font-mono text-[10px]">
            <thead>
              <tr className="text-[var(--color-muted)] border-b border-[rgba(255,255,255,0.03)] pb-1">
                <th className="py-1">Client</th>
                <th className="text-center py-1">Shipments</th>
                <th className="text-right py-1">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {topConsignees.map((c, i) => (
                <tr key={i} className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.02)]">
                  <td className="py-2 text-[var(--color-foreground)] truncate max-w-[125px]">{c.name}</td>
                  <td className="text-center text-[var(--color-muted)] py-2">{c.entries}</td>
                  <td className={`text-right py-2 font-bold ${i === 0 ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-foreground)]'}`}>{fmt(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[rgba(255,255,255,0.05)]">
          {[
            { name: 'Arik Air', color: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)' },
            { name: 'Green Africa', color: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)' },
            { name: 'United Nig.', color: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.2)' }
          ].map((item, index) => (
            <div 
              key={index} 
              style={{ backgroundColor: item.color, borderColor: item.border }}
              className="border rounded p-2 text-center"
            >
              <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase truncate">{item.name}</div>
              <div className="text-[12px] font-bold font-mono text-[var(--color-foreground)] mt-1">
                {index === 0 ? '43%' : (index === 1 ? '32%' : '25%')}
              </div>
            </div>
          ))}
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
              <tr className="text-[var(--color-muted)] border-b border-[rgba(255,255,255,0.05)]">
                <th className="py-1">Agent</th>
                <th className="text-center py-1">Entries</th>
                <th className="text-right py-1">Gross Rev</th>
                <th className="text-right py-1">Remit</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'B. Alao', entries: 11, revenue: stats.mktgRev * 0.45 + 40000, expenses: 15000, remit: stats.mktgRev * 0.45 + 40000 - 15000 },
                { name: 'J. Sanni', entries: 8, revenue: stats.mktgRev * 0.35 + 15000, expenses: 5000, remit: stats.mktgRev * 0.35 + 15000 - 5000 },
                { name: 'F. Adebayo', entries: 5, revenue: stats.mktgRev * 0.20 + 5000, expenses: 8000, remit: stats.mktgRev * 0.20 + 5000 - 8000 }
              ].map((agent, i) => (
                <tr key={i} className="border-b border-[rgba(255,255,255,0.03)] text-[10px]">
                  <td className="py-2 text-[var(--color-foreground)] font-bold">{agent.name}</td>
                  <td className="text-center py-2 text-[var(--color-light-muted)]">{agent.entries}</td>
                  <td className="text-right py-2 text-[var(--color-foreground)]">{fmt(agent.revenue)}</td>
                  <td className={`text-right py-2 font-bold ${agent.remit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                    {fmt(agent.remit)}
                  </td>
                </tr>
              ))}
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
            const ratio = hub.id === 'hub-lagos' ? 0.45 : (hub.id === 'hub-murtala' ? 0.25 : (hub.id === 'hub-abuja' ? 0.20 : 0.10));
            const hubRevenue = stats.totalRev * ratio;
            return (
              <div 
                key={hub.id} 
                onClick={() => setSelectedHub(hub.id)}
                className={`bg-[rgba(255,255,255,0.02)] p-2.5 rounded border border-[rgba(255,255,255,0.05)] flex flex-col justify-between cursor-pointer hover:border-[var(--color-accent-cobalt)] transition-colors ${selectedHub === hub.id ? 'border-[var(--color-accent-cobalt)] bg-[rgba(59,130,246,0.05)]' : ''}`}
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
        <div className="bg-[rgba(16,185,129,0.08)] border-b border-[rgba(255,255,255,0.05)] p-3 flex justify-between items-center">
          <div className="flex items-center space-x-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-success)] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-success)]"></span>
            </span>
            <span className="text-[10px] font-mono text-[var(--color-foreground)] tracking-[0.05em] uppercase font-bold flex items-center gap-1.5">
              <Sparkles size={11} className="text-[var(--color-success)] animate-pulse" />
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
                  className="p-2.5 rounded bg-[rgba(255,255,255,0.015)] border border-[rgba(255,255,255,0.05)] space-y-1.5"
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
