import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  Plus,
  TrendingUp,
  TrendingDown,
  CreditCard,
  RefreshCw,
  FileSpreadsheet,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { User } from '../../lib/types';
import { listAirlineLogos } from '../../lib/airlineLogos';
import { fmt } from '../../lib/helpers';
import { useToast } from '../../lib/ToastContext';

const FALLBACK_AIRLINES = [
  'Arik Air',
  'Green Africa Airways',
  'United Nigeria Airlines',
  'ValueJet',
  'Aero Contractors',
  'Dana Air',
];

type EntryType = 'Credit' | 'Debit' | 'Cheque Raise';

interface LedgerEntry {
  id: string;
  airline: string;
  entry_type: EntryType;
  amount: number;
  description: string;
  reference: string | null;
  entry_date: string;
  hub_id: string | null;
  hub: string | null;
  entered_by: string;
  created_at: string;
  runningBalance?: number;
}

interface LedgerRow extends LedgerEntry {
  runningBalance: number;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: '2-digit' });
  } catch {
    return iso;
  }
}

function buildRunningLedger(entries: LedgerEntry[]): LedgerRow[] {
  let balance = 0;
  return entries.map((e) => {
    if (e.entry_type === 'Credit') {
      balance += e.amount;
    } else {
      balance -= e.amount;
    }
    return { ...e, runningBalance: balance };
  });
}

interface BalanceSummary {
  credits: number;
  debits: number;
  cheques: number;
  net: number;
}

function computeSummary(rows: LedgerRow[]): BalanceSummary {
  let credits = 0;
  let debits = 0;
  let cheques = 0;
  rows.forEach((r) => {
    if (r.entry_type === 'Credit') credits += r.amount;
    else if (r.entry_type === 'Debit') debits += r.amount;
    else if (r.entry_type === 'Cheque Raise') cheques += r.amount;
  });
  return { credits, debits, cheques, net: credits - debits - cheques };
}

