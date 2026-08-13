import { useState, useMemo, useEffect, useCallback } from 'react';
import { User, Transaction } from '../../lib/types';
import { fmt, roundMoney } from '../../lib/helpers';
import { CreditCard, Building2, Users, Search, ArrowDownLeft, ArrowUpRight, TrendingDown, TrendingUp, Building, UserSquare2, Loader, FileDown } from 'lucide-react';
import { BackButton } from '../BackButton';
import { supabase, fetchAllRows } from '../../lib/supabase';
import { normalizeAirlineName } from '../../lib/helpers';
import { EmptyState } from './EmptyState';

export const CreditDebit = ({ user, transactions: _propTransactions, onBack }: { user: User; transactions: Transaction[]; onBack?: () => void }) => {
  const [activeTab, setActiveTab] = useState<'debts' | 'credits'>(() => {
    return (sessionStorage.getItem('ehi_creditdebit_tab') as any) || 'debts';
  });

  useEffect(() => {
    sessionStorage.setItem('ehi_creditdebit_tab', activeTab);
  }, [activeTab]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const [debtsData, setDebtsData] = useState<Transaction[]>([]);
  const [creditsData, setCreditsData] = useState<Transaction[]>([]);
  const [commissions, setCommissions] = useState<Record<string, number>>({ 'ValueJet': 10 });

  const loadLedger = useCallback(async () => {
      setLoading(true);
      // 'accountant' is treated as hub-unrestricted everywhere else in this
      // app (is_hub_unrestricted() at the RLS layer, and this screen's own
      // STATIC_VIEWS access list) -- omitting it here silently clamped an
      // accountant to only their single home hub while admin/super_admin
      // saw every sibling hub's debts/credits.
      const isUnrestricted = ['admin', 'super_admin', 'accountant'].includes(user.role);
      const addHubFilter = (q: any) => (!isUnrestricted && user.hub_id) ? q.eq('hub_id', user.hub_id) : q;

      try {
        // Fetch configs
        const { data: configData } = await supabase.from('pricing_config').select('config_value').eq('config_key', 'airline_commissions').single();
        if (configData && configData.config_value) {
          setCommissions(configData.config_value);
        } else {
          const rawCommissions = localStorage.getItem('ehi_airline_commissions');
          if (rawCommissions) setCommissions(JSON.parse(rawCommissions));
        }

        // Fetch Debts (all time -- a debt from months ago can still be
        // outstanding, so this can't be date-bounded the way Credits is
        // below). Paginated past PostgREST's implicit ~1000-row cap instead
        // of hard-limiting to the 1000 most recent rows per table -- this is
        // filtered to genuinely outstanding Debt-mode rows, not the whole
        // table, so it only grows with real debt, the same class of query
        // src/lib/debt.ts's fetchAllDebtAndRetrievalEntries already uses
        // fetchAllRows for.
        // .order('id') as a secondary sort key -- created_at alone isn't
        // unique (bulk imports/migrations can share an exact timestamp), so
        // rows tied on created_at that straddle a page boundary could
        // otherwise duplicate or vanish across fetchAllRows' paged requests.
        const [cargoDebts, vjDebts, mktDebts, pkgDebts] = await Promise.all([
          fetchAllRows<any>((from, to) => addHubFilter(supabase.from('cargo_entries').select('id,entry_ref,consignee_name,airline,amount,amount_paid,receipt_mode,created_at,awb_tag_number,status,retrieved_amount').eq('receipt_mode', 'Debt').order('created_at', { ascending: false }).order('id')).range(from, to)),
          fetchAllRows<any>((from, to) => addHubFilter(supabase.from('manifests').select('id,transaction_id,passenger_name,flight_no,amount,amount_paid,created_at,retrieved_amount').eq('payment_mode', 'Debt').order('created_at', { ascending: false }).order('id')).range(from, to)),
          fetchAllRows<any>((from, to) => addHubFilter(supabase.from('marketing_entries').select('id,entry_ref,customer_name,route,amount_paid,debt_amount_paid,created_at,retrieved_amount').eq('payment_mode', 'Debt').order('created_at', { ascending: false }).order('id')).range(from, to)),
          fetchAllRows<any>((from, to) => addHubFilter(supabase.from('package_entries').select('id,entry_ref,customer_name,destination,amount,amount_paid,created_at,status,retrieved_amount').eq('payment_mode', 'Debt').order('created_at', { ascending: false }).order('id')).range(from, to)),
        ]);

        // amountPaid is carried through so downstream balance calcs (below)
        // reflect payments already recorded via DebtorsTab -- previously
        // this view summed the full original `amount` regardless of partial
        // payoffs made elsewhere, overstating outstanding debt until a debt
        // was paid all the way to zero (the only thing that flips mode away
        // from 'Debt').
        const mappedDebts: Transaction[] = [];
        if (cargoDebts) {
          cargoDebts.forEach(r => mappedDebts.push({
            id: r.entry_ref || r.id, name: r.consignee_name || 'Cargo', detail: `${r.airline || ''}`, amount: r.amount || 0, amountPaid: r.amount_paid || 0, mode: 'Debt', time: r.created_at, type: 'cargo', awb_tag_number: r.awb_tag_number, status: r.status || 'Intake', raw: r
          }));
        }
        if (vjDebts) {
          vjDebts.forEach(r => mappedDebts.push({
            id: r.transaction_id || r.id, name: r.passenger_name || 'Passenger', detail: `${r.flight_no || ''}`, amount: r.amount || 0, amountPaid: r.amount_paid || 0, mode: 'Debt', time: r.created_at, type: 'baggage', status: 'Intake', raw: r
          }));
        }
        if (mktDebts) {
          mktDebts.forEach(r => mappedDebts.push({
            // marketing_entries has an inverted naming convention from the
            // other 3 tables (see clear_marketing_debt's own comment):
            // amount_paid holds the SALE TOTAL, not what's been paid down;
            // debt repayment tracking is the separate debt_amount_paid
            // column. `r.amount` itself is never written by the app at all
            // (EHIApp.tsx's marketing INSERT payload writes the sale total
            // into amount_paid, not amount) -- using it here as the debt's
            // principal meant every marketing debt computed a balance of
            // 0 - debt_amount_paid, always <= 0, and was silently filtered
            // out of this screen's debt list entirely, regardless of role.
            id: r.entry_ref || r.id, name: r.customer_name || 'Customer', detail: `${r.route || ''}`, amount: r.amount_paid || 0, amountPaid: r.debt_amount_paid || 0, mode: 'Debt', time: r.created_at, type: 'marketing', status: 'Intake', raw: r
          }));
        }
        if (pkgDebts) {
          pkgDebts.forEach(r => mappedDebts.push({
            id: r.entry_ref || r.id, name: r.customer_name || 'Customer', detail: `${r.destination || ''}`, amount: r.amount || 0, amountPaid: r.amount_paid || 0, mode: 'Debt', time: r.created_at, type: 'package', status: r.status || 'Intake', raw: r
          }));
        }
        // Subtract retrieved_amount too (matches DebtorsTab.tsx/clear_*_debt's
        // canonical balance formula) -- a debt already settled in full or in
        // part via a retrieval, not a manual payment, was still showing its
        // full original balance as outstanding here.
        setDebtsData(mappedDebts.filter(tx => (tx.amount - (tx.amountPaid || 0) - ((tx.raw as any)?.retrieved_amount || 0)) > 0));

        // Fetch Credits (last 30 days of cargo) -- date-bounded, but a busy
        // hub can still clear 1000 cargo entries within 30 days, so this
        // needs the same pagination treatment as the Debts fetch above,
        // not just a date filter, to actually show every commission-bearing
        // sale in the window rather than silently the newest ~1000.
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
        const cargoCredits = await fetchAllRows<any>((from, to) => addHubFilter(supabase.from('cargo_entries').select('id,entry_ref,consignee_name,route,amount,receipt_mode,created_at,airline,commission_rate,status').gte('created_at', thirtyDaysAgo).order('created_at', { ascending: false }).order('id')).range(from, to));

        const mappedCredits: Transaction[] = [];
        if (cargoCredits) {
          cargoCredits.forEach(r => {
            if (r.airline) {
              mappedCredits.push({
                id: r.entry_ref || r.id, name: r.consignee_name || 'Cargo', detail: `${r.route || ''}`, amount: r.amount || 0, mode: r.receipt_mode, time: r.created_at, type: 'cargo', airline: normalizeAirlineName(r.airline), commissionRate: r.commission_rate ?? undefined, status: r.status || 'Intake'
              });
            }
          });
        }
        setCreditsData(mappedCredits);
      } catch (err) {
        console.error('Ledger fetch error:', err);
        setFetchError(true);
      } finally {
        setLoading(false);
      }
  }, [user.hub_id, user.role]);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  const retryFetch = () => {
    setFetchError(false);
    loadLedger();
  };

  const debts = useMemo(() => {
    return debtsData.filter(tx => (tx.name.toLowerCase().includes(search.toLowerCase()) || tx.awb_tag_number?.includes(search)));
  }, [debtsData, search]);

  // Canonical remaining-balance formula (matches clear_*_debt's own SQL and
  // DebtorsTab.tsx) -- subtracting retrieved_amount too, not just
  // amountPaid, so a debt already settled via a retrieval doesn't show an
  // inflated balance anywhere this screen displays one.
  const debtBalance = (tx: Transaction) => tx.amount - (tx.amountPaid || 0) - ((tx.raw as any)?.retrieved_amount || 0);

  const debtSummary = useMemo(() => {
    const summary: Record<string, number> = {};
    debts.forEach(tx => {
      const name = tx.name || 'Unknown';
      summary[name] = (summary[name] || 0) + debtBalance(tx);
    });
    return Object.entries(summary).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [debts]);

  const totalDebt = debts.reduce((acc, tx) => acc + debtBalance(tx), 0);

  const credits = useMemo(() => {
    return creditsData.filter(tx => tx.airline && tx.airline.toLowerCase().includes(search.toLowerCase()));
  }, [creditsData, search]);

  // Cargo entries and commission config keys have historically used both
  // short and long airline names ("Green Africa" vs "Green Africa
  // Airways") -- built once here, keyed by the SAME normalizeAirlineName
  // used on tx.airline below, so creditSummary/creditsDetailed/the PDF
  // export can never independently drift on whether a commission lookup
  // is normalized (creditsDetailed used to skip this and silently fall
  // through to 0% whenever a commission was saved under a variant name
  // different from what tx.airline normalizes to, overstating what's owed
  // to the airline on both the on-screen detailed list and the export).
  const normalizedCommissions = useMemo(() => {
    const map: Record<string, number> = {};
    Object.entries(commissions).forEach(([k, v]) => { map[normalizeAirlineName(k)] = v; });
    return map;
  }, [commissions]);

  const creditSummary = useMemo(() => {
    const summary: Record<string, number> = {};
    credits.forEach(tx => {
      // tx.airline is already normalized when mapped from Supabase above,
      // but also normalize commission keys so a commission saved under the
      // short form still matches.
      const airline = normalizeAirlineName(tx.airline) || 'Unknown';
      const commRate = tx.commissionRate ?? normalizedCommissions[airline] ?? 0;
      const weOwe = roundMoney(tx.amount * (1 - commRate / 100));
      summary[airline] = (summary[airline] || 0) + weOwe;
    });
    return Object.entries(summary).map(([airline, amount]) => ({ airline, amount })).sort((a, b) => b.amount - a.amount);
  }, [credits, normalizedCommissions]);

  const totalCredit = creditSummary.reduce((acc, c) => acc + c.amount, 0);

  // Precomputed once here instead of inline inside the JSX map below --
  // the PDF export needs the exact same commRate/weOwe numbers the on-screen
  // list shows, so both read from this single source instead of a third
  // copy of the same calc silently drifting from the other two.
  const creditsDetailed = useMemo(() => {
    return credits.map(tx => {
      const normalizedAirline = normalizeAirlineName(tx.airline);
      const commRate = tx.commissionRate ?? normalizedCommissions[normalizedAirline] ?? 0;
      const commissionAmount = roundMoney(tx.amount * commRate / 100);
      const weOwe = roundMoney(tx.amount * (1 - commRate / 100));
      return { airline: tx.airline || 'Unknown', id: tx.id, baseAmount: tx.amount, commRate, commissionAmount, weOwe, detail: tx.detail };
    });
  }, [credits, normalizedCommissions]);

  const handleDownloadPDF = () => {
    const generatedAt = new Date().toLocaleString('en-GB');
    if (activeTab === 'debts') {
      import('./CreditDebitPDF').then(({ downloadDebtsLedgerPDF }) => {
        downloadDebtsLedgerPDF({
          hubName: user.hub || 'EHI Hub',
          generatedBy: user.name,
          generatedAt,
          debtSummary,
          debts: debts.map(t => ({ name: t.name, detail: t.detail, balance: debtBalance(t), id: t.id, time: t.time })),
          totalDebt,
        });
      });
    } else {
      import('./CreditDebitPDF').then(({ downloadCreditsLedgerPDF }) => {
        downloadCreditsLedgerPDF({
          hubName: user.hub || 'EHI Hub',
          generatedBy: user.name,
          generatedAt,
          creditSummary,
          credits: creditsDetailed,
          totalCredit,
        });
      });
    }
  };

  return (
    <main className="flex-1 flex flex-col h-full bg-[var(--color-bg)] overflow-hidden">
      {/* Header */}
      <div className="bg-[var(--color-surface-card)] border-b border-[var(--color-border)] p-4 flex flex-col">
        {onBack && <BackButton onClick={onBack} label="Back to Menu" className="mb-3" />}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[rgba(245,158,11,0.1)] rounded-lg">
            <CreditCard size={20} strokeWidth={1.5} className="text-[var(--color-accent-amber)]" />
          </div>
          <div>
            <h1 className="text-[16px] font-bold font-sans text-[var(--color-foreground)] tracking-tight">Credit & Debit</h1>
            <p className="text-[11px] font-mono text-[var(--color-muted)] mt-0.5">Ledger for current period</p>
          </div>
        </div>

        <div className="flex bg-[var(--color-obsidian)] border border-[var(--color-border)] p-1 rounded-lg mt-5 mb-2 w-full">
          <button
            onClick={() => setActiveTab('debts')}
            className={`flex-1 py-2.5 text-[11px] font-bold font-mono uppercase tracking-wider rounded transition-all flex items-center justify-center gap-2 ${
              activeTab === 'debts' ? 'bg-[var(--color-surface-2)] text-[var(--color-accent-amber)] shadow-sm border border-[rgba(245,158,11,0.2)]' : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
            }`}
          >
            <ArrowDownLeft size={14} strokeWidth={2} /> Receivables
          </button>
          <button
            onClick={() => setActiveTab('credits')}
            className={`flex-1 py-2.5 text-[11px] font-bold font-mono uppercase tracking-wider rounded transition-all flex items-center justify-center gap-2 ${
              activeTab === 'credits' ? 'bg-[var(--color-surface-2)] text-[var(--color-success)] shadow-sm border border-[rgba(16,185,129,0.2)]' : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
            }`}
          >
            <ArrowUpRight size={14} strokeWidth={2} /> Payables
          </button>
        </div>

        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" size={14} strokeWidth={1.5} />
            <input
              type="text"
              placeholder={activeTab === 'debts' ? 'Search debtors...' : 'Search airlines...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg pl-9 pr-3 py-2 text-[13px] font-sans text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
            />
          </div>
          <button
            onClick={handleDownloadPDF}
            title="Download PDF"
            aria-label="Download PDF"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:border-[var(--color-accent-amber)] hover:text-[var(--color-accent-amber)] text-[var(--color-muted)] transition-colors"
          >
            <FileDown size={15} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-[var(--color-muted)] gap-2">
            <Loader size={16} className="animate-spin" />
            <span className="text-[12px] font-mono">Loading ledger...</span>
          </div>
        ) : fetchError ? (
          <EmptyState
            icon={<CreditCard size={36} strokeWidth={1.5} />}
            title="Couldn't load the ledger"
            subtext="Check your connection and try again."
            actions={[{ label: 'Retry', onClick: retryFetch }]}
          />
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
                  {debtSummary.length === 0 && <div className="text-[12px] font-mono text-[var(--color-muted)] text-center py-4 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg">No debts found.</div>}
                  {debtSummary.map((d, i) => (
                    <div key={i} className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg p-4 flex justify-between items-center hover:border-[var(--color-surface-2)] transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-[var(--color-surface-2)] rounded flex items-center justify-center text-[var(--color-muted)]">
                          <UserSquare2 size={16} />
                        </div>
                        <div className="font-sans font-bold text-[14px] text-[var(--color-foreground)]">{d.name}</div>
                      </div>
                      <div className="font-mono text-[14px] font-bold text-[var(--color-accent-amber)] tracking-tight">{fmt(d.amount)}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 space-y-3">
                  <h3 className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">Detailed Ledger</h3>
                  {debts.map((tx, i) => (
                    <div key={i} className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-surface-2)] transition-colors">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[14px] font-sans font-bold text-[var(--color-foreground)]">{tx.name}</span>
                        <span className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">{fmt(debtBalance(tx))}</span>
                      </div>
                      <div className="text-[12px] font-sans text-[var(--color-muted)] mb-3">{tx.detail}</div>
                      <div className="flex justify-between pt-3 border-t border-[var(--color-border)] text-[10px] font-mono text-[var(--color-muted)] uppercase">
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
              <div className="absolute -top-6 -right-6 opacity-5 text-[var(--color-success)]">
                <TrendingUp size={120} />
              </div>
              <div className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-2 relative z-10 flex items-center gap-2">
                <ArrowUpRight size={14} className="text-[var(--color-success)]" /> Total Due to Airlines
              </div>
              <div className="text-[32px] font-sans font-bold text-[var(--color-success)] relative z-10">{fmt(totalCredit)}</div>
              <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mt-1 relative z-10">Last 30 days</div>
            </div>

            <div className="space-y-3">
              <h3 className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">Airlines Breakdown</h3>
              {creditSummary.length === 0 && <div className="text-[12px] font-mono text-[var(--color-muted)] text-center py-4 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg">No credits found.</div>}
              {creditSummary.map((c, i) => (
                <div key={i} className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg p-4 flex justify-between items-center hover:border-[var(--color-surface-2)] transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-[var(--color-surface-2)] rounded flex items-center justify-center text-[var(--color-muted)]">
                      <Building size={16} />
                    </div>
                    <div className="font-sans font-bold text-[14px] text-[var(--color-foreground)]">{c.airline}</div>
                  </div>
                  <div className="font-mono text-[14px] font-bold text-[var(--color-success)] tracking-tight">{fmt(c.amount)}</div>
                </div>
              ))}
            </div>

            <div className="mt-8 space-y-3">
              <h3 className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider pl-1">Detailed Remittances</h3>
              {creditsDetailed.map((c, i) => (
                <div key={i} className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-surface-2)] transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[14px] font-sans font-bold text-[var(--color-foreground)]">{c.airline} <span className="opacity-50 text-[11px] font-mono ml-1">({c.id})</span></span>
                    <span className="text-[13px] font-mono font-bold text-[var(--color-success)]">{fmt(c.weOwe)}</span>
                  </div>
                  <div className="text-[11px] font-mono text-[var(--color-muted)] mb-3 bg-[var(--color-surface-2)] inline-block px-2 py-1 rounded">
                    Base: {fmt(c.baseAmount)} <span className="mx-1 opacity-50">&middot;</span> Comm: {c.commRate}% <span className="text-[var(--color-accent-amber)]">({fmt(c.commissionAmount)})</span>
                  </div>
                  <div className="text-[12px] font-sans text-[var(--color-muted)] line-clamp-1 pt-1">
                    {c.detail}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </>
      )}
      </div>
    </main>
  );
};
