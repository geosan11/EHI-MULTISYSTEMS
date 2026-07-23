import { useState, useMemo, useEffect } from 'react';
import { User, Transaction } from '../../lib/types';
import { fmt, tnow, getShiftBoundary, normalizeAirlineName, sanitizeSpreadsheetRows } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';
import { BackButton } from '../BackButton';
import { useAirlines } from '../../lib/airlines';
import { 
  Plane, 
  Calendar, 
  Clock, 
  Scale, 
  DollarSign, 
  TrendingUp, 
  Download, 
  Printer, 
  Search,
  CheckCircle,
  BarChart3,
  Layers
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface AirlinePerformanceProps {
  user: User;
  onBack: () => void;
}

interface AirlineStat {
  airline: string;
  cargoSales: number;
  cargoKg: number;
  cargoCount: number;
  baggageSales: number;
  baggageKg: number;
  baggageCount: number;
  marketingSales: number;
  marketingKg: number;
  marketingCount: number;
  totalSales: number;
  totalKg: number;
  totalCount: number;
}

function getDefaultStartEnd() {
  const now = new Date();
  const shiftBoundary = getShiftBoundary(18);
  const startStr = shiftBoundary.start.toISOString().slice(0, 16);
  const endStr = shiftBoundary.end.toISOString().slice(0, 16);
  return { startStr, endStr };
}

export const AirlinePerformance = ({ user, onBack }: AirlinePerformanceProps) => {
  const defaultTimes = useMemo(() => getDefaultStartEnd(), []);
  const [startDateTime, setStartDateTime] = useState(defaultTimes.startStr);
  const [endDateTime, setEndDateTime] = useState(defaultTimes.endStr);
  const [selectedAirlineFilter, setSelectedAirlineFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);

  const availableAirlines = useAirlines({ includeOther: true });

  // Quick preset handlers
  const applyPreset = (preset: 'shift' | 'today' | 'yesterday' | 'week' | 'month') => {
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (preset === 'shift') {
      const b = getShiftBoundary(18);
      start = b.start;
      end = b.end;
    } else if (preset === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
    } else if (preset === 'yesterday') {
      const y = new Date(now.getTime() - 86400000);
      start = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0);
      end = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59);
    } else if (preset === 'week') {
      start = new Date(now.getTime() - 7 * 86400000);
      end = now;
    } else if (preset === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0);
      end = now;
    }

    setStartDateTime(start.toISOString().slice(0, 16));
    setEndDateTime(end.toISOString().slice(0, 16));
  };

  // Fetch transactions based on custom Date & Time range
  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const startDate = new Date(startDateTime).toISOString();
        const endDate = new Date(endDateTime).toISOString();

        const isAdmin = ['super_admin', 'admin', 'accountant', 'auditor'].includes(user.role);
        const addHubFilter = (q: any) => (!isAdmin && user.hub_id ? q.eq('hub_id', user.hub_id) : q);

        const [cargoRes, baggageRes, mktRes] = await Promise.all([
          addHubFilter(
            supabase
              .from('cargo_entries')
              .select('entry_ref, airline, amount, total_kg, total_pcs, created_at, receipt_mode')
              .gte('created_at', startDate)
              .lte('created_at', endDate)
          ),
          addHubFilter(
            supabase
              .from('manifests')
              .select('transaction_id, airline, amount, excess_kg, total_kg, total_pcs, created_at, payment_mode')
              .gte('created_at', startDate)
              .lte('created_at', endDate)
          ),
          addHubFilter(
            supabase
              .from('marketing_entries')
              .select('entry_ref, route, amount_paid, qty_big_bag, qty_med_bag, qty_small_bag, bb_kg, mb_kg, sb_kg, created_at, payment_mode')
              .gte('created_at', startDate)
              .lte('created_at', endDate)
          ),
        ]);

        if (!active) return;

        const combined: any[] = [];

        if (cargoRes.data) {
          cargoRes.data.forEach((r) => {
            combined.push({
              id: r.entry_ref,
              airline: r.airline ? normalizeAirlineName(r.airline) : 'Unassigned Airline',
              sales: r.amount || 0,
              kg: r.total_kg || 0,
              pcs: r.total_pcs || 1,
              stream: 'cargo',
            });
          });
        }

        if (baggageRes.data) {
          baggageRes.data.forEach((r) => {
            combined.push({
              id: r.transaction_id,
              airline: r.airline ? normalizeAirlineName(r.airline) : 'ValueJet',
              sales: r.amount || 0,
              kg: r.excess_kg || r.total_kg || 0,
              pcs: r.total_pcs || 1,
              stream: 'baggage',
            });
          });
        }

        if (mktRes.data) {
          mktRes.data.forEach((r) => {
            const estKg = (r.bb_kg || 0) + (r.mb_kg || 0) + (r.sb_kg || 0);
            const pcs = (r.qty_big_bag || 0) + (r.qty_med_bag || 0) + (r.qty_small_bag || 0);
            combined.push({
              id: r.entry_ref,
              airline: 'Marketing Desk',
              sales: r.amount_paid || 0,
              kg: estKg,
              pcs: pcs || 1,
              stream: 'marketing',
            });
          });
        }

        setTransactions(combined);
      } catch (err) {
        console.error('Airline performance fetch error:', err);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchData();
    return () => { active = false; };
  }, [startDateTime, endDateTime, user.hub_id, user.role]);

  // Aggregate stats per airline
  const airlineStatsMap = useMemo(() => {
    const map: Record<string, AirlineStat> = {};

    transactions.forEach((tx) => {
      const air = tx.airline ? normalizeAirlineName(tx.airline) : 'Unassigned Airline';
      if (!map[air]) {
        map[air] = {
          airline: air,
          cargoSales: 0,
          cargoKg: 0,
          cargoCount: 0,
          baggageSales: 0,
          baggageKg: 0,
          baggageCount: 0,
          marketingSales: 0,
          marketingKg: 0,
          marketingCount: 0,
          totalSales: 0,
          totalKg: 0,
          totalCount: 0,
        };
      }

      const st = map[air];
      if (tx.stream === 'cargo') {
        st.cargoSales += tx.sales;
        st.cargoKg += tx.kg;
        st.cargoCount += 1;
      } else if (tx.stream === 'baggage') {
        st.baggageSales += tx.sales;
        st.baggageKg += tx.kg;
        st.baggageCount += 1;
      } else if (tx.stream === 'marketing') {
        st.marketingSales += tx.sales;
        st.marketingKg += tx.kg;
        st.marketingCount += 1;
      }

      st.totalSales += tx.sales;
      st.totalKg += tx.kg;
      st.totalCount += 1;
    });

    return map;
  }, [transactions]);

  const sortedStatsList = useMemo(() => {
    const list = Object.values(airlineStatsMap);
    let filtered = list;

    if (selectedAirlineFilter !== 'All') {
      filtered = filtered.filter((s) => normalizeAirlineName(s.airline) === normalizeAirlineName(selectedAirlineFilter));
    }

    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((s) => s.airline.toLowerCase().includes(q));
    }

    return filtered.sort((a, b) => b.totalSales - a.totalSales);
  }, [airlineStatsMap, selectedAirlineFilter, searchQuery]);

  // Global KPIs
  const grandTotalSales = useMemo(() => sortedStatsList.reduce((s, a) => s + a.totalSales, 0), [sortedStatsList]);
  const grandTotalKg = useMemo(() => sortedStatsList.reduce((s, a) => s + a.totalKg, 0), [sortedStatsList]);
  const grandTotalCount = useMemo(() => sortedStatsList.reduce((s, a) => s + a.totalCount, 0), [sortedStatsList]);
  const topAirline = useMemo(() => (sortedStatsList.length > 0 ? sortedStatsList[0].airline : 'N/A'), [sortedStatsList]);

  // Export to Excel
  const handleExportExcel = () => {
    const rows = sortedStatsList.map((st) => ({
      'Airline Name': st.airline,
      'Cargo Revenue (₦)': st.cargoSales,
      'Cargo Weight (KG)': st.cargoKg,
      'Cargo Tickets': st.cargoCount,
      'Baggage Revenue (₦)': st.baggageSales,
      'Baggage Excess (KG)': st.baggageKg,
      'Baggage Tickets': st.baggageCount,
      'Marketing Revenue (₦)': st.marketingSales,
      'Marketing Est. KG': st.marketingKg,
      'Total Revenue (₦)': st.totalSales,
      'Total Weight (KG)': st.totalKg,
      'Total Transactions': st.totalCount,
      'Avg Yield (₦/KG)': st.totalKg > 0 ? Math.round(st.totalSales / st.totalKg) : 0,
      'Volume Share (%)': grandTotalSales > 0 ? ((st.totalSales / grandTotalSales) * 100).toFixed(1) + '%' : '0%',
    }));

    const ws = XLSX.utils.json_to_sheet(sanitizeSpreadsheetRows(rows));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Airline Performance');
    XLSX.writeFile(wb, `EHI_Airline_Sales_Weight_${startDateTime.slice(0, 10)}_to_${endDateTime.slice(0, 10)}.xlsx`);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] overflow-y-auto animate-in slide-in-from-right">
      {/* Header */}
      <div className="p-4 md:p-6 border-b border-[var(--color-border)] flex flex-col md:flex-row gap-4 items-start md:items-center justify-between shrink-0 bg-[var(--color-surface-card)]">
        <div className="flex items-center space-x-4">
          <BackButton onClick={onBack} label="Back" />
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent-amber)] animate-pulse" />
              <h2 className="text-[16px] md:text-[18px] font-bold font-mono text-[var(--color-foreground)] tracking-wide uppercase">
                Airline Sales & Weight Breakdown
              </h2>
            </div>
            <p className="text-[11px] text-[var(--color-muted)] font-mono">
              Aggregated Sales (₦) and Weight (KG) by Airline across Custom Date & Time Windows
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="px-3.5 py-2 rounded-lg bg-[var(--color-accent-cobalt)] hover:bg-opacity-90 text-white font-mono text-[12px] font-bold flex items-center gap-1.5 shadow-sm transition-all"
          >
            <Download size={14} /> Export Excel
          </button>
        </div>
      </div>

      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto w-full">
        {/* Date & Time Range Controls Card */}
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 md:p-5 space-y-4 shadow-md">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-[var(--color-border)] pb-4">
            <div className="flex items-center gap-2">
              <Calendar className="text-[var(--color-accent-amber)]" size={18} />
              <span className="font-mono text-[13px] font-bold uppercase tracking-wider text-[var(--color-foreground)]">
                Select Date & Time Window
              </span>
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-mono text-[var(--color-muted)] mr-1">Presets:</span>
              <button onClick={() => applyPreset('shift')} className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)] border border-[rgba(245,158,11,0.3)] hover:bg-[var(--color-accent-amber)] hover:text-[var(--color-obsidian)] transition-colors">
                Current Shift
              </button>
              <button onClick={() => applyPreset('today')} className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] hover:bg-[var(--color-surface-3)] transition-colors">
                Today
              </button>
              <button onClick={() => applyPreset('yesterday')} className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] hover:bg-[var(--color-surface-3)] transition-colors">
                Yesterday
              </button>
              <button onClick={() => applyPreset('week')} className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] hover:bg-[var(--color-surface-3)] transition-colors">
                Last 7 Days
              </button>
              <button onClick={() => applyPreset('month')} className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] hover:bg-[var(--color-surface-3)] transition-colors">
                This Month
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-mono text-[var(--color-muted)] mb-1">START DATE & TIME</label>
              <input
                type="datetime-local"
                value={startDateTime}
                onChange={(e) => setStartDateTime(e.target.value)}
                className="w-full h-10 px-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg text-[13px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-[var(--color-muted)] mb-1">END DATE & TIME</label>
              <input
                type="datetime-local"
                value={endDateTime}
                onChange={(e) => setEndDateTime(e.target.value)}
                className="w-full h-10 px-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg text-[13px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-[var(--color-muted)] mb-1">FILTER AIRLINE</label>
              <select
                value={selectedAirlineFilter}
                onChange={(e) => setSelectedAirlineFilter(e.target.value)}
                className="w-full h-10 px-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg text-[13px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
              >
                <option value="All">All Airlines</option>
                {availableAirlines.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Aggregate KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] p-4 rounded-xl shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Total Airline Sales</span>
              <DollarSign className="text-[var(--color-success)]" size={16} />
            </div>
            <div className="text-[22px] font-bold font-mono text-[var(--color-success)]">
              ₦{fmt(grandTotalSales)}
            </div>
            <div className="text-[10px] font-mono text-[var(--color-muted)] mt-1">Gross Revenue in Selected Range</div>
          </div>

          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] p-4 rounded-xl shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Total Weight Moved</span>
              <Scale className="text-[var(--color-accent-amber)]" size={16} />
            </div>
            <div className="text-[22px] font-bold font-mono text-[var(--color-accent-amber)]">
              {fmt(grandTotalKg)} <span className="text-[13px]">KG</span>
            </div>
            <div className="text-[10px] font-mono text-[var(--color-muted)] mt-1">Cargo + Baggage + Marketing Weight</div>
          </div>

          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] p-4 rounded-xl shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Total Consignments</span>
              <Layers className="text-[var(--color-accent-cobalt)]" size={16} />
            </div>
            <div className="text-[22px] font-bold font-mono text-[var(--color-accent-cobalt)]">
              {grandTotalCount.toLocaleString()}
            </div>
            <div className="text-[10px] font-mono text-[var(--color-muted)] mt-1">Waybills & Baggage Tickets</div>
          </div>

          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] p-4 rounded-xl shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Top Carrier</span>
              <Plane className="text-[#a78bfa]" size={16} />
            </div>
            <div className="text-[18px] font-bold font-mono text-[var(--color-foreground)] truncate">
              {topAirline}
            </div>
            <div className="text-[10px] font-mono text-[var(--color-muted)] mt-1">Highest Sales Carrier</div>
          </div>
        </div>

        {/* Airline Performance Table */}
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-md">
          <div className="p-4 border-b border-[var(--color-border)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[var(--color-surface-1)]">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-[var(--color-accent-amber)]" />
              <h3 className="font-mono text-[12px] font-bold uppercase tracking-wider text-[var(--color-foreground)]">
                Carrier Revenue & Tonnage Metrics ({sortedStatsList.length})
              </h3>
            </div>

            <div className="relative w-full sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
              <input
                type="text"
                placeholder="Search carrier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-[11px] font-mono rounded bg-[var(--color-surface-card)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)] text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">
                  <th className="py-3 px-4">Carrier / Airline</th>
                  <th className="py-3 px-4 text-right">Cargo Sales (₦)</th>
                  <th className="py-3 px-4 text-right">Cargo Weight (KG)</th>
                  <th className="py-3 px-4 text-right">Baggage Sales (₦)</th>
                  <th className="py-3 px-4 text-right">Baggage KG</th>
                  <th className="py-3 px-4 text-right">Total Sales (₦)</th>
                  <th className="py-3 px-4 text-right">Total Weight (KG)</th>
                  <th className="py-3 px-4 text-right">Yield (₦/KG)</th>
                  <th className="py-3 px-4 text-right">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)] font-mono text-[12px]">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-[var(--color-muted)]">
                      Fetching airline performance metrics for selected date/time range...
                    </td>
                  </tr>
                ) : sortedStatsList.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-[var(--color-muted)]">
                      No transaction records found for the selected date & time range.
                    </td>
                  </tr>
                ) : (
                  sortedStatsList.map((st) => {
                    const avgYield = st.totalKg > 0 ? Math.round(st.totalSales / st.totalKg) : 0;
                    const share = grandTotalSales > 0 ? ((st.totalSales / grandTotalSales) * 100).toFixed(1) : '0';

                    return (
                      <tr key={st.airline} className="hover:bg-[var(--color-surface-1)] transition-colors">
                        <td className="py-3.5 px-4 font-bold text-[var(--color-foreground)] flex items-center gap-2">
                          <Plane size={14} className="text-[var(--color-accent-amber)]" />
                          <span>{st.airline}</span>
                        </td>
                        <td className="py-3.5 px-4 text-right text-[var(--color-light-muted)]">
                          ₦{fmt(st.cargoSales)}
                        </td>
                        <td className="py-3.5 px-4 text-right text-[var(--color-light-muted)]">
                          {fmt(st.cargoKg)} kg
                        </td>
                        <td className="py-3.5 px-4 text-right text-[var(--color-light-muted)]">
                          ₦{fmt(st.baggageSales)}
                        </td>
                        <td className="py-3.5 px-4 text-right text-[var(--color-light-muted)]">
                          {fmt(st.baggageKg)} kg
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-[var(--color-success)] text-[13px]">
                          ₦{fmt(st.totalSales)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-[var(--color-accent-amber)] text-[13px]">
                          {fmt(st.totalKg)} kg
                        </td>
                        <td className="py-3.5 px-4 text-right text-[var(--color-accent-cobalt)] font-semibold">
                          ₦{fmt(avgYield)}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <span className="bg-[var(--color-surface-2)] text-[var(--color-foreground)] px-2 py-0.5 rounded text-[10px] font-bold border border-[var(--color-border)]">
                            {share}%
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
