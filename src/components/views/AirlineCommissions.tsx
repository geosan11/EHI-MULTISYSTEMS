import { useState, useEffect, useRef } from 'react';
import { Percent, Save, Building2, Plus, Trash2, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useConfirm } from '../../lib/ConfirmContext';
import { AIRLINES_CACHE_KEY } from '../../lib/airlines';
import { Button, PageHeader, Spinner } from '../ui';

const DEFAULT_COMMISSIONS: Record<string, string> = {
  'Arik Air':              '7',
  'Green Africa Airways':  '6',
  'United Nigeria Airlines': '6',
};

export const AirlineCommissions = ({ onBack }: { onBack: () => void }) => {
  const [commissions, setCommissions] = useState<Record<string, string>>(DEFAULT_COMMISSIONS);
  const [newAirline, setNewAirline] = useState('');
  const [newCommission, setNewCommission] = useState('5');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  // True only when we actually loaded real server/cached data. If the
  // fetch fails AND there's no local cache either, `commissions` is left
  // holding the hardcoded DEFAULT_COMMISSIONS -- saving in that state would
  // silently overwrite every hub's real configured rates with those
  // defaults. Block Save until we know what we're saving is real.
  const [loadedReal, setLoadedReal] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();

  // Snapshot of the airline key-set as last known from the server (or, if
  // unreachable at load, from cache) -- used by persist()'s concurrent-edit
  // check below. Deliberately NOT derived from `commissions` at save time:
  // that state also holds whatever the user just added/removed locally, so
  // comparing the live server keys against it would flag every ordinary
  // add/delete as a "changed on another device" conflict, since the new
  // key is by definition not on the server yet. Comparing against this
  // load-time snapshot instead only fires when something *else* actually
  // changed the server row since this screen opened.
  const loadedKeysRef = useRef<string[]>([]);

  useEffect(() => {
    const fetchCommissions = async () => {
      try {
        const { data, error } = await supabase.from('pricing_config')
          .select('config_value')
          .eq('config_key', 'airline_commissions')
          .single();

        if (data?.config_value && !error) {
          const parsed: Record<string, number> = data.config_value as any;
          const asStr: Record<string, string> = {};
          Object.entries(parsed).forEach(([k, v]) => { asStr[k] = String(v); });
          setCommissions(asStr);
          setLoadedReal(true);
          loadedKeysRef.current = Object.keys(parsed);
          localStorage.setItem(AIRLINES_CACHE_KEY, JSON.stringify(parsed));
        } else {
          setUsingFallback(true);
          const cached = localStorage.getItem(AIRLINES_CACHE_KEY);
          if (cached) {
            const parsed = JSON.parse(cached);
            const asStr: Record<string, string> = {};
            Object.entries(parsed).forEach(([k, v]) => { asStr[k] = String(v); });
            setCommissions(asStr);
            setLoadedReal(true);
            loadedKeysRef.current = Object.keys(parsed);
          }
        }
      } catch (err) {
        setUsingFallback(true);
        const cached = localStorage.getItem(AIRLINES_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          const asStr: Record<string, string> = {};
          Object.entries(parsed).forEach(([k, v]) => { asStr[k] = String(v); });
          setCommissions(asStr);
          setLoadedReal(true);
          loadedKeysRef.current = Object.keys(parsed);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchCommissions();
  }, []);

  const persist = async (data: Record<string, string>): Promise<string | null> => {
    const numData: Record<string, number> = {};
    Object.entries(data).forEach(([k, v]) => { numData[k] = parseFloat(v) || 0; });

    // Re-fetch the current server value immediately before writing and warn
    // if it changed since this screen loaded -- config_value is a single
    // JSON blob, so two devices editing concurrently would otherwise have
    // the second Save silently overwrite the first's changes wholesale
    // (e.g. device A adds a new airline, device B -- still holding its
    // older snapshot -- saves and wipes A's addition). This can't fully
    // prevent the race without moving to per-row storage, but it stops the
    // most common case: saving stale data over someone else's newer edit.
    //
    // Compared against loadedKeysRef (the key-set from when this screen
    // last synced with the server), NOT against `data`/`numData` -- those
    // already include whatever the user just added or removed locally, so
    // comparing live server keys to them would flag every ordinary
    // add/delete as a false "changed on another device" conflict (the new
    // airline is, by definition, never on the server yet). That false
    // positive used to fire on every single add, and clicking the
    // seemingly-safe "Cancel" on it silently discarded the addition with
    // no error shown -- e.g. adding "Aero Contractors" here appeared to
    // work but never actually reached the server, so it never showed up
    // in Cargo/Hub Cargo Rates (which read this same config row).
    const { data: latest } = await supabase.from('pricing_config')
      .select('config_value')
      .eq('config_key', 'airline_commissions')
      .single();
    if (latest?.config_value) {
      const serverKeys = JSON.stringify(Object.keys(latest.config_value as object).sort());
      const loadedKeys = JSON.stringify([...loadedKeysRef.current].sort());
      if (serverKeys !== loadedKeys && !(await confirm({
        title: 'Overwrite newer changes?',
        message: 'Commission rates were changed on another device since this screen loaded (the airline list differs). Saving now will overwrite those changes with what you see here. Continue?',
        confirmLabel: 'Overwrite',
        tone: 'danger',
      }))) {
        return 'cancelled';
      }
    }

    localStorage.setItem(AIRLINES_CACHE_KEY, JSON.stringify(numData));
    const { error } = await supabase.from('pricing_config').upsert({
      config_key: 'airline_commissions',
      config_value: numData,
      description: 'Airline commission percentages',
    }, { onConflict: 'config_key' });
    if (!error) loadedKeysRef.current = Object.keys(numData);
    return error ? error.message : null;
  };

  const handleChange = (airline: string, value: string) => {
    setCommissions(prev => ({ ...prev, [airline]: value }));
  };

  const handleAddAirline = () => {
    if (!newAirline.trim()) return;
    const updated = { ...commissions, [newAirline.trim()]: newCommission };
    setCommissions(updated);
    setNewAirline('');
    setNewCommission('5');
  };

  const handleDeleteAirline = (airline: string) => {
    const updated = { ...commissions };
    delete updated[airline];
    setCommissions(updated);
  };

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!loadedReal) {
      showToast({ message: 'Rates failed to load from the server -- close and reopen this screen to retry before saving, to avoid overwriting real data with defaults.', type: 'error' });
      return;
    }
    setSaving(true);
    const errorMsg = await persist(commissions);
    setSaving(false);
    if (errorMsg === 'cancelled') return;
    if (errorMsg) {
      showToast({ message: `Failed to save commission rates: ${errorMsg}`, type: 'error' });
      return;
    }
    setSaved(true);
    setTimeout(() => { setSaved(false); onBack(); }, 800);
  };

  return (
    <main className="flex flex-col h-full bg-[var(--color-canvas)] overflow-y-auto">
      <PageHeader
        title="Airline Commissions"
        subtitle="Synced across all devices"
        onBack={onBack}
        actions={
          <Button
            variant="secondary"
            size="sm"
            iconLeft={saved ? Check : Save}
            onClick={handleSave}
            disabled={saved}
            loading={saving}
            loadingLabel="Saving…"
          >
            {saved ? 'Saved' : 'Save'}
          </Button>
        }
      />

      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        {usingFallback && !loading && (
          <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded-xl p-3">
            <p className="text-[11px] text-[var(--color-error-fg)] font-sans leading-relaxed">
              Showing cached commission rates — could not reach the server. Changes will not save until connection is restored.
            </p>
          </div>
        )}
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            {/* Info banner */}
            <div className="bg-[var(--color-info-bg)] border border-[var(--color-info-border)] rounded-xl p-3">
              <p className="text-[11px] text-[var(--color-accent-cobalt)] font-sans leading-relaxed">
                Commissions are applied when generating reports and airline billing statements. Changes save to the database and take effect on all devices immediately.
              </p>
            </div>

            {/* Add new airline */}
            <div className="ehi-card p-4 space-y-3">
              <div className="text-[11px] font-bold text-[var(--color-muted)] uppercase tracking-widest">Add Airline</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Airline name"
                  value={newAirline}
                  onChange={(e) => setNewAirline(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddAirline()}
                  className="flex-1 ehi-input"
                />
                <div className="relative w-24">
                  <input
                    type="number"
                    value={newCommission}
                    onChange={(e) => setNewCommission(e.target.value)}
                    className="w-full ehi-input text-right pr-7"
                    step="0.5" min="0" max="100"
                  />
                  <Percent size={11} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none" />
                </div>
                <button
                  onClick={handleAddAirline}
                  disabled={!newAirline.trim()}
                  aria-label="Add airline"
                  className="px-3 h-10 bg-[var(--color-accent-amber)] text-[var(--color-on-accent)] rounded-lg font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>

            {/* Commission list */}
            <div className="space-y-2">
              {Object.entries(commissions).map(([airline, rate]) => (
                <div key={airline} className="ehi-card p-3.5 flex items-center gap-3">
                  <button
                    onClick={() => handleDeleteAirline(airline)}
                    aria-label={`Delete ${airline} commission rate`}
                    className="p-1.5 bg-[var(--color-error-bg)] hover:bg-[var(--color-error-border)] rounded-lg text-[var(--color-error-fg)] transition-colors shrink-0"
                  >
                    <Trash2 size={13} strokeWidth={1.5} />
                  </button>
                  <div className="w-8 h-8 bg-[var(--color-surface-2)] rounded-lg flex items-center justify-center shrink-0">
                    <Building2 size={15} strokeWidth={1.5} className="text-[var(--color-muted)]" />
                  </div>
                  <span className="flex-1 font-sans font-semibold text-[13px] text-[var(--color-foreground)]">{airline}</span>
                  <div className="relative w-24 shrink-0">
                    <input
                      type="number"
                      value={rate}
                      onChange={(e) => handleChange(airline, e.target.value)}
                      className="w-full ehi-input text-right pr-7 font-mono"
                      step="0.5" min="0" max="100"
                    />
                    <Percent size={11} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none" />
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="primary"
              size="lg"
              fullWidth
              iconLeft={saved ? Check : Save}
              onClick={handleSave}
              disabled={saved}
              loading={saving}
              loadingLabel="Saving…"
            >
              {saved ? 'Saved to all devices' : 'Save Commission Rates'}
            </Button>
          </>
        )}
      </div>
    </main>
  );
};
