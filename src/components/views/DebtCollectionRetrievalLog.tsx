import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Transaction } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { fetchAllDebtAndRetrievalEntries, buildShadowRowExclusionCounts, extractPaymentHistoryEvents, PaymentHistoryEvent } from '../../lib/debt';
import { HandCoins, PackageCheck, Search, X, Calendar } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { PageHeader, Tabs } from '../ui';

// A debt collection is a PAYMENT against a sale already recorded once via
// its own original entry, not a second sale -- this view exists precisely
// so staff/accountants see that payment as its own clean line instead of a
// second, confusingly sale-shaped row sitting in the main ledger (which is
// how it used to work: clearing a debt inserted a real "DC-..." row into
// the same department table as the original sale). Nothing here creates or
// modifies any record -- it's a read-only summary drawn straight from data
// that's already persisted on the original entries: payment_history (one
// element per payment, already timestamped/mode-tagged) and the
// retrieved_* columns (cumulative, since there's no structured per-event
// retrieval history yet -- see src/lib/debt.ts's own comment).

const isToday = (iso: string | undefined | null): boolean => {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

// Pieces/kg for a collection's row text -- cargo/baggage/package carry them
// as top-level Transaction fields (baggage's `kg` is excess kg, already
// mapped that way at the fetch layer); marketing never populates pieces/kg
// at all (its "quantity" is a BB/MB/SB bag-size breakdown instead), so it
// falls back to the source entry's own detail string, which already
// carries that breakdown.
const quantitySummary = (source: Transaction | undefined): string => {
  if (!source) return '';
  if (source.type === 'marketing') return source.detail || '';
  const pieces = source.pieces;
  const kg = source.kg;
  if (pieces == null && kg == null) return '';
  return `${pieces ?? 0} pcs / ${kg ?? 0} kg`;
};

type Tab = 'Collections' | 'Retrievals';

export const DebtCollectionRetrievalLog = ({ transactions, onBack }: { transactions: Transaction[]; onBack: () => void }) => {
  const [tab, setTab] = useState<Tab>('Collections');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<PaymentHistoryEvent | null>(null);
  const [selectedRetrieval, setSelectedRetrieval] = useState<Transaction | null>(null);

  // This is a history log by definition -- a debt logged months ago but
  // paid off today still needs to show up here, so it can't rely on the
  // `transactions` prop alone (EHIApp.tsx windows that to a recent date
  // range). Mirrors DebtorsTab.tsx's own dedicated fetch for the same
  // reason; merged below with the prop wins on id-collision (session-fresh
  // edits) the same way DebtorsTab merges its own fetch.
  const [fetchedEntries, setFetchedEntries] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetchAllDebtAndRetrievalEntries()
      .then(entries => { if (active) setFetchedEntries(entries); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedEvent && !selectedRetrieval) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSelectedEvent(null);
      setSelectedRetrieval(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedEvent, selectedRetrieval]);

  const mergedEntries = useMemo(() => {
    const byId = new Map<string, Transaction>();
    fetchedEntries.forEach(t => byId.set(t.id, t));
    transactions.forEach(t => byId.set(t.id, t));
    return Array.from(byId.values());
  }, [fetchedEntries, transactions]);

  const entriesById = useMemo(() => {
    const map = new Map<string, Transaction>();
    mergedEntries.forEach(t => map.set(t.id, t));
    return map;
  }, [mergedEntries]);

  const collectionEvents = useMemo(() => {
    const exclusionCounts = buildShadowRowExclusionCounts(mergedEntries);
    return extractPaymentHistoryEvents(mergedEntries, exclusionCounts)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [mergedEntries]);

  const retrievals = useMemo(() => {
    return mergedEntries
      .filter(t => t.retrieved === true || ((t.raw as any)?.retrieved_amount || 0) > 0)
      .sort((a, b) => new Date(b.retrievedAt || 0).getTime() - new Date(a.retrievedAt || 0).getTime());
  }, [mergedEntries]);

  const filteredCollectionEvents = useMemo(() => {
    if (!searchTerm.trim()) return collectionEvents;
    const q = searchTerm.toLowerCase();
    return collectionEvents.filter(e =>
      e.sourceTxName.toLowerCase().includes(q) ||
      e.sourceDetail?.toLowerCase().includes(q) ||
      e.by?.toLowerCase().includes(q) ||
      e.mode?.toLowerCase().includes(q)
    );
  }, [collectionEvents, searchTerm]);

  const filteredRetrievals = useMemo(() => {
    if (!searchTerm.trim()) return retrievals;
    const q = searchTerm.toLowerCase();
    return retrievals.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.detail?.toLowerCase().includes(q) ||
      t.retrievedBy?.toLowerCase().includes(q)
    );
  }, [retrievals, searchTerm]);

  const totalCollectedToday = useMemo(
    () => collectionEvents.filter(e => isToday(e.at)).reduce((s, e) => s + e.amount, 0),
    [collectionEvents]
  );
  const totalRetrievedToday = useMemo(
    () => retrievals.filter(t => isToday(t.retrievedAt)).reduce((s, t) => s + ((t.raw as any)?.retrieved_amount || 0), 0),
    [retrievals]
  );

  return (
    <div className="animate-in fade-in">
      <div className="ehi-page-body px-4 pt-4 space-y-4">
        <PageHeader title="Collections & Retrievals" subtitle="Debt collection & retrieval log" onBack={onBack} sticky={false} />

        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl px-3 py-2.5 border bg-[var(--color-success-bg)] border-[var(--color-success-border)]">
            <div className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-muted)]">Collected Today</div>
            <div className="text-[15px] font-mono font-bold text-[var(--color-success)]">₦{fmt(totalCollectedToday)}</div>
          </div>
          <div className="rounded-xl px-3 py-2.5 border bg-[var(--color-amber-bg)] border-[var(--color-amber-border)]">
            <div className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-muted)]">Retrieved Today</div>
            <div className="text-[15px] font-mono font-bold text-[var(--color-accent-amber)]">₦{fmt(totalRetrievedToday)}</div>
          </div>
        </div>

        <Tabs
          variant="pill"
          value={tab}
          onChange={(id) => setTab(id as Tab)}
          className="gap-1"
          items={[
            { id: 'Collections', label: 'Collections' },
            { id: 'Retrievals', label: 'Retrievals' },
          ]}
        />

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            type="text"
            placeholder={tab === 'Collections' ? 'Search customer, mode, collected by...' : 'Search customer, retrieved by...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-11 pl-9 pr-3 ehi-card text-[12px] font-mono text-[var(--color-input-text)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
          />
        </div>

        {/* List */}
        <div className="flex flex-col gap-2 pb-24">
          {loading ? (
            <div className="text-center py-10 text-[var(--color-muted)] font-mono text-[11px]">Loading records...</div>
          ) : tab === 'Collections' ? (
            filteredCollectionEvents.length === 0 ? (
              <EmptyState icon={<HandCoins size={36} strokeWidth={1.5} />} message="No debt collections recorded." />
            ) : (
              filteredCollectionEvents.map((e, idx) => {
                const source = entriesById.get(e.sourceTxId);
                const qty = quantitySummary(source);
                return (
                  <div
                    key={`${e.sourceTxId}-${e.at}-${idx}`}
                    onClick={() => setSelectedEvent(e)}
                    className="ehi-card p-3 flex items-center justify-between cursor-pointer hover:border-[var(--color-muted)] transition-colors group"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2 bg-[var(--color-info-bg)] rounded-lg text-[var(--color-accent-cobalt)] shrink-0">
                        <HandCoins size={18} />
                      </div>
                      <div className="min-w-0 flex flex-col items-start gap-1">
                        <div className="text-[12px] font-bold text-[var(--color-foreground)] font-mono">
                          Debt collection — {e.sourceTxName}
                        </div>
                        <div className="text-[10px] text-[var(--color-light-muted)]">
                          {qty ? `${qty} · ` : ''}{e.sourceDetail}
                        </div>
                        <div className="text-[9px] font-mono text-[var(--color-muted)] flex items-center gap-1.5 mt-0.5">
                          <Calendar size={10} /> {formatDateTime(e.at)} · {e.by}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[13px] font-mono font-bold text-[var(--color-success)]">₦{fmt(e.amount)}</span>
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold font-mono bg-[var(--color-info-bg)] text-[var(--color-accent-cobalt)] border border-[var(--color-info-border)]">
                        {e.mode?.toUpperCase()}
                      </span>
                    </div>
                  </div>
                );
              })
            )
          ) : filteredRetrievals.length === 0 ? (
            <EmptyState icon={<PackageCheck size={36} strokeWidth={1.5} />} message="No retrievals recorded." />
          ) : (
            filteredRetrievals.map(t => {
              const raw = t.raw as any;
              const fullyRetrieved = t.retrieved === true;
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedRetrieval(t)}
                  className="ehi-card p-3 flex items-center justify-between cursor-pointer hover:border-[var(--color-muted)] transition-colors group"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 bg-[var(--color-amber-bg)] rounded-lg text-[var(--color-accent-amber)] shrink-0">
                      <PackageCheck size={18} />
                    </div>
                    <div className="min-w-0 flex flex-col items-start gap-1">
                      <div className="text-[12px] font-bold text-[var(--color-foreground)] font-mono">
                        {t.name}
                      </div>
                      <div className="text-[10px] text-[var(--color-light-muted)]">
                        {raw?.retrieved_pieces || 0} pcs / {raw?.retrieved_kg || 0} kg of {t.pieces ?? '?'} pcs / {t.kg ?? '?'} kg
                      </div>
                      <div className="text-[9px] font-mono text-[var(--color-muted)] flex items-center gap-1.5 mt-0.5">
                        <Calendar size={10} /> {t.retrievedAt ? formatDateTime(t.retrievedAt) : '—'} · {t.retrievedBy || 'Unknown'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[13px] font-mono font-bold text-[var(--color-foreground)]">₦{fmt(raw?.retrieved_amount || 0)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold font-mono border ${fullyRetrieved ? 'bg-[var(--color-error-bg)] text-[var(--color-error)] border-[var(--color-error-border)]' : 'bg-[var(--color-amber-bg)] text-[var(--color-accent-amber)] border-[var(--color-amber-border)]'}`}>
                      {fullyRetrieved ? 'FULL' : 'PARTIAL'}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Collection detail panel */}
      {selectedEvent && createPortal(
        <div className="fixed inset-0 z-[60] ehi-scrim flex flex-col items-center justify-start p-4 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) { setSelectedEvent(null); setSelectedRetrieval(null); } }}>
          <div className="w-full max-w-lg bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-strong)] relative flex flex-col overflow-hidden mb-10 shadow-[var(--shadow-modal)]">
            <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] flex justify-between items-center sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <HandCoins size={18} className="text-[var(--color-accent-cobalt)]" />
                <h3 className="text-[12px] font-bold text-[var(--color-foreground)] uppercase font-mono">Debt Collection</h3>
              </div>
              <button onClick={() => setSelectedEvent(null)} aria-label="Close" className="p-1.5 bg-[var(--color-surface-2)] rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-muted)] cursor-pointer transition-colors border-none">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div className="bg-[var(--color-surface-2)] rounded-lg p-3 border border-[var(--color-border)] border-l-2 border-l-[var(--color-accent-cobalt)]">
                <div className="text-[10px] text-[var(--color-muted)] font-mono uppercase mb-1">Customer</div>
                <div className="text-[15px] font-bold font-mono text-[var(--color-foreground)] mb-3">{selectedEvent.sourceTxName}</div>
                <div className="text-[10px] text-[var(--color-muted)] font-mono uppercase mb-1">Sale</div>
                <div className="text-[12px] text-[var(--color-light-muted)]">{selectedEvent.sourceDetail}</div>
              </div>
              <div className="bg-[var(--color-surface-2)] p-3 rounded-lg flex flex-col gap-3 text-[11px]">
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Amount Collected:</span><span className="font-bold text-[var(--color-success)]">₦{fmt(selectedEvent.amount)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Payment Mode:</span><span className="font-bold text-[var(--color-foreground)]">{selectedEvent.mode}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Collected By:</span><span className="font-bold text-[var(--color-foreground)]">{selectedEvent.by}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Date / Time:</span><span className="font-bold text-[var(--color-foreground)]">{formatDateTime(selectedEvent.at)}</span></div>
                {selectedEvent.sourceHub && (
                  <div className="flex justify-between"><span className="text-[var(--color-muted)]">Hub:</span><span className="font-bold text-[var(--color-foreground)]">{selectedEvent.sourceHub}</span></div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Retrieval detail panel */}
      {selectedRetrieval && createPortal(
        <div className="fixed inset-0 z-[60] ehi-scrim flex flex-col items-center justify-start p-4 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) { setSelectedEvent(null); setSelectedRetrieval(null); } }}>
          <div className="w-full max-w-lg bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-strong)] relative flex flex-col overflow-hidden mb-10 shadow-[var(--shadow-modal)]">
            <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] flex justify-between items-center sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <PackageCheck size={18} className="text-[var(--color-accent-amber)]" />
                <h3 className="text-[12px] font-bold text-[var(--color-foreground)] uppercase font-mono">Retrieval</h3>
              </div>
              <button onClick={() => setSelectedRetrieval(null)} aria-label="Close" className="p-1.5 bg-[var(--color-surface-2)] rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-muted)] cursor-pointer transition-colors border-none">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div className="bg-[var(--color-surface-2)] rounded-lg p-3 border border-[var(--color-border)] border-l-2 border-l-[var(--color-accent-amber)]">
                <div className="text-[10px] text-[var(--color-muted)] font-mono uppercase mb-1">Customer</div>
                <div className="text-[15px] font-bold font-mono text-[var(--color-foreground)] mb-3">{selectedRetrieval.name}</div>
                <div className="text-[10px] text-[var(--color-muted)] font-mono uppercase mb-1">Sale</div>
                <div className="text-[12px] text-[var(--color-light-muted)]">{selectedRetrieval.detail}</div>
              </div>
              <div className="bg-[var(--color-surface-2)] p-3 rounded-lg flex flex-col gap-3 text-[11px]">
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Retrieved Value:</span><span className="font-bold text-[var(--color-foreground)]">₦{fmt((selectedRetrieval.raw as any)?.retrieved_amount || 0)} of ₦{fmt(selectedRetrieval.amount)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Balance Remaining:</span><span className="font-bold text-[var(--color-accent-amber)]">₦{fmt(selectedRetrieval.amount - ((selectedRetrieval.raw as any)?.retrieved_amount || 0))}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Retrieved Qty:</span><span className="font-bold text-[var(--color-foreground)]">{(selectedRetrieval.raw as any)?.retrieved_pieces || 0} pcs / {(selectedRetrieval.raw as any)?.retrieved_kg || 0} kg</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Original Qty:</span><span className="font-bold text-[var(--color-foreground)]">{selectedRetrieval.pieces ?? '—'} pcs / {selectedRetrieval.kg ?? '—'} kg</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Retrieved By:</span><span className="font-bold text-[var(--color-foreground)]">{selectedRetrieval.retrievedBy || 'Unknown'}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Date / Time:</span><span className="font-bold text-[var(--color-foreground)]">{selectedRetrieval.retrievedAt ? formatDateTime(selectedRetrieval.retrievedAt) : '—'}</span></div>
                {selectedRetrieval.hub && (
                  <div className="flex justify-between"><span className="text-[var(--color-muted)]">Hub:</span><span className="font-bold text-[var(--color-foreground)]">{selectedRetrieval.hub}</span></div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
