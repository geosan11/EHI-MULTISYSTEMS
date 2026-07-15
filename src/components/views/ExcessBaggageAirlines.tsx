import { useState, useEffect } from 'react';
import { Plane, Plus, Trash2, Loader, Power } from 'lucide-react';
import { BackButton } from '../BackButton';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useConfirm } from '../../lib/ConfirmContext';
import { ExcessBaggageAirline } from '../../lib/types';

export const ExcessBaggageAirlines = ({ onBack }: { onBack: () => void }) => {
  const [airlines, setAirlines] = useState<ExcessBaggageAirline[]>([]);
  const [loading, setLoading] = useState(true);

  const [newName, setNewName] = useState('');
  const [newFlightPrefix, setNewFlightPrefix] = useState('');
  const [newTagCode, setNewTagCode] = useState('');
  const [newFreeKg, setNewFreeKg] = useState('23');
  const [newRatePerKg, setNewRatePerKg] = useState('1000');
  const [adding, setAdding] = useState(false);

  const { showToast } = useToast();
  const confirm = useConfirm();

  const fetchAirlines = async () => {
    const { data, error } = await supabase
      .from('excess_baggage_airlines')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) {
      showToast({ message: `Failed to load excess baggage airlines: ${error.message}`, type: 'error' });
    } else {
      setAirlines(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchAirlines(); }, []);

  const handleAdd = async () => {
    if (!newName.trim() || !newFlightPrefix.trim() || !newTagCode.trim()) return;
    setAdding(true);
    const { data, error } = await supabase.from('excess_baggage_airlines').insert({
      name: newName.trim(),
      flight_prefix: newFlightPrefix.trim().toUpperCase(),
      tag_code: newTagCode.trim().toUpperCase(),
      free_allowance_kg: parseFloat(newFreeKg) || 0,
      rate_per_kg: parseFloat(newRatePerKg) || 0,
    }).select().single();
    setAdding(false);
    if (error) {
      showToast({ message: `Failed to add ${newName}: ${error.message}`, type: 'error' });
      return;
    }
    setAirlines(prev => [...prev, data]);
    setNewName('');
    setNewFlightPrefix('');
    setNewTagCode('');
    setNewFreeKg('23');
    setNewRatePerKg('1000');
  };

  // Optimistic field update -- rolls back on failure so the screen never
  // shows a value that isn't actually saved (same pattern as
  // PricingConfiguration.tsx's handleUpdateStandardRate).
  const handleFieldChange = async (id: string, field: keyof ExcessBaggageAirline, value: string | number | boolean) => {
    const prev = airlines;
    setAirlines(cur => cur.map(a => a.id === id ? { ...a, [field]: value } : a));
    const { error } = await supabase.from('excess_baggage_airlines').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) {
      setAirlines(prev);
      showToast({ message: `Failed to save change: ${error.message}`, type: 'error' });
    }
  };

  const handleDelete = async (airline: ExcessBaggageAirline) => {
    const ok = await confirm({
      title: 'Remove airline?',
      message: `Remove ${airline.name} from excess-baggage ticketing? Its existing tickets are kept, but staff can no longer create new ones for it.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    const { error } = await supabase.from('excess_baggage_airlines').delete().eq('id', airline.id);
    if (error) {
      showToast({ message: `Failed to remove ${airline.name}: ${error.message}`, type: 'error' });
      return;
    }
    setAirlines(prev => prev.filter(a => a.id !== airline.id));
    showToast({ message: `${airline.name} removed`, type: 'success' });
  };

  return (
    <main className="flex flex-col h-full bg-[var(--color-obsidian)] overflow-y-auto">
      <div className="ehi-view-header">
        <BackButton onClick={onBack} />
        <div className="text-center">
          <div className="text-[12px] font-bold text-[var(--color-foreground)]">Excess Baggage Airlines</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Synced across all devices</div>
        </div>
        <div className="w-8" />
      </div>

      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        <div className="bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] rounded-xl p-3">
          <p className="text-[11px] text-[var(--color-accent-cobalt)] font-sans leading-relaxed">
            Every active airline here gets its own ticketing tab automatically -- no app update needed.
            Flight Prefix is shown before the flight number on the ticketing form (e.g. "VK"). Tag Code
            is the short code used in that airline's AWB ticket numbers (e.g. "VJ") -- pick something
            distinct per airline since it also namespaces the ticket counter.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader size={20} className="animate-spin text-[var(--color-accent-amber)]" />
          </div>
        ) : (
          <>
            <div className="ehi-card p-4 space-y-3">
              <div className="text-[11px] font-bold text-[var(--color-muted)] uppercase tracking-widest">Add Airline</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Airline name (e.g. Aero Contractors)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="col-span-2 ehi-input"
                />
                <input
                  type="text"
                  placeholder="Flight prefix (e.g. P4)"
                  value={newFlightPrefix}
                  onChange={(e) => setNewFlightPrefix(e.target.value)}
                  maxLength={4}
                  className="ehi-input uppercase"
                />
                <input
                  type="text"
                  placeholder="Tag code (e.g. AC)"
                  value={newTagCode}
                  onChange={(e) => setNewTagCode(e.target.value)}
                  maxLength={6}
                  className="ehi-input uppercase"
                />
                <div>
                  <label htmlFor="new-free-kg" className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">FREE ALLOWANCE (KG)</label>
                  <input
                    id="new-free-kg"
                    type="number"
                    value={newFreeKg}
                    onChange={(e) => setNewFreeKg(e.target.value)}
                    className="w-full ehi-input"
                  />
                </div>
                <div>
                  <label htmlFor="new-rate-kg" className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">RATE (₦/KG)</label>
                  <input
                    id="new-rate-kg"
                    type="number"
                    value={newRatePerKg}
                    onChange={(e) => setNewRatePerKg(e.target.value)}
                    className="w-full ehi-input"
                  />
                </div>
              </div>
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || !newFlightPrefix.trim() || !newTagCode.trim() || adding}
                className="w-full h-10 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg text-[12px] font-bold disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Plus size={14} /> {adding ? 'Adding...' : 'Add Airline'}
              </button>
            </div>

            <div className="space-y-2">
              {airlines.map(a => (
                <div key={a.id} className="ehi-card p-3.5 space-y-2.5">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleDelete(a)}
                      aria-label={`Remove ${a.name}`}
                      className="p-1.5 bg-[rgba(239,68,68,0.08)] hover:bg-[rgba(239,68,68,0.18)] rounded-lg text-[var(--color-error)] transition-colors shrink-0"
                    >
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                    <div className="w-8 h-8 bg-[var(--color-surface-2)] rounded-lg flex items-center justify-center shrink-0">
                      <Plane size={15} strokeWidth={1.5} className="text-[var(--color-muted)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-sans font-semibold text-[13px] text-[var(--color-foreground)] truncate">{a.name}</div>
                      <div className="text-[10px] font-mono text-[var(--color-muted)]">Prefix {a.flight_prefix} · Tag {a.tag_code}</div>
                    </div>
                    <button
                      onClick={() => handleFieldChange(a.id, 'active', !a.active)}
                      aria-label={a.active ? `Deactivate ${a.name}` : `Activate ${a.name}`}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 transition-colors ${
                        a.active
                          ? 'bg-[rgba(34,197,94,0.1)] text-[var(--color-success)]'
                          : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'
                      }`}
                    >
                      <Power size={11} /> {a.active ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                  {/* defaultValue+onBlur (uncontrolled), not value+onChange -- the
                      previous version parsed to a number and wrote it back as
                      the controlled value on every keystroke, so typing a
                      decimal point immediately vanished (parseFloat("12.") is
                      12, same as before the "."), silently turning e.g. "12.5"
                      into "125" the moment the next digit landed. This also
                      dropped a live Supabase write per keystroke instead of
                      once on blur. */}
                  <div className="grid grid-cols-2 gap-2 pl-11">
                    <div>
                      <label htmlFor={`free-${a.id}`} className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">FREE ALLOWANCE (KG)</label>
                      <input
                        id={`free-${a.id}`}
                        type="number"
                        defaultValue={a.free_allowance_kg}
                        key={`free-${a.id}-${a.free_allowance_kg}`}
                        onBlur={(e) => e.target.value && handleFieldChange(a.id, 'free_allowance_kg', parseFloat(e.target.value) || 0)}
                        className="w-full ehi-input font-mono"
                      />
                    </div>
                    <div>
                      <label htmlFor={`rate-${a.id}`} className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">RATE (₦/KG)</label>
                      <input
                        id={`rate-${a.id}`}
                        type="number"
                        defaultValue={a.rate_per_kg}
                        key={`rate-${a.id}-${a.rate_per_kg}`}
                        onBlur={(e) => e.target.value && handleFieldChange(a.id, 'rate_per_kg', parseFloat(e.target.value) || 0)}
                        className="w-full ehi-input font-mono"
                      />
                    </div>
                  </div>
                </div>
              ))}
              {airlines.length === 0 && (
                <div className="text-[12px] text-[var(--color-muted)] italic text-center py-8">
                  No excess-baggage airlines configured yet.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
};
