import { useState, useMemo, useEffect } from 'react';
import { User, Transaction } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { ArrowLeft, CreditCard, Building2, Users, Search, ArrowDownLeft, ArrowUpRight, TrendingDown, TrendingUp, Building, UserSquare2, Loader } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export const CreditDebit = ({ user, transactions: _propTransactions }: { user: User; transactions: Transaction[] }) => {
  const [activeTab, setActiveTab] = useState<'debts' | 'credits'>('debts');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [debtsData, setDebtsData] = useState<Transaction[]>([]);
  const [creditsData, setCreditsData] = useState<Transaction[]>([]);
  const [commissions, setCommissions] = useState<Record<string, number>>({ 'ValueJet': 10 });

  useEffect(() => {
    const loadLedger = async () => {
      setLoading(true);
      const isAdmin = user.role === 'admin' || user.role === 'super_admin';
      const addHubFilter = (q: any) => (!isAdmin && user.hub_id) ? q.eq('hub_id', user.hub_id) : q;

      try {
        // Fetch configs
        const { data: configData } = await supabase.from('pricing_config').select('config_value').eq('config_key', 'airline_commissions').single();
        if (configData && configData.config_value) {
          setCommissions(configData.config_value);
        } else {
          const rawCommissions = localStorage.getItem('ehi_airline_commissions');
          if (rawCommissions) setCommissions(JSON.parse(rawCommissions));
        }

        // Fetch Debts (all time)
        const [cargoDebts, vjDebts, mktDebts] = await Promise.all([
          addHubFilter(supabase.from('cargo_entries').select('*').eq('payment_mode', 'Debt')),
          addHubFilter(supabase.from('manifests').select('*').eq('payment_mode', 'Debt')),
          addHubFilter(supabase.from('marketing_entries').select('*').eq('payment_mode', 'Debt'))
        ]);

        const mappedDebts: Transaction[] = [];
        if (cargoDebts.data) {
          cargoDebts.data.forEach(r => mappedDebts.push({
            id: r.entry_ref || r.id, name: r.consignee_name || 'Cargo', detail: `${r.airline || ''} · ${r.awb_tag_number || ''}`, amount: r.amount || 0, mode: 'Debt', time: r.created_at, type: 'cargo', awb_tag_number: r.awb_tag_number, status: r.status || 'Intake'
          }));
        }
        if (vjDebts.data) {
          vjDebts.data.forEach(r => mappedDebts.push({
            id: r.transaction_id || r.id, name: r.passenger_name || 'Passenger', detail: `${r.flight_no || ''}`, amount: r.amount || 0, mode: 'Debt', time: r.created_at, type: 'baggage', status: 'Intake'
          }));
        }
        if (mktDebts.data) {
          mktDebts.data.forEach(r => mappedDebts.push({
            id: r.entry_ref || r.id, name: r.customer_name || 'Customer', detail: `${r.route || ''}`, amount: r.amount_paid || 0, mode: 'Debt', time: r.created_at, type: 'marketing', status: 'Intake'
          }));
        }
        setDebtsData(mappedDebts);

        // Fetch Credits (last 30 days of cargo)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
        const cargoCreditsReq = await addHubFilter(supabase.from('cargo_entries').select('*').gte('created_at', thirtyDaysAgo));
        
        const mappedCredits: Transaction[] = [];
        if (cargoCreditsReq.data) {
          cargoCreditsReq.data.forEach(r => {
            if (r.airline) {
              mappedCredits.push({
                id: r.entry_ref || r.id, name: r.consignee_name || 'Cargo', detail: `${r.awb_tag_number || ''}`, amount: r.amount || 0, mode: r.payment_mode, time: r.created_at, type: 'cargo', airline: r.airline, status: r.status || 'Intake'
              });
            }
          });
        }
        setCreditsData(mappedCredits);
      } catch (err) {
        console.error('Ledger fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadLedger();
  }, [user.hub_id, user.role]);

  const debts = useMemo(() => {
    return debtsData.filter(tx => (tx.name.toLowerCase().includes(search.toLowerCase()) || tx.awb_tag_number?.includes(search)));
  }, [debtsData, search]);

  const debtSummary = useMemo(() => {
    const summary: Record<string, number> = {};
    debts.forEach(tx => {
      const name = tx.name || 'Unknown';
      summary[name] = (summary[name] || 0) + tx.amount;
    });
    return Object.entries(summary).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [debts]);

  const totalDebt = debts.reduce((acc, tx) => acc + tx.amount, 0);

  const credits = useMemo(() => {
    return creditsData.filter(tx => tx.airline && tx.airline.toLowerCase().includes(search.toLowerCase()));
  }, [creditsData, search]);

  const creditSummary = useMemo(() => {
    const summary: Record<string, number> = {};
    credits.forEach(tx => {
      const airline = tx.airline || 'Unknown';
      const commRate = commissions[airline] || 0; // if 0, we owe 100%? Or 0 commission means we keep 0, pay 100%.
      // Actually, if commission is 10%, we keep 10%, pay 90%.
      const weOwe = tx.amount * (1 - commRate / 100);
      summary[airline] = (summary[airline] || 0) + weOwe;
    });
    return Object.entries(summary).map(([airline, amount]) => ({ airline, amount })).sort((a, b) => b.amount - a.amount);
  }, [credits, commissions]);

  const totalCredit = creditSummary.reduce((acc, c) => acc + c.amount, 0);

  return (
    <main className="flex-1 flex flex-col h-full bg-[var(--color-bg)] overflow-hidden">
      {/* Header */}
      <div className="bg-[var(--color-surface-card)] border-b border-[var(--color-border)] p-4 flex flex-col">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[rgba(245,158,11,0.1)] rounded-lg">
            <CreditCard size={20} strokeWidth={1.5} className="text-[var(--color-accent-amber)]" />
          </div>
          <div>
            <h1 className="text-[16px] font-bold font-sans text-[var(--color-foreground)] tracking-tight">Credit & Debit</h1>
            <p className="text-[11px] font-mono text-[var(--color-muted)] mt-0.5">Ledger for current period</p>
          </div>
        </div>

        <div className="flex bg-[var(--color-obsidian)] border border-[rgba(255,255,255,0.05)] p-1 rounded-lg mt-5 mb-2 w-full">
          <button
            onClick={() => setActiveTab('debts')}
            className={`flex-1 py-2.5 text-[11px] font-bold font-mono uppercase tracking-wider rounded transition-all flex items-center justify-center gap-2 ${
              activeTab === 'debts' ? 'bg-[var(--color-surface-2)] text-[var(--color-accent-amber)] shadow-sm border border-[rgba(245,158,11,0.2)]' : 'text-[var(--color-muted)] hover:text-white'
            }`}
          >
            <ArrowDownLeft size={14} strokeWidth={2} /> Receivables
          </button>
          <button
            onClick={() => setActiveTab('credits')}
            className={`flex-1 py-2.5 text-[11px] font-bold font-mono uppercase tracking-wider rounded transition-all flex items-center justify-center gap-2 ${
              activeTab === 'credits' ? 'bg-[var(--color-surface-2)] text-emerald-400 shadow-sm border border-[rgba(16,185,129,0.2)]' : 'text-[var(--color-muted)] hover:text-white'
            }`}
          >
            <ArrowUpRight size={14} strokeWidth={2} /> Payables
          </button>
        </div>

        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" size={14} strokeWidth={1.5} />
          <input
            type="text"
            placeholder={activeTab === 'debts' ? 'Search debtors...' : 'Search airlines...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg pl-9 pr-3 py-2 text-[13px] font-sans text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-[var(--color-muted)] gap-2">
            <Loader size={16} className="animate-spin" />
            <span className="text-[12px] font-mono">Loading ledger...</span>
          </div>
        ) : (
          <>
            {activeTab === 'debts' && (
              <>
                <div className="bg-[var(--color-surface-card)] border border-[rgba(245,158,11,0.2)] rounded-lg p-6 flex flex-col justify-center items-center shadow-[0_0_15px_rgba(245,158,11,0.05)] relative overflow-hidden">
                  <div className="absolute -top-6 -right-6 opacity-5 text-[var(--color-accent-amber)]">
                    <TrendingDown size={120} />
                  </div>
                  <div className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-2 relative z-10 flex items-center gap-2">
                    <ArrowDownLeft size={14} className="text-[var(--color-accent-amber)]" /> Total Outstanding Debt
                  </div>
                  <div className="text-[32px] font-sans font-bold text-[var(--color-accent-amber)] relative z-10">{fmt(totalDebt)}</div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">Debtors Breakdown</h3>
                  {debtSummary.length === 0 && <div className="text-[12px] font-mono text-[var(--color-muted)] text-center py-4 bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded-lg">No debts found.</div>}
                  {debtSummary.map((d, i) => (
                    <div key={i} className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded-lg p-4 flex justify-between items-center hover:border-[rgba(255,255,255,0.1)] transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-[var(--color-surface-2)] rounded flex items-center justify-center text-[var(--color-muted)]">
                          <UserSquare2 size={16} />
                        </div>
                        <div className="font-sans font-bold text-[14px] text-white">{d.name}</div>
                      </div>
                      <div className="font-mono text-[14px] font-bold text-[var(--color-accent-amber)] tracking-tight">{fmt(d.amount)}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 space-y-3">
                  <h3 className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">Detailed Ledger</h3>
                  {debts.map((tx, i) => (
                    <div key={i} className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded-lg p-4 hover:border-[rgba(255,255,255,0.1)] transition-colors">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[14px] font-sans font-bold text-white">{tx.name}</span>
                        <span className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">{fmt(tx.amount)}</span>
                      </div>
                      <div className="text-[12px] font-sans text-[var(--color-muted)] mb-3">{tx.detail}</div>
                      <div className="flex justify-between pt-3 border-t border-[rgba(255,255,255,0.05)] text-[10px] font-mono text-[var(--color-muted)] uppercase">
                        <span>{new Date(tx.time).toLocaleDateString()}</span>
                        <span>{tx.id}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {activeTab === 'credits' && (
          <>
            <div className="bg-[var(--color-surface-card)] border border-[rgba(16,185,129,0.2)] rounded-lg p-6 flex flex-col justify-center items-center shadow-[0_0_15px_rgba(16,185,129,0.05)] relative overflow-hidden">
              <div className="absolute -top-6 -right-6 opacity-5 text-emerald-400">
                <TrendingUp size={120} />
              </div>
              <div className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-2 relative z-10 flex items-center gap-2">
                <ArrowUpRight size={14} className="text-emerald-400" /> Total Due to Airlines
              </div>
              <div className="text-[32px] font-sans font-bold text-emerald-400 relative z-10">{fmt(totalCredit)}</div>
            </div>

            <div className="space-y-3">
              <h3 className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">Airlines Breakdown</h3>
              {creditSummary.length === 0 && <div className="text-[12px] font-mono text-[var(--color-muted)] text-center py-4 bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded-lg">No credits found.</div>}
              {creditSummary.map((c, i) => (
                <div key={i} className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded-lg p-4 flex justify-between items-center hover:border-[rgba(255,255,255,0.1)] transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-[var(--color-surface-2)] rounded flex items-center justify-center text-[var(--color-muted)]">
                      <Building size={16} />
                    </div>
                    <div className="font-sans font-bold text-[14px] text-white">{c.airline}</div>
                  </div>
                  <div className="font-mono text-[14px] font-bold text-emerald-400 tracking-tight">{fmt(c.amount)}</div>
                </div>
              ))}
            </div>

            <div className="mt-8 space-y-3">
              <h3 className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">Detailed Remittances</h3>
              {credits.map((tx, i) => {
                const commRate = commissions[tx.airline!] || 0;
                const weOwe = tx.amount * (1 - commRate / 100);
                return (
                  <div key={i} className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded-lg p-4 hover:border-[rgba(255,255,255,0.1)] transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[14px] font-sans font-bold text-white">{tx.airline} <span className="opacity-50 text-[11px] font-mono ml-1">({tx.id})</span></span>
                      <span className="text-[13px] font-mono font-bold text-emerald-400">{fmt(weOwe)}</span>
                    </div>
                    <div className="text-[11px] font-mono text-[var(--color-muted)] mb-3 bg-[var(--color-surface-2)] inline-block px-2 py-1 rounded">
                      Base: {fmt(tx.amount)} <span className="mx-1 opacity-50">&middot;</span> Comm: {commRate}% <span className="text-[var(--color-accent-amber)]">({fmt(tx.amount * commRate / 100)})</span>
                    </div>
                    <div className="text-[12px] font-sans text-[var(--color-muted)] line-clamp-1 pt-1">
                      {tx.detail}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </>
      )}
      </div>
    </main>
  );
};
