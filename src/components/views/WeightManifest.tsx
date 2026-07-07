import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { User } from '../../lib/types';
import { CARGO_ROUTES } from '../../lib/constants';
import { listAirlineLogos } from '../../lib/airlineLogos';
import {
  ArrowLeft,
  CheckCircle,
  Circle,
  Plus,
  Trash2,
  Plane,
  Package,
  Scale,
  RefreshCw,
} from 'lucide-react';

interface WeightManifestEntry {
  id: string;
  manifest_date: string;
  airline: string;
  flight_number: string;
  route: string;
  total_pieces: number;
  total_kg: number;
  verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  hub_id: string | null;
  hub: string | null;
  entered_by: string | null;
  created_at: string;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const WeightManifest = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [selectedDate, setSelectedDate] = useState<string>(todayStr());
  const [entries, setEntries] = useState<WeightManifestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showMobileForm, setShowMobileForm] = useState(false);
  const [toast, setToast] = useState('');
  const [airlineNames, setAirlineNames] = useState<string[]>([]);

  const [airline, setAirline] = useState('');
  const [flightNumber, setFlightNumber] = useState('');
  const [route, setRoute] = useState('');
  const [pieces, setPieces] = useState('');
  const [kg, setKg] = useState('');

  const isAdmin = user.role === 'super_admin' || user.role === 'admin';

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('cargo_weight_manifests')
        .select('*')
        .eq('manifest_date', selectedDate)
        .eq('hub_id', user.hub_id)
        .order('created_at', { ascending: true });
      if (!error && data) setEntries(data as WeightManifestEntry[]);
    } catch {}
    setLoading(false);
  }, [selectedDate, user.hub_id]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  useEffect(() => {
    listAirlineLogos().then(logos => {
      setAirlineNames(logos.map(l => l.name));
    });
  }, []);

  const totalPieces = entries.reduce((s, e) => s + (e.total_pieces || 0), 0);
  const totalKg = entries.reduce((s, e) => s + (e.total_kg || 0), 0);
  const verifiedCount = entries.filter(e => e.verified).length;

  const handleSubmit = async () => {
    if (!airline.trim() || !flightNumber.trim() || !route || !pieces || !kg) {
      showToast('Fill in all fields before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('cargo_weight_manifests').insert({
        manifest_date: selectedDate,
        airline: airline.trim(),
        flight_number: flightNumber.trim(),
        route,
        total_pieces: parseInt(pieces) || 0,
        total_kg: parseFloat(kg) || 0,
        verified: false,
        hub_id: user.hub_id || null,
        hub: user.hub,
        entered_by: user.name,
      });
      if (error) throw error;
      setAirline('');
      setFlightNumber('');
      setRoute('');
      setPieces('');
      setKg('');
      setShowMobileForm(false);
      showToast('Dispatch recorded.');
      await fetchEntries();
    } catch (e: any) {
      showToast('Error: ' + e.message);
    }
    setSubmitting(false);
  };

  const handleVerify = async (entry: WeightManifestEntry) => {
    try {
      const { error } = await supabase.from('cargo_weight_manifests').update({
        verified: true,
        verified_by: user.name,
        verified_at: new Date().toISOString(),
      }).eq('id', entry.id);
      if (error) throw error;
      showToast('Marked as verified.');
      await fetchEntries();
    } catch (e: any) {
      showToast('Error: ' + e.message);
    }
  };

  const handleDelete = async (entry: WeightManifestEntry) => {
    if (!window.confirm(`Delete ${entry.airline} ${entry.flight_number}?`)) return;
    try {
      const { error } = await supabase.from('cargo_weight_manifests').delete().eq('id', entry.id);
      if (error) throw error;
      showToast('Entry deleted.');
      await fetchEntries();
    } catch (e: any) {
      showToast('Error: ' + e.message);
    }
  };

  const EntryForm = () => (
    <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-4 space-y-3 flex-shrink-0" style={{ width: '260px' }}>
      <div className="text-[11px] font-bold text-[var(--color-foreground)] uppercase tracking-widest flex items-center gap-1.5">
        <Plus size={12} className="text-[var(--color-accent-amber)]" />
        Record Dispatch
      </div>

      <div className="space-y-1">
        <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest block">Airline</label>
        <input
          list="airline-datalist"
          value={airline}
          onChange={e => setAirline(e.target.value)}
          placeholder="e.g. Arik Air"
          className="w-full h-8 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
        />
        <datalist id="airline-datalist">
          {airlineNames.map(n => <option key={n} value={n} />)}
        </datalist>
      </div>

      <div className="space-y-1">
        <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest block">Flight Number</label>
        <input
          value={flightNumber}
          onChange={e => setFlightNumber(e.target.value)}
          placeholder="e.g. W3 201"
          className="w-full h-8 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest block">Route</label>
        <select
          value={route}
          onChange={e => setRoute(e.target.value)}
          className="w-full h-8 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
        >
          <option value="">Select route…</option>
          {CARGO_ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest block">Pieces</label>
          <input
            type="number"
            min="0"
            value={pieces}
            onChange={e => setPieces(e.target.value)}
            placeholder="0"
            className="w-full h-8 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest block">KG</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={kg}
            onChange={e => setKg(e.target.value)}
            placeholder="0.0"
            className="w-full h-8 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
          />
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full h-9 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg text-[11px] font-bold uppercase tracking-wider disabled:opacity-40 flex items-center justify-center gap-1.5 transition-opacity"
      >
        {submitting ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
        {submitting ? 'Saving…' : 'Add to Manifest'}
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] overflow-hidden">
      <div className="ehi-view-header">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer border-none bg-transparent text-[11px] font-mono"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● WEIGHT MANIFEST</span>
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="h-7 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
        />
      </div>

      <div className="px-4 pt-3 pb-2 grid grid-cols-2 md:grid-cols-4 gap-2 flex-shrink-0">
        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg px-3 py-2">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Package size={10} className="text-[var(--color-muted)]" />
            <span className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest">Pieces</span>
          </div>
          <div className="text-[18px] font-mono font-bold text-[var(--color-foreground)]">{totalPieces}</div>
        </div>

        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg px-3 py-2">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Scale size={10} className="text-[var(--color-muted)]" />
            <span className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest">Total KG</span>
          </div>
          <div className="text-[18px] font-mono font-bold text-[var(--color-accent-amber)]">{totalKg.toFixed(1)}</div>
        </div>

        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg px-3 py-2">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Plane size={10} className="text-[var(--color-muted)]" />
            <span className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest">Flights</span>
          </div>
          <div className="text-[18px] font-mono font-bold text-[var(--color-foreground)]">{entries.length}</div>
        </div>

        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg px-3 py-2">
          <div className="flex items-center gap-1.5 mb-0.5">
            <CheckCircle size={10} className="text-[var(--color-muted)]" />
            <span className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest">Verified</span>
          </div>
          <div className="text-[18px] font-mono font-bold text-[var(--color-success)]">
            {verifiedCount} / {entries.length}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col md:flex-row gap-0 min-h-0">
        <div className="flex-1 overflow-y-auto px-4 pb-4 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest">
              Dispatches for {selectedDate}
            </div>
            <button
              onClick={fetchEntries}
              className="p-1 rounded hover:bg-[var(--color-surface-2)] transition-colors border-none bg-transparent cursor-pointer"
            >
              <RefreshCw size={12} className={`text-[var(--color-muted)] ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-[var(--color-muted)]">
              <RefreshCw size={18} className="animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 border border-dashed border-[var(--color-border)] rounded-xl opacity-60">
              <Plane size={24} className="text-[var(--color-muted)] mb-2" />
              <div className="text-[12px] font-mono text-[var(--color-muted)]">No dispatches recorded for {selectedDate}</div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
              <table className="w-full text-left border-collapse" style={{ minWidth: '640px' }}>
                <thead>
                  <tr className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
                    {['Airline', 'Flight', 'Route', 'Pieces', 'KG', 'Verified', 'Actions'].map(h => (
                      <th key={h} className="px-3 py-2 text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest font-semibold whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => (
                    <tr
                      key={entry.id}
                      className="border-b border-[var(--color-border)] last:border-0 transition-colors"
                      style={entry.verified ? { backgroundColor: 'rgba(16,185,129,0.04)' } : {}}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Plane size={10} className="text-[var(--color-muted)] flex-shrink-0" />
                          <span className="text-[11px] font-sans text-[var(--color-foreground)] whitespace-nowrap">{entry.airline}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[11px] font-mono text-[var(--color-foreground)] whitespace-nowrap">{entry.flight_number}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] font-mono text-[var(--color-muted)] whitespace-nowrap">{entry.route}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[12px] font-mono font-bold text-[var(--color-foreground)]">{entry.total_pieces}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[12px] font-mono font-bold" style={{ color: 'var(--color-accent-amber)' }}>
                          {(entry.total_kg || 0).toFixed(1)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 min-w-[140px]">
                        {entry.verified ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <CheckCircle size={12} className="text-[var(--color-success)] flex-shrink-0" />
                              <span className="text-[10px] font-mono text-[var(--color-success)]">Verified</span>
                            </div>
                            {entry.verified_by && (
                              <div className="text-[9px] font-mono text-[var(--color-muted)] pl-4">{entry.verified_by}</div>
                            )}
                            {entry.verified_at && (
                              <div className="text-[9px] font-mono text-[var(--color-muted)] pl-4">{fmtTime(entry.verified_at)}</div>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => handleVerify(entry)}
                            className="flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] hover:border-[var(--color-success)] hover:text-[var(--color-success)] text-[var(--color-muted)] transition-colors bg-transparent cursor-pointer"
                          >
                            <Circle size={11} />
                            <span className="text-[10px] font-mono">Mark Verified</span>
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {isAdmin && (
                          <button
                            onClick={() => handleDelete(entry)}
                            className="p-1 rounded hover:bg-[rgba(239,68,68,0.1)] text-[var(--color-muted)] hover:text-[var(--color-error)] transition-colors border-none bg-transparent cursor-pointer"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {entries.length > 0 && (
                  <tfoot>
                    <tr className="bg-[var(--color-surface-2)] border-t border-[var(--color-border)]">
                      <td colSpan={3} className="px-3 py-2 text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest">Totals</td>
                      <td className="px-3 py-2">
                        <span className="text-[12px] font-mono font-bold text-[var(--color-foreground)]">{totalPieces}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[12px] font-mono font-bold" style={{ color: 'var(--color-accent-amber)' }}>
                          {totalKg.toFixed(1)}
                        </span>
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        <div className="hidden md:flex flex-col px-4 pb-4 pt-0 flex-shrink-0">
          <EntryForm />
        </div>
      </div>

      <div className="md:hidden flex-shrink-0">
        {showMobileForm ? (
          <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 pt-4 pb-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[var(--color-foreground)] uppercase tracking-widest">Record Dispatch</span>
              <button
                onClick={() => setShowMobileForm(false)}
                className="text-[10px] font-mono text-[var(--color-muted)] hover:text-[var(--color-foreground)] border-none bg-transparent cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest block">Airline</label>
              <input
                list="airline-datalist-mob"
                value={airline}
                onChange={e => setAirline(e.target.value)}
                placeholder="e.g. Arik Air"
                className="w-full h-9 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
              />
              <datalist id="airline-datalist-mob">
                {airlineNames.map(n => <option key={n} value={n} />)}
              </datalist>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest block">Flight Number</label>
              <input
                value={flightNumber}
                onChange={e => setFlightNumber(e.target.value)}
                placeholder="e.g. W3 201"
                className="w-full h-9 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest block">Route</label>
              <select
                value={route}
                onChange={e => setRoute(e.target.value)}
                className="w-full h-9 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
              >
                <option value="">Select route…</option>
                {CARGO_ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest block">Pieces</label>
                <input
                  type="number"
                  min="0"
                  value={pieces}
                  onChange={e => setPieces(e.target.value)}
                  placeholder="0"
                  className="w-full h-9 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest block">KG</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={kg}
                  onChange={e => setKg(e.target.value)}
                  placeholder="0.0"
                  className="w-full h-9 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                />
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full h-10 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg text-[12px] font-bold uppercase tracking-wider disabled:opacity-40 flex items-center justify-center gap-2 transition-opacity"
            >
              {submitting ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
              {submitting ? 'Saving…' : 'Add to Manifest'}
            </button>
          </div>
        ) : (
          <div className="border-t border-[var(--color-border)] px-4 py-3">
            <button
              onClick={() => setShowMobileForm(true)}
              className="w-full h-10 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg text-[11px] font-mono text-[var(--color-foreground)] flex items-center justify-center gap-2 hover:border-[var(--color-accent-amber)] transition-colors cursor-pointer"
            >
              <Plus size={13} className="text-[var(--color-accent-amber)]" />
              ＋ Add Dispatch
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg px-4 py-2 text-[12px] font-mono text-[var(--color-foreground)] z-50 flex items-center gap-2 shadow-xl">
          <CheckCircle size={12} className="text-[var(--color-success)]" />
          {toast}
        </div>
      )}
    </div>
  );
};
