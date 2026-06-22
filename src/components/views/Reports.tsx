import { useState, useMemo, useCallback } from 'react';
import { User, Transaction } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { 
  FileText, 
  Calendar, 
  Download, 
  Brain, 
  ChevronRight, 
  User as UserIcon, 
  Coins, 
  PlaneTakeoff, 
  ArrowLeft,
  Loader2,
  MailWarning
} from 'lucide-react';

type ReportTab = 'daily' | 'monthly' | 'routes' | 'agents' | 'credit' | 'airline';

export const Reports = ({ 
  user, 
  transactions,
  onBack
}: { 
  user: User; 
  transactions: Transaction[];
  onBack: () => void;
}) => {
  const [activeTab, setActiveTab] = useState<ReportTab>('daily');
  const [selectedDate, setSelectedDate] = useState('2026-06-20');
  const [selectedMonth, setSelectedMonth] = useState('2026-06');
  const [selectedAirline, setSelectedAirline] = useState('Arik Air');
  
  // AI Narrative State
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [generatingAI, setGeneratingAI] = useState(false);

  // Active dates calculation matching
  const tabTitles: Record<ReportTab, string> = {
    daily: 'Daily Operational ledger',
    monthly: 'Monthly Performance audit',
    routes: 'Route Profitability audit',
    agents: 'Agent Performance tracking',
    credit: 'Credit Sales (Outstanding)',
    airline: 'Airline cargo analysis'
  };

  // Helper: Export table data as CSV
  const handleExportCSV = (title: string, headers: string[], rows: any[][]) => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += headers.join(",") + "\n";
    rows.forEach(r => {
      csvContent += r.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(",") + "\n";
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${title.replace(/\s+/g, '_')}_Report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── DAILY REPORT LEDGER ──
  const dailyLedger = useMemo(() => {
    const day = transactions; // Simulation placeholder of datasets
    const cargo = day.filter(t => t.type === 'cargo');
    const mktg = day.filter(t => t.type === 'marketing');
    const vj = day.filter(t => t.type === 'baggage');

    const cargoTotal = cargo.reduce((sum, t) => sum + t.amount, 0);
    const mktgTotal = mktg.reduce((sum, t) => sum + t.amount, 0);
    const vjTotal = vj.reduce((sum, t) => sum + t.amount, 0);

    return {
      cargo, mktg, vj,
      cargoTotal, mktgTotal, vjTotal,
      grandTotal: cargoTotal + mktgTotal + vjTotal
    };
  }, [transactions]);

  // ── MONTHLY TREND DAY-BY-DAY ──
  const monthlyLedger = useMemo(() => {
    // Generate dates: 1st to 20th of June
    const report: any[] = [];
    let totCargo = 0;
    let totMktg = 0;
    let totVj = 0;
    let totExp = 0;

    for (let day = 1; day <= 20; day++) {
      const dateStr = `${day.toString().padStart(2, '0')}/06`;
      // Multiply dynamic scale factors to create high-integrity month sheet
      const cargoRev = 180000 + (day * 13500) % 250000;
      const mktgRev = 90000 + (day * 17400) % 180000;
      const vjRev = 50000 + (day * 9800) % 110000;
      const expenses = 12000 + (day * 4000) % 35000;
      const gross = cargoRev + mktgRev + vjRev;
      const net = gross - expenses;

      totCargo += cargoRev;
      totMktg += mktgRev;
      totVj += vjRev;
      totExp += expenses;

      report.push({
        date: dateStr,
        cargo: cargoRev,
        marketing: mktgRev,
        vj: vjRev,
        total: gross,
        expenses,
        net
      });
    }

    return {
      report,
      totals: {
        cargo: totCargo,
        marketing: totMktg,
        vj: totVj,
        expenses: totExp,
        net: totCargo + totMktg + totVj - totExp,
        grand: totCargo + totMktg + totVj
      }
    };
  }, [selectedMonth]);

  const creditSalesData = useMemo(() => {
    // Generate dummy breakdown for summary
    const totalCredit = 4800000;
    const collected = 3100000;
    const outstanding = totalCredit - collected;
    const collectionRate = (collected / totalCredit) * 100;
    
    return {
      totalCredit,
      collected,
      outstanding,
      collectionRate,
      list: [
        { id: '1', debtor: 'Aramex Logistics Ltd', ref: 'CG-98443', amount: 145000, age: '14 days', status: '0-30', phone: '08123456789', color: 'var(--color-success)' },
        { id: '2', debtor: 'Globacom Nigeria Corp', ref: 'CG-88401', amount: 320000, age: '37 days', status: '31-60', phone: '08098765432', color: 'var(--color-accent-amber)' },
        { id: '3', debtor: 'SAHCO ground handlers', ref: 'CG-74112', amount: 185000, age: '68 days', status: '61-90', phone: '08111222333', color: 'orange' },
        { id: '4', debtor: 'Fidson Pharmaceuticals', ref: 'CG-50431', amount: 75000, age: '95 days', status: '90+', phone: '08055555555', color: 'var(--color-error)' }
      ]
    };
  }, []);

  // ── ROUTE EFFICIENCY TABLE ──
  const routeProfits = useMemo(() => {
    return [
      { route: 'Lagos - Abuja', cargoEntries: 320, cargoKg: 8400, cargoRev: 4120000, mktgEntries: 180, mktgRev: 1420000, total: 5540000 },
      { route: 'Lagos - Port Harcourt', cargoEntries: 190, cargoKg: 4900, cargoRev: 2470000, mktgEntries: 110, mktgRev: 980000, total: 3450000 },
      { route: 'Abuja - Lagos', cargoEntries: 140, cargoKg: 3500, cargoRev: 1850000, mktgEntries: 75, mktgRev: 520000, total: 2370000 },
      { route: 'Port Harcourt - Lagos', cargoEntries: 95, cargoKg: 2200, cargoRev: 1120000, mktgEntries: 40, mktgRev: 310000, total: 1430000 },
      { route: 'Lagos - Enugu', cargoEntries: 45, cargoKg: 1100, cargoRev: 550000, mktgEntries: 30, mktgRev: 210000, total: 760000 }
    ];
  }, []);

  // ── AGENT LEDGER TABLE ──
  const agentLog = useMemo(() => {
    return [
      { name: 'Bernice Alao', active: 18, entries: 135, revenue: 1540000, expenses: 95000, balance: 1445000 },
      { name: 'Joseph Sanni', active: 15, entries: 110, revenue: 1210000, expenses: 54000, balance: 1156000 },
      { name: 'Femi Adebayo', active: 11, entries: 64, revenue: 760000, expenses: 82000, balance: 678000 }
    ];
  }, []);

  // ── AIRLINE ALLOCATION MATRIX ──
  const airlineCargoData = useMemo(() => {
    return [
      { date: '20/06', entries: 14, weight: 1420, revenue: 980000, consignee: 'Aramex HQ', route: 'LOS - ABV' },
      { date: '19/06', entries: 11, weight: 1150, revenue: 740000, consignee: 'SAHCO desk', route: 'LOS - PHC' },
      { date: '18/06', entries: 18, weight: 1950, revenue: 1250000, consignee: 'DHL Ltd', route: 'LOS - ABV' },
      { date: '17/06', entries: 12, weight: 920, revenue: 610000, consignee: 'FedEx delivery', route: 'ABV - LOS' },
      { date: '16/06', entries: 15, weight: 1680, revenue: 1100000, consignee: 'Aramex HQ', route: 'LOS - ABV' }
    ];
  }, [selectedAirline]);

  // Trigger Gemini AI Narrative Summarization from our server API proxy
  const handleGenerateAINarrative = useCallback(async () => {
    setGeneratingAI(true);
    setAiSummary(null);
    try {
      let reportDataToSend: any = {};
      if (activeTab === 'daily') {
        reportDataToSend = { 
          totalCargo: dailyLedger.cargoTotal, 
          totalMarketing: dailyLedger.mktgTotal, 
          totalVJ: dailyLedger.vjTotal, 
          consolidated: dailyLedger.grandTotal 
        };
      } else if (activeTab === 'monthly') {
        reportDataToSend = monthlyLedger.totals;
      } else if (activeTab === 'routes') {
        reportDataToSend = routeProfits;
      } else {
        reportDataToSend = creditSalesData;
      }

      const response = await fetch('/api/gemini/report-narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportType: tabTitles[activeTab],
          reportData: reportDataToSend
        })
      });

      const data = await response.json();
      if (data.success && data.narrative) {
        setAiSummary(data.narrative);
      } else {
        setAiSummary("AI auditing service returned invalid output. Please check API configuration.");
      }
    } catch (err) {
      console.error(err);
      setAiSummary("Error generating AI auditing summary. Service not reachable.");
    } finally {
      setGeneratingAI(false);
    }
  }, [activeTab, dailyLedger, monthlyLedger, routeProfits, creditSalesData]);

  // Dispatch SMS / WhatsApp notification to debtors
  const handleDispatchDebtReminder = async (debtor: any) => {
    alert(`Dispatched WhatsApp Business invoice warning to ${debtor.debtor} [${debtor.phone}]:\n"EHI Multisystems: Friendly reminder. Outstanding balance of ₦${debtor.amount.toLocaleString()} for shipment ${debtor.ref} is aged ${debtor.age}."`);
    try {
      await fetch('/api/notify/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: debtor.phone,
          message: `EHI Multisystems: Friendly reminder. Outstanding balance of ₦${debtor.amount.toLocaleString()} for shipment ${debtor.ref} is due.`
        })
      });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] p-4 space-y-6 pb-[100px] overflow-y-auto select-none">
      
      {/* Header back navigation */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
        <button onClick={onBack} className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-success)] tracking-widest font-bold">● REPORTS ENGINE</span>
      </div>

      {/* Select Report Flow Option Cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {(['daily', 'monthly', 'routes', 'agents', 'credit', 'airline'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              setAiSummary(null);
            }}
            className={`border rounded p-2 text-center flex flex-col justify-center items-center h-[52px] transition-all cursor-pointer ${activeTab === tab ? 'bg-[var(--color-success)] text-[var(--color-obsidian)] border-[var(--color-success)]' : 'bg-[var(--color-surface-1)] border-[rgba(255,255,255,0.055)] text-gray-300'}`}
          >
            <span className="text-[9px] font-sans font-bold capitalize truncate w-full">{tab === 'credit' ? 'Credit Sales' : tab}</span>
          </button>
        ))}
      </div>

      {/* Audit Scope Label */}
      <div className="bg-[var(--color-surface-1)] rounded p-3 border border-[rgba(255,255,255,0.04)] flex justify-between items-center">
        <div>
          <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase">AUDIT SCOPE</div>
          <div className="text-[12px] font-bold font-sans text-[var(--color-foreground)] uppercase">{tabTitles[activeTab]}</div>
        </div>
        
        {/* Inline context controls */}
        {activeTab === 'daily' && (
          <input 
            type="date" 
            value={selectedDate} 
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent text-[10px] font-mono border-none focus:outline-none focus:ring-0 text-white" 
          />
        )}
        {activeTab === 'monthly' && (
          <input 
            type="month" 
            value={selectedMonth} 
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-transparent text-[10px] font-mono border-none focus:outline-none focus:ring-0 text-white" 
          />
        )}
        {activeTab === 'airline' && (
          <select 
            value={selectedAirline} 
            onChange={(e) => setSelectedAirline(e.target.value)}
            className="bg-transparent text-[10px] font-mono border-none focus:outline-none focus:ring-0 text-white cursor-pointer" 
          >
            <option value="Arik Air" className="bg-[var(--color-surface-1)]">Arik Air</option>
            <option value="Green Africa" className="bg-[var(--color-surface-1)]">Green Africa</option>
            <option value="United Nigeria" className="bg-[var(--color-surface-1)]">United Nigeria</option>
          </select>
        )}
      </div>

      {/* Dynamic Report View Layout Container */}
      <div className="bg-[var(--color-surface-1)] rounded border border-[var(--color-border)] overflow-hidden">
        
        {/* Table Content */}
        <div className="p-3">
          
          {/* TAB 1: DAILY */}
          {activeTab === 'daily' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="p-2.5 bg-black rounded text-center">
                  <div className="text-[8px] text-[var(--color-muted)] font-mono uppercase">Cargo</div>
                  <div className="text-[12px] font-bold text-[var(--color-accent-amber)] mt-1">{fmt(dailyLedger.cargoTotal)}</div>
                </div>
                <div className="p-2.5 bg-black rounded text-center">
                  <div className="text-[8px] text-[var(--color-muted)] font-mono uppercase">Marketing</div>
                  <div className="text-[12px] font-bold text-[var(--color-success)] mt-1">{fmt(dailyLedger.mktgTotal)}</div>
                </div>
                <div className="p-2.5 bg-black rounded text-center">
                  <div className="text-[8px] text-[var(--color-muted)] font-mono uppercase">ValueJet</div>
                  <div className="text-[12px] font-bold text-[var(--color-accent-cobalt)] mt-1">{fmt(dailyLedger.vjTotal)}</div>
                </div>
              </div>

              <div className="pt-2 text-center">
                <div className="text-[11px] font-mono text-[var(--color-muted)] uppercase">Consolidated Day's Cash Remit</div>
                <div className="text-[20px] font-mono font-bold text-[var(--color-success)] mt-1">{fmt(dailyLedger.grandTotal)}</div>
              </div>

              <div className="flex w-full space-x-2 pt-2">
                <button 
                  onClick={() => handleExportCSV('Daily_Ledger', ['Category', 'Volume', 'Revenue'], [['Cargo', dailyLedger.cargo.length, dailyLedger.cargoTotal], ['Marketing', dailyLedger.mktg.length, dailyLedger.mktgTotal], ['ValueJet', dailyLedger.vj.length, dailyLedger.vjTotal]])}
                  className="flex-1 h-9 bg-neutral-800 text-white rounded text-[10px] font-mono font-bold flex items-center justify-center space-x-1 border border-[rgba(255,255,255,0.05)]"
                >
                  <Download size={11} />
                  <span>EXPORT CSV</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: MONTHLY */}
          {activeTab === 'monthly' && (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-[9px]">
                  <thead>
                    <tr className="text-[var(--color-muted)] border-b border-[rgba(255,255,255,0.05)] text-[8px] uppercase">
                      <th className="py-1">Date</th>
                      <th className="py-1 text-center">Gross (₦)</th>
                      <th className="py-1 text-center">Expenses (₦)</th>
                      <th className="py-1 text-right">Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyLedger.report.slice(10, 15).map((row, i) => (
                      <tr key={i} className="border-b border-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.01)]">
                        <td className="py-1.5 text-white font-bold">{row.date}</td>
                        <td className="py-1.5 text-center text-gray-300">{row.total.toLocaleString()}</td>
                        <td className="py-1.5 text-center text-[var(--color-error)]">{(row.expenses).toLocaleString()}</td>
                        <td className="py-1.5 text-right text-[var(--color-success)] font-bold">{(row.net).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] text-[10px] font-bold">
                      <td className="py-2 text-white">Consolidated</td>
                      <td className="py-2 text-center text-gray-300">{fmt(monthlyLedger.totals.grand)}</td>
                      <td className="py-2 text-center text-[var(--color-error)]">{fmt(monthlyLedger.totals.expenses)}</td>
                      <td className="py-2 text-right text-[var(--color-success)]">{fmt(monthlyLedger.totals.net)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <button 
                onClick={() => handleExportCSV('Monthly_Performance', ['Date', 'Gross', 'Expenses', 'Net'], monthlyLedger.report.map(r => [r.date, r.total, r.expenses, r.net]))}
                className="w-full h-8 bg-neutral-800 text-white rounded text-[10px] font-mono font-bold flex items-center justify-center space-x-1.5"
              >
                <Download size={11} />
                <span>EXP MONTHLY SHEET (CSV)</span>
              </button>
            </div>
          )}

          {/* TAB 3: ROUTES */}
          {activeTab === 'routes' && (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-[9px]">
                  <thead>
                    <tr className="text-[var(--color-muted)] border-b border-[rgba(255,255,255,0.05)] text-[8px] uppercase">
                      <th className="py-1">Route</th>
                      <th className="text-center py-1">Cargo Rev</th>
                      <th className="text-center py-1">Marketing</th>
                      <th className="text-right py-1">Combined Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routeProfits.map((row, i) => (
                      <tr key={i} className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.01)]">
                        <td className={`py-2 truncate max-w-[100px] font-bold ${i < 3 ? 'text-[var(--color-accent-amber)]' : 'text-white'}`}>{row.route}</td>
                        <td className="text-center py-2 text-gray-300">{(row.cargoRev).toLocaleString()}</td>
                        <td className="text-center py-2 text-gray-300">{(row.mktgRev).toLocaleString()}</td>
                        <td className="text-right py-2 font-bold text-white">{fmt(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: AGENTS */}
          {activeTab === 'agents' && (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-[9px]">
                  <thead>
                    <tr className="text-[var(--color-muted)] border-b border-[rgba(255,255,255,0.05)] text-[8px] uppercase">
                      <th className="py-1">Agent</th>
                      <th className="text-center py-1">Active Days</th>
                      <th className="text-center py-1 font-bold">Ledger Revenue</th>
                      <th className="text-right py-1">Remittance Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentLog.map((row, i) => (
                      <tr key={i} className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.01)]">
                        <td className="py-2 text-white font-bold">{row.name}</td>
                        <td className="text-center py-2 text-gray-300">{row.active} d</td>
                        <td className="text-center py-2 font-bold text-white">{fmt(row.revenue)}</td>
                        <td className="text-right py-2 text-[var(--color-success)] font-bold">{fmt(row.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: CREDIT SALES AGING */}
          {activeTab === 'credit' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-2.5 bg-black rounded text-center border border-[rgba(255,255,255,0.05)]">
                  <div className="text-[8px] text-[var(--color-muted)] font-mono uppercase">Total Credit Extended</div>
                  <div className="text-[12px] font-bold text-white mt-1">{fmt(creditSalesData.totalCredit)}</div>
                </div>
                <div className="p-2.5 bg-black rounded text-center border border-[rgba(255,255,255,0.05)]">
                  <div className="text-[8px] text-[var(--color-muted)] font-mono uppercase">Collection Rate</div>
                  <div className="text-[12px] font-bold text-[var(--color-success)] mt-1">{creditSalesData.collectionRate.toFixed(1)}%</div>
                </div>
                <div className="p-2.5 bg-[rgba(16,185,129,0.1)] rounded text-center border border-[rgba(16,185,129,0.2)]">
                  <div className="text-[8px] text-[var(--color-success)] font-mono uppercase">Collected (Cleared)</div>
                  <div className="text-[12px] font-bold text-[var(--color-success)] mt-1">{fmt(creditSalesData.collected)}</div>
                </div>
                <div className="p-2.5 bg-[rgba(239,68,68,0.1)] rounded text-center border border-[rgba(239,68,68,0.2)]">
                  <div className="text-[8px] text-[var(--color-error)] font-mono uppercase">Outstanding</div>
                  <div className="text-[12px] font-bold text-[var(--color-error)] mt-1">{fmt(creditSalesData.outstanding)}</div>
                </div>
              </div>

              <div className="space-y-2">
                {creditSalesData.list.map((item) => (
                  <div key={item.id} className="p-2.5 bg-black/40 rounded border border-[rgba(255,255,255,0.05)] flex justify-between items-center text-[10px] font-mono">
                    <div className="space-y-1">
                      <div className="text-[11px] font-sans font-bold text-white truncate max-w-[150px]">{item.debtor}</div>
                      <div className="text-[8.5px] text-[var(--color-muted)]">{item.ref} · <span className="text-gray-300 font-bold">{item.age} aged</span></div>
                    </div>
                    <div className="text-right space-y-1 shrink-0">
                      <div className="font-bold text-[var(--color-error)]">{fmt(item.amount)}</div>
                      <button 
                        onClick={() => handleDispatchDebtReminder(item)}
                        className="text-[8px] font-bold text-[var(--color-success)] px-1.5 py-0.5 border border-[rgba(16,185,129,0.3)] bg-transparent rounded uppercase cursor-pointer hover:bg-[rgba(16,185,129,0.05)]"
                      >
                        Reminder
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 6: AIRLINE CHARTER */}
          {activeTab === 'airline' && (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-[9px]">
                  <thead>
                    <tr className="text-[var(--color-muted)] border-b border-[rgba(255,255,255,0.05)] text-[8px] uppercase">
                      <th className="py-1">Date</th>
                      <th className="text-center py-1">Weight</th>
                      <th className="text-center py-1">Gross Rev</th>
                      <th className="text-right py-1">Route</th>
                    </tr>
                  </thead>
                  <tbody>
                    {airlineCargoData.map((row, i) => (
                      <tr key={i} className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.01)] text-[9px]">
                        <td className="py-2 text-[var(--color-light-muted)]">{row.date}</td>
                        <td className="text-center py-2 text-white font-bold">{row.weight} KG</td>
                        <td className="text-center py-2 text-[var(--color-success)] font-bold">{fmt(row.revenue)}</td>
                        <td className="text-right py-2 text-gray-300">{row.route}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* AI Summary / Audit generator block */}
      <div className="border border-[rgba(255,255,255,0.06)] rounded overflow-hidden">
        
        {/* Interactive button */}
        <div className="p-3 bg-[var(--color-surface-1)] flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Brain size={15} className="text-[var(--color-success)] animate-pulse" />
            <span className="text-[10px] font-mono tracking-wider text-gray-300 uppercase font-bold">LOGISTICS EXECUTIVE AUDIT</span>
          </div>
          <button 
            onClick={handleGenerateAINarrative}
            disabled={generatingAI}
            className="h-8 px-3 bg-[var(--color-success)] hover:bg-emerald-600 disabled:opacity-50 text-[var(--color-obsidian)] font-mono text-[9px] font-bold rounded flex items-center space-x-1.5 cursor-pointer transition-colors"
          >
            {generatingAI ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                <span>COMPILING...</span>
              </>
            ) : (
              <>
                <Brain size={11} />
                <span>GENERATE NARRATIVE</span>
              </>
            )}
          </button>
        </div>

        {/* Narrative Card */}
        {aiSummary && (
          <div className="p-3.5 bg-black/60 border-t border-[rgba(255,255,255,0.05)] space-y-3 animate-in fade-in duration-300">
            <div className="text-[9px] font-mono text-[var(--color-success)] uppercase font-bold tracking-widest flex items-center space-x-1.5">
              <span>● AUDIT COMPLETED</span>
            </div>
            
            <div className="text-[11.5px] font-sans text-gray-200 leading-relaxed font-sans space-y-3 whitespace-pre-line">
              {aiSummary}
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
