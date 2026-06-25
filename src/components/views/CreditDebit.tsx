import { useState, useMemo } from 'react';
import { User, Transaction } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { ArrowLeft, CreditCard, Building2, Users, Search, ArrowDownLeft, ArrowUpRight, TrendingDown, TrendingUp, Building, UserSquare2 } from 'lucide-react';

export const CreditDebit = ({ user, transactions }: { user: User; transactions: Transaction[] }) => {
  const [activeTab, setActiveTab] = useState<'debts' | 'credits'>('debts');
  const [search, setSearch] = useState('');

  // Load commissions from local storage
  const rawCommissions = localStorage.getItem('ehi_airline_commissions');
  const commissions: Record<string, number> = rawCommissions ? JSON.parse(rawCommissions) : { 'ValueJet': 10 };

  const debts = useMemo(() => {
    return transactions.filter(tx => tx.mode === 'Debt' && (tx.name.toLowerCase().includes(search.toLowerCase()) || tx.awb_tag_number?.includes(search)));
  }, [transactions, search]);

  const debtSummary = useMemo(() => {
    const summary: Record<string, number> = {};
    debts.forEach(tx => {
      const name = tx.name || 'Unknown';
      summary[name] = (summary[name] || 0) + tx.amount;
    });
    return Object.entries(summary).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [debts]);

  const totalDebt = debts.reduce((acc, tx) => acc + tx.amount, 0);

  // Credits (what we owe airlines)
  // For each transaction that has an airline, we calculate what we owe them based on the commission rate.
  // We owe = amount - (amount * commission / 100).
  const credits = useMemo(() => {
    return transactions.filter(tx => tx.airline && tx.airline.toLowerCase().includes(search.toLowerCase()));
  }, [transactions, search]);

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
        {activeTab === 'debts' && (
          <>
            <div className="bg-[var(--color-surface-card)] border border-[rgba(245,158,11,0.2)] rounded-lg p-6 flex flex-col justify-center items-center shadow-[0_0_15px_rgba(245,158,11,0.05)] relative overflow-hidden">
              <div className="absolute -top-6 -right-6 opacity-5 text-[var(--color-accent-amber)]">
                <TrendingDown size={120} />
              </div>
              <div className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-2 relative z-10 flex items-center gap-2">
                <ArrowDownLeft size={14} className="text-[var(--color-accent-amber)]" /> Total Outstanding Debt
              </div>
              <div className="text-[32px] font-sans font-bold text-[var(--color-accent-amber)] relative z-10">₦{fmt(totalDebt)}</div>
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
                  <div className="font-mono text-[14px] font-bold text-[var(--color-accent-amber)] tracking-tight">₦{fmt(d.amount)}</div>
                </div>
              ))}
            </div>

            <div className="mt-8 space-y-3">
              <h3 className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">Detailed Ledger</h3>
              {debts.map((tx, i) => (
                <div key={i} className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded-lg p-4 hover:border-[rgba(255,255,255,0.1)] transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[14px] font-sans font-bold text-white">{tx.name}</span>
                    <span className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">₦{fmt(tx.amount)}</span>
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
              <div className="text-[32px] font-sans font-bold text-emerald-400 relative z-10">₦{fmt(totalCredit)}</div>
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
                  <div className="font-mono text-[14px] font-bold text-emerald-400 tracking-tight">₦{fmt(c.amount)}</div>
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
                      <span className="text-[13px] font-mono font-bold text-emerald-400">₦{fmt(weOwe)}</span>
                    </div>
                    <div className="text-[11px] font-mono text-[var(--color-muted)] mb-3 bg-[var(--color-surface-2)] inline-block px-2 py-1 rounded">
                      Base: ₦{fmt(tx.amount)} <span className="mx-1 opacity-50">&middot;</span> Comm: {commRate}% <span className="text-[var(--color-accent-amber)]">(₦{fmt(tx.amount * commRate / 100)})</span>
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
      </div>
    </main>
  );
};
