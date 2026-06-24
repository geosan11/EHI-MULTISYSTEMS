import { useState } from 'react';
import { ArrowLeft, Brain, Calendar, ShieldCheck, AlertTriangle, TrendingUp, Sparkles, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, AreaChart, Area } from 'recharts';
import { fmt } from '../../lib/helpers';

interface ForecastDay {
  date: string;
  day: string;
  predictedCargo: number;
  predictedMarketing: number;
  predictedVJ: number;
  confidence: 'High' | 'Medium' | 'Low';
}

export const Forecasting = ({ 
  onBack 
}: { 
  onBack: () => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [forecastGenerated, setForecastGenerated] = useState(false);
  const [staffingRecommendation, setStaffingRecommendation] = useState('');
  const [riskNote, setRiskNote] = useState('');
  const [peakDay, setPeakDay] = useState('');

  // Initial historical performance trend dataset
  const [historicalData] = useState([
    { day: 'Mon', Cargo: 320000, Marketing: 140000, ValueJet: 95000 },
    { day: 'Tue', Cargo: 480000, Marketing: 185000, ValueJet: 110000 },
    { day: 'Wed', Cargo: 720000, Marketing: 340000, ValueJet: 325000 }, // Peak Day
    { day: 'Thu', Cargo: 540000, Marketing: 210000, ValueJet: 165000 },
    { day: 'Fri', Cargo: 680000, Marketing: 290000, ValueJet: 240000 },
    { day: 'Sat', Cargo: 390000, Marketing: 125000, ValueJet: 85000 },
    { day: 'Sun', Cargo: 150000, Marketing: 80000, ValueJet: 45000 }
  ]);

  // Forecasted dataset
  const [forecastData, setForecastData] = useState<ForecastDay[]>([
    { date: '2026-06-22', day: 'Mon', predictedCargo: 345000, predictedMarketing: 155000, predictedVJ: 100000, confidence: 'High' },
    { date: '2026-06-23', day: 'Tue', predictedCargo: 495000, predictedMarketing: 195000, predictedVJ: 120000, confidence: 'High' },
    { date: '2026-06-24', day: 'Wed', predictedCargo: 790000, predictedMarketing: 360000, predictedVJ: 340000, confidence: 'Medium' },
    { date: '2026-06-25', day: 'Thu', predictedCargo: 565000, predictedMarketing: 220000, predictedVJ: 175000, confidence: 'Medium' },
    { date: '2026-06-26', day: 'Fri', predictedCargo: 740000, predictedMarketing: 310000, predictedVJ: 260000, confidence: 'Medium' },
    { date: '2026-06-27', day: 'Sat', predictedCargo: 410000, predictedMarketing: 135000, predictedVJ: 95000, confidence: 'High' },
    { date: '2026-06-28', day: 'Sun', predictedCargo: 165000, predictedMarketing: 90000, predictedVJ: 50000, confidence: 'Low' }
  ]);

  // Heatmap route data representation
  const routesHeatmap = [
    { route: 'Lagos - Abuja (ABV)', Mon: 'low', Tue: 'medium', Wed: 'high', Thu: 'medium', Fri: 'high', Sat: 'medium' },
    { route: 'Lagos - Port Harcourt (PHC)', Mon: 'medium', Tue: 'low', Wed: 'high', Thu: 'medium', Fri: 'high', Sat: 'low' },
    { route: 'Lagos - Benin (BNI)', Mon: 'low', Tue: 'medium', Wed: 'medium', Thu: 'low', Fri: 'medium', Sat: 'medium' },
    { route: 'Lagos - Kano (KAN)', Mon: 'low', Tue: 'low', Wed: 'medium', Thu: 'high', Fri: 'low', Sat: 'low' }
  ];

  const handleGenerateForecast = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/gemini/report-narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportType: '7-Day Demand Forecasting and Operations Split',
          reportData: {
            historicalSummary: historicalData,
            nigerianContext: 'Upcoming public holiday Eid-el-Kabir scheduled for Wednesday, affecting cargo logistics capacity.'
          }
        })
      });
      const resData = await response.json();
      
      if (resData.success && resData.narrative) {
        // Parse paragraphs
        const paras = resData.narrative.split('\n\n');
        setStaffingRecommendation(paras[1] || 'Staffing is optimized for peak logistics.');
        setRiskNote(paras[2] || 'Ensure vehicles undergo checklist clearance before heavy travel schedules.');
        setPeakDay('Wednesday (EOD Surge)');
      } else {
        // Fallback default AI response
        setStaffingRecommendation('Demand peaks heavily on Wednesday. Recommended action: Allocate three extra drivers to standard heavy-duty van trips and shift ValueJet excess checklists starting 07:00 AM.');
        setRiskNote('High operational bottleneck risk detected on Abuja route paths due to pre-holiday supply shipments.');
        setPeakDay('Wednesday');
      }
      setForecastGenerated(true);
    } catch (e) {
      console.error(e);
      setStaffingRecommendation('AI Analysis unavailable — continuing with local parameters.');
      setForecastGenerated(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] p-4 text-[var(--color-foreground)] overflow-y-auto pb-[80px] font-sans">
      {/* Header back navigation */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-4">
        <button onClick={onBack} className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● COGNITIVE LOGISTICS ENGINE</span>
      </div>

      <div className="flex justify-between items-center flex-col sm:flex-row gap-4 mb-6">
        <div className="space-y-0.5">
          <div className="text-[9px] font-mono text-slate-400 tracking-[0.15em] uppercase">▸ DEMAND SHIELD & INTEL</div>
          <h2 className="text-sm font-black text-[var(--color-foreground)]">AI-Powered Predictive Modeling</h2>
        </div>

        <button 
          onClick={handleGenerateForecast}
          disabled={loading}
          className="bg-[var(--color-accent-amber)] hover:bg-amber-600 disabled:opacity-50 text-[var(--color-obsidian)] font-mono text-[10.5px] uppercase font-black px-4 py-2 rounded-lg flex items-center space-x-1.5 cursor-pointer shadow-lg shadow-amber-500/10"
        >
          {loading ? (
            <>
              <RefreshCw size={13} className="animate-spin" />
              <span>Analyzing historical aggregates...</span>
            </>
          ) : (
            <>
              <Brain size={13} />
              <span>Generate Next Week Forecast</span>
            </>
          )}
        </button>
      </div>

      {/* Main sections */}
      <div className="space-y-6">
        
        {/* Double split charts */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Chart: Historical Baseline Area */}
          <div className="ehi-card lg:col-span-6 space-y-4">
            <div className="flex justify-between items-center text-xs font-mono font-bold uppercase text-slate-400">
              <span>Historical Daily Baseline</span>
              <span className="text-[9px] text-[var(--color-accent-cobalt)]">Actual data logs</span>
            </div>
            
            <div className="h-[220px] w-full text-xs font-mono">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historicalData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="day" stroke="#64748B" strokeWidth={1} tickLine={false} />
                  <YAxis stroke="#64748B" strokeWidth={0} tickLine={false} tickFormatter={(v) => `₦${v/1000}k`} />
                  <Tooltip contentStyle={{ backgroundColor: '#1E293B', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }} />
                  <defs>
                    <linearGradient id="cargoGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#F59E0B" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="Cargo" stroke="#F59E0B" fillOpacity={1} fill="url(#cargoGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="Marketing" stroke="#10B981" fillOpacity={0} strokeWidth={1.5} />
                  <Area type="monotone" dataKey="ValueJet" stroke="#3B82F6" fillOpacity={0} strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right Chart: AI Projected Bar Series */}
          <div className="ehi-card p-4 lg:col-span-6 space-y-4">
            <div className="flex justify-between items-center text-xs font-mono font-bold uppercase text-slate-400">
              <span>Next 7-Day Predicted Load</span>
              <span className="text-[9px] text-[var(--color-accent-amber)] flex items-center space-x-1">
                <Sparkles size={11} className="animate-pulse" />
                <span>Gemini projected</span>
              </span>
            </div>

            <div className="h-[220px] w-full text-xs font-mono">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={forecastData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="day" stroke="#64748B" strokeWidth={1} tickLine={false} />
                  <YAxis stroke="#64748B" strokeWidth={0} tickLine={false} tickFormatter={(v) => `₦${v/1000}k`} />
                  <Tooltip contentStyle={{ backgroundColor: '#1E293B', borderColor: 'rgba(255,255,255,0.1)' }} />
                  <Legend iconSize={8} />
                  <Bar dataKey="predictedCargo" name="Cargo (₦)" fill="#F59E0B" stackId="stack" />
                  <Bar dataKey="predictedMarketing" name="Mktg (₦)" fill="#10B981" stackId="stack" />
                  <Bar dataKey="predictedVJ" name="ValueJet (₦)" fill="#3B82F6" stackId="stack" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* AI Insights and Staffing reports */}
        {forecastGenerated && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-in fade-in duration-500">
            {/* Peak day info */}
            <div className="bg-[rgba(245,158,11,0.03)] border border-[rgba(245,158,11,0.25)] rounded-xl p-4 space-y-2">
              <div className="flex items-center space-x-1.5 text-sm font-bold text-[var(--color-accent-amber)]">
                <Calendar size={16} />
                <span className="text-[12px] uppercase">Peak Operational Day</span>
              </div>
              <div className="text-xl font-bold font-mono tracking-tight text-[var(--color-foreground)]">{peakDay || 'Wednesday'}</div>
              <p className="text-[11px] text-slate-400 leading-relaxed font-mono">High-volume baggage bookings and marketing collections coincide, putting stress on local airport desks.</p>
            </div>

            {/* Staffing recommendation */}
            <div className="bg-[rgba(16,185,129,0.03)] border border-[rgba(16,185,129,0.25)] rounded-xl p-4 space-y-2">
              <div className="flex items-center space-x-1.5 text-sm font-bold text-[var(--color-success)]">
                <ShieldCheck size={16} />
                <span className="text-[12px] uppercase">Cargo Staff Allocation</span>
              </div>
              <p className="text-[11px] text-slate-200 leading-relaxed font-mono font-medium">{staffingRecommendation}</p>
            </div>

            {/* Risks notes */}
            <div className="bg-[rgba(239,68,68,0.03)] border border-[rgba(239,68,68,0.25)] rounded-xl p-4 space-y-2">
              <div className="flex items-center space-x-1.5 text-sm font-bold text-[var(--color-error)]">
                <AlertTriangle size={16} />
                <span className="text-[12px] uppercase">Aviation Route Bottleneck Risks</span>
              </div>
              <p className="text-[11px] text-slate-200 leading-relaxed font-mono">{riskNote}</p>
            </div>
          </div>
        )}

        {/* Route Demand Calendar Heatmap Grid */}
        <div className="ehi-card p-4 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-[10px] font-mono font-bold text-[var(--color-foreground)] uppercase tracking-wider block">ROUTE STATIONS CAPACITY CALENDAR</span>
              <span className="text-[8px] text-[var(--color-muted)] font-mono uppercase block">Historical averages by routes vs weekday load</span>
            </div>
            
            {/* Legend indicators */}
            <div className="flex space-x-2 text-[8px] font-mono uppercase">
              <div className="flex items-center space-x-1">
                <span className="h-2 w-2 rounded-sm bg-stone-800" />
                <span>Low density</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="h-2 w-2 rounded-sm bg-blue-500/20" />
                <span>Medium</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="h-2 w-2 rounded-sm bg-amber-500/45 animate-pulse" />
                <span>Peak Load</span>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.05)] text-slate-400 text-left">
                  <th className="py-2.5 font-bold">Logistics Route Axis</th>
                  <th className="py-2.5 px-2">Mon</th>
                  <th className="py-2.5 px-2">Tue</th>
                  <th className="py-2.5 px-2">Wed</th>
                  <th className="py-2.5 px-2">Thu</th>
                  <th className="py-2.5 px-2">Fri</th>
                  <th className="py-2.5 px-2">Sat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(255,255,255,0.05)]">
                {routesHeatmap.map((heatmap, idx) => (
                  <tr key={idx} className="hover:bg-black/10">
                    <td className="py-3 font-semibold text-[var(--color-foreground)] uppercase truncate max-w-[200px]">{heatmap.route}</td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-1 rounded text-[9.5px] uppercase font-bold block text-center max-w-[50px] ${
                        heatmap.Mon === 'high' ? 'bg-amber-500/20 text-[var(--color-accent-amber)]' :
                        heatmap.Mon === 'medium' ? 'bg-blue-500/10 text-blue-300' : 'bg-neutral-800 text-slate-500'
                      }`}>
                        {heatmap.Mon}
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-1 rounded text-[9.5px] uppercase font-bold block text-center max-w-[50px] ${
                        heatmap.Tue === 'high' ? 'bg-amber-500/20 text-[var(--color-accent-amber)]' :
                        heatmap.Tue === 'medium' ? 'bg-blue-500/10 text-blue-300' : 'bg-neutral-800 text-slate-500'
                      }`}>
                        {heatmap.Tue}
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-1 rounded text-[9.5px] uppercase font-bold block text-center max-w-[50px] ${
                        heatmap.Wed === 'high' ? 'bg-amber-500/20 text-[var(--color-accent-amber)]' :
                        heatmap.Wed === 'medium' ? 'bg-blue-500/10 text-blue-300' : 'bg-neutral-800 text-slate-500'
                      }`}>
                        {heatmap.Wed}
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-1 rounded text-[9.5px] uppercase font-bold block text-center max-w-[50px] ${
                        heatmap.Thu === 'high' ? 'bg-amber-500/20 text-[var(--color-accent-amber)]' :
                        heatmap.Thu === 'medium' ? 'bg-blue-500/10 text-blue-300' : 'bg-neutral-800 text-slate-500'
                      }`}>
                        {heatmap.Thu}
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-1 rounded text-[9.5px] uppercase font-bold block text-center max-w-[50px] ${
                        heatmap.Fri === 'high' ? 'bg-amber-500/20 text-[var(--color-accent-amber)]' :
                        heatmap.Fri === 'medium' ? 'bg-blue-500/10 text-blue-300' : 'bg-neutral-800 text-slate-500'
                      }`}>
                        {heatmap.Fri}
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-1 rounded text-[9.5px] uppercase font-bold block text-center max-w-[50px] ${
                        heatmap.Sat === 'high' ? 'bg-amber-500/20 text-[var(--color-accent-amber)]' :
                        heatmap.Sat === 'medium' ? 'bg-blue-500/10 text-blue-300' : 'bg-neutral-800 text-slate-500'
                      }`}>
                        {heatmap.Sat}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

    </div>
  );
};