export const AirlineLedger = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const { showToast } = useToast();
  const [airlines, setAirlines] = useState<string[]>(FALLBACK_AIRLINES);
  const [selectedAirline, setSelectedAirline] = useState<string>(FALLBACK_AIRLINES[0]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const [entryDate, setEntryDate] = useState(todayISO());
  const [entryType, setEntryType] = useState<EntryType>('Credit');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');

  const [airlineBalances, setAirlineBalances] = useState<Record<string, number>>({});

  useEffect(() => {
    listAirlineLogos().then((logos) => {
      if (logos.length > 0) {
        const names = logos.map((l) => l.name);
        setAirlines(names);
        setSelectedAirline(names[0]);
      }
    });
  }, []);

  // loadEntries is triggered both by the selectedAirline-change effect below
  // AND imperatively (the Refresh button, and handleSubmit's post-save
  // reload) -- a generation counter covers both call shapes, so fast
  // tab-switching between airlines can't let an older, slower fetch land
  // after a newer one and show one airline's entries under another's tab.
  const loadEntriesGenRef = useRef(0);
  const loadEntries = async (airline: string) => {
    const myGen = ++loadEntriesGenRef.current;
    setLoading(true);
    const { data } = await supabase
      .from('airline_ledger_entries')
      .select('*')
      .eq('airline', airline)
      .order('entry_date', { ascending: true })
      .order('created_at', { ascending: true });
    if (loadEntriesGenRef.current !== myGen) return;
    setEntries((data as LedgerEntry[]) || []);
    setLoading(false);
  };

  const loadAllBalances = async (airlineList: string[]) => {
    const results: Record<string, number> = {};
    await Promise.all(
      airlineList.map(async (airline) => {
        const { data } = await supabase
          .from('airline_ledger_entries')
          .select('entry_type, amount')
          .eq('airline', airline);
        if (data && data.length > 0) {
          let bal = 0;
          (data as { entry_type: EntryType; amount: number }[]).forEach((e) => {
            if (e.entry_type === 'Credit') bal += e.amount;
            else bal -= e.amount;
          });
          results[airline] = bal;
        } else {
          results[airline] = 0;
        }
      })
    );
    setAirlineBalances(results);
  };

  useEffect(() => {
    if (airlines.length > 0) {
      loadAllBalances(airlines);
    }
  }, [airlines]);

  useEffect(() => {
    loadEntries(selectedAirline);
  }, [selectedAirline]);

  const rows: LedgerRow[] = useMemo(() => buildRunningLedger(entries), [entries]);
  const summary = useMemo(() => computeSummary(rows), [rows]);

  const handleSelectAirline = (airline: string) => {
    setSelectedAirline(airline);
    setFormOpen(false);
  };

  const handleSubmit = async () => {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0 || !description.trim()) return;
    setSubmitting(true);
    // Result was previously discarded entirely -- a failed insert (RLS
    // rejection, network blip) left staff believing a credit/debit/cheque
    // had been recorded against this airline when it hadn't, silently
    // corrupting the reconciliation. Now checked, and the form is kept
    // open with its values intact on failure so the entry isn't lost.
    const { error } = await supabase.from('airline_ledger_entries').insert({
      airline: selectedAirline,
      entry_type: entryType,
      amount: parsed,
      description: description.trim(),
      reference: reference.trim() || null,
      entry_date: entryDate,
      hub_id: user.hub_id || null,
      hub: user.hub,
      entered_by: user.name,
    });
    setSubmitting(false);
    if (error) {
      showToast({ message: `Failed to record entry: ${error.message}`, type: 'error' });
      return;
    }
    setAmount('');
    setDescription('');
    setReference('');
    setEntryDate(todayISO());
    setEntryType('Credit');
    setFormOpen(false);
    await loadEntries(selectedAirline);
    await loadAllBalances(airlines);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <button
          onClick={onBack}
          aria-label="Back"
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-surface-2)] transition-colors group shrink-0"
        >
          <ArrowLeft
            size={16}
            strokeWidth={1.5}
            className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors"
          />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-[var(--color-foreground)] truncate">
            Airline Balance Ledger
          </div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">
            {selectedAirline}
          </div>
        </div>
        <button
          onClick={() => loadEntries(selectedAirline)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-surface-2)] transition-colors group shrink-0"
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw
            size={14}
            strokeWidth={1.5}
            className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors"
          />
        </button>
      </div>

      <div className="ehi-mobile-only-flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] overflow-x-auto no-scrollbar shrink-0">
        {airlines.map((airline) => {
          const bal = airlineBalances[airline] ?? 0;
          const isActive = airline === selectedAirline;
          return (
            <button
              key={airline}
              onClick={() => handleSelectAirline(airline)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-full border text-[10px] font-sans whitespace-nowrap transition-colors shrink-0 ${
                isActive
                  ? 'bg-[rgba(16,185,129,0.15)] border-[var(--color-success)] text-[var(--color-success)]'
                  : 'bg-[var(--color-surface-1)] border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-success)] hover:text-[var(--color-success)]'
              }`}
            >
              <span className="font-semibold">{airline.split(' ')[0]}</span>
              <span
                className={`font-mono text-[9px] ${
                  bal >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
                }`}
              >
                {bal >= 0 ? '+' : ''}{fmt(bal)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="ehi-desktop-only-flex flex-col w-[200px] shrink-0 border-r border-[var(--color-border)] overflow-y-auto">
          <div className="px-3 pt-3 pb-1">
            <span className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest">Airlines</span>
          </div>
          <div className="flex flex-col gap-1 px-2 pb-3">
            {airlines.map((airline) => {
              const bal = airlineBalances[airline] ?? 0;
              const isActive = airline === selectedAirline;
              return (
                <button
                  key={airline}
                  onClick={() => handleSelectAirline(airline)}
                  className={`flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    isActive
                      ? 'bg-[rgba(16,185,129,0.12)] border border-[rgba(16,185,129,0.3)] text-[var(--color-success)]'
                      : 'border border-transparent text-[var(--color-muted)] hover:bg-[var(--color-surface-1)] hover:text-[var(--color-foreground)]'
                  }`}
                >
                  <span className="text-[11px] font-sans font-semibold leading-tight">{airline}</span>
                  <span
                    className={`font-mono text-[10px] ${
                      bal >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
                    }`}
                  >
                    {bal >= 0 ? '+' : ''}{fmt(bal)}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-bold font-sans text-[var(--color-foreground)]">
                {selectedAirline}
              </span>
              <button
                onClick={() => setFormOpen((v) => !v)}
                className="ehi-mobile-only-flex items-center gap-1.5 px-3 py-1.5 bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.3)] text-[var(--color-success)] text-[11px] font-bold rounded-lg hover:bg-[rgba(16,185,129,0.2)] transition-colors"
              >
                <Plus size={12} />
                Add Entry
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.2)] text-[var(--color-success)] text-[10px] font-mono">
                <TrendingUp size={11} />
                <span>Credits: <strong>{fmt(summary.credits)}</strong></span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)] text-[var(--color-error)] text-[10px] font-mono">
                <TrendingDown size={11} />
                <span>Debits: <strong>{fmt(summary.debits)}</strong></span>
              </div>
              {summary.cheques > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.2)] text-[var(--color-accent-amber)] text-[10px] font-mono">
                  <CreditCard size={11} />
                  <span>Cheques: <strong>{fmt(summary.cheques)}</strong></span>
                </div>
              )}
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${
                  summary.net >= 0
                    ? 'bg-[rgba(16,185,129,0.12)] border-[rgba(16,185,129,0.3)] text-[var(--color-success)]'
                    : 'bg-[rgba(239,68,68,0.12)] border-[rgba(239,68,68,0.3)] text-[var(--color-error)]'
                }`}
              >
                Net: {summary.net >= 0 ? '+' : ''}{fmt(summary.net)}
              </div>
            </div>
          </div>

          {formOpen && (
            <div className="ehi-mobile-only border-b border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-4 shrink-0">
              <EntryForm
                idPrefix="mobile-entry"
                entryDate={entryDate}
                entryType={entryType}
                amount={amount}
                description={description}
                reference={reference}
                submitting={submitting}
                onDateChange={setEntryDate}
                onTypeChange={setEntryType}
                onAmountChange={setAmount}
                onDescriptionChange={setDescription}
                onReferenceChange={setReference}
                onSubmit={handleSubmit}
              />
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw
                  size={20}
                  className="animate-spin text-[var(--color-accent-amber)]"
                />
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--color-muted)]">
                <FileSpreadsheet size={36} strokeWidth={1} />
                <span className="text-[13px] font-sans">No entries yet for this airline</span>
                <span className="text-[11px] font-mono text-[var(--color-muted)]">
                  Use the form to record the first entry
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-[10px] min-w-[600px]">
                  <thead className="sticky top-0 z-10 bg-[var(--color-surface-1)] border-b border-[var(--color-border)]">
                    <tr className="text-[var(--color-muted)] uppercase tracking-wider text-[9px]">
                      <th className="py-2.5 px-3 font-medium whitespace-nowrap">Date</th>
                      <th className="py-2.5 px-3 font-medium whitespace-nowrap">Reference</th>
                      <th className="py-2.5 px-3 font-medium">Description</th>
                      <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap text-[var(--color-success)]">
                        Credit
                      </th>
                      <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap text-[var(--color-error)]">
                        Debit
                      </th>
                      <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap text-[var(--color-accent-amber)]">
                        Cheque Raise
                      </th>
                      <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">
                        Balance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const isCredit = row.entry_type === 'Credit';
                      const isEven = idx % 2 === 0;
                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-[var(--color-border)] transition-colors ${
                            isEven
                              ? 'bg-[var(--color-obsidian)]'
                              : 'bg-[var(--color-surface-1)]'
                          } hover:bg-[var(--color-surface-2)]`}
                        >
                          <td className="py-2.5 px-3 whitespace-nowrap text-[var(--color-muted)]">
                            {fmtDate(row.entry_date)}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-[var(--color-muted)]">
                            {row.reference || '—'}
                          </td>
                          <td className="py-2.5 px-3 font-sans text-[11px] text-[var(--color-foreground)] max-w-[200px] truncate">
                            {row.description}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap text-[var(--color-success)]">
                            {isCredit ? fmt(row.amount) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap text-[var(--color-error)]">
                            {row.entry_type === 'Debit' ? fmt(row.amount) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap text-[var(--color-accent-amber)]">
                            {row.entry_type === 'Cheque Raise' ? fmt(row.amount) : '—'}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap ${
                              row.runningBalance >= 0
                                ? 'text-[var(--color-success)]'
                                : 'text-[var(--color-error)]'
                            }`}
                          >
                            {row.runningBalance >= 0 ? '' : '-'}{fmt(Math.abs(row.runningBalance))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[var(--color-border)] bg-[var(--color-surface-1)] font-bold">
                      <td
                        colSpan={3}
                        className="py-3 px-3 font-sans text-[11px] text-[var(--color-foreground)] uppercase tracking-wide"
                      >
                        Totals
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-[var(--color-success)] whitespace-nowrap">
                        {fmt(summary.credits)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-[var(--color-error)] whitespace-nowrap">
                        {fmt(summary.debits)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-[var(--color-accent-amber)] whitespace-nowrap">
                        {fmt(summary.cheques)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono whitespace-nowrap ${
                          summary.net >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
                        }`}
                      >
                        {summary.net >= 0 ? '' : '-'}{fmt(Math.abs(summary.net))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </main>

        <aside className="ehi-desktop-only-flex flex-col w-[260px] shrink-0 border-l border-[var(--color-border)] overflow-y-auto">
          <div className="px-4 pt-4 pb-1">
            <span className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest">
              Add Entry
            </span>
          </div>
          <div className="px-4 pb-4">
            <EntryForm
              idPrefix="desktop-entry"
              entryDate={entryDate}
              entryType={entryType}
              amount={amount}
              description={description}
              reference={reference}
              submitting={submitting}
              onDateChange={setEntryDate}
              onTypeChange={setEntryType}
              onAmountChange={setAmount}
              onDescriptionChange={setDescription}
              onReferenceChange={setReference}
              onSubmit={handleSubmit}
            />
          </div>
        </aside>
      </div>
    </div>
  );
};

interface EntryFormProps {
  idPrefix: string;
  entryDate: string;
  entryType: EntryType;
  amount: string;
  description: string;
  reference: string;
  submitting: boolean;
  onDateChange: (v: string) => void;
  onTypeChange: (v: EntryType) => void;
  onAmountChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onReferenceChange: (v: string) => void;
  onSubmit: () => void;
}

const ENTRY_TYPES: EntryType[] = ['Credit', 'Debit', 'Cheque Raise'];

const typeColor: Record<EntryType, string> = {
  Credit: 'bg-[rgba(16,185,129,0.15)] border-[rgba(16,185,129,0.4)] text-[var(--color-success)]',
  Debit: 'bg-[rgba(239,68,68,0.15)] border-[rgba(239,68,68,0.4)] text-[var(--color-error)]',
  'Cheque Raise':
    'bg-[rgba(245,158,11,0.15)] border-[rgba(245,158,11,0.4)] text-[var(--color-accent-amber)]',
};

const typeInactive =
  'bg-transparent border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-foreground)] hover:text-[var(--color-foreground)]';

function EntryForm({
  idPrefix,
  entryDate,
  entryType,
  amount,
  description,
  reference,
  submitting,
  onDateChange,
  onTypeChange,
  onAmountChange,
  onDescriptionChange,
  onReferenceChange,
  onSubmit,
}: EntryFormProps) {
  const canSubmit = parseFloat(amount) > 0 && description.trim().length > 0 && !submitting;

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-date`} className="text-[10px] font-sans text-[var(--color-muted)]">Date</label>
        <input
          id={`${idPrefix}-date`}
          type="date"
          value={entryDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="h-9 px-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] text-[12px] font-mono focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-sans text-[var(--color-muted)]">Entry Type</label>
        <div className="flex gap-1">
          {ENTRY_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => onTypeChange(t)}
              className={`flex-1 py-1.5 rounded-lg border text-[9px] font-bold font-sans transition-colors ${
                entryType === t ? typeColor[t] : typeInactive
              }`}
            >
              {t === 'Cheque Raise' ? 'Cheque' : t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-amount`} className="text-[10px] font-sans text-[var(--color-muted)]">Amount</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)] text-[12px] font-mono pointer-events-none">
            ₦
          </span>
          <input
            id={`${idPrefix}-amount`}
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            className="w-full h-9 pl-7 pr-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] text-[12px] font-mono focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-description`} className="text-[10px] font-sans text-[var(--color-muted)]">Description</label>
        <input
          id={`${idPrefix}-description`}
          type="text"
          placeholder="e.g. Commission payment"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          className="h-9 px-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] text-[12px] font-sans focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-reference`} className="text-[10px] font-sans text-[var(--color-muted)]">
          Reference <span className="text-[9px]">(optional)</span>
        </label>
        <input
          id={`${idPrefix}-reference`}
          type="text"
          placeholder="e.g. CHQ-0042"
          value={reference}
          onChange={(e) => onReferenceChange(e.target.value)}
          className="h-9 px-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] text-[12px] font-mono focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
        />
      </div>

      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        className="h-10 w-full rounded-lg bg-[var(--color-success)] text-[var(--color-obsidian)] font-bold text-[12px] font-sans flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus size={14} />
        {submitting ? 'Recording…' : 'Record Entry'}
      </button>

      <div className="flex items-start gap-2 pt-1 border-t border-[var(--color-border)] mt-1">
        <FileSpreadsheet size={13} className="text-[var(--color-muted)] mt-0.5 shrink-0" />
        <span className="text-[9px] font-sans text-[var(--color-muted)] leading-relaxed">
          To import historical entries in bulk, use the{' '}
          <span className="text-[var(--color-accent-amber)]">Data Import</span> section in the
          More menu.
        </span>
      </div>
    </div>
  );
}
