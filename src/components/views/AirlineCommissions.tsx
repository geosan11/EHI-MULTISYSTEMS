import { useState, useEffect } from 'react';
import { ArrowLeft, Percent, Save, Building2, Plus, Trash2, Loader, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';

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

  useEffect(() => {
    supabase.from('pricing_config')
      .select('config_value')
      .eq('config_key', 'airline_commissions')
      .single()
      .then(({ data }) => {
        if (data?.config_value) {
          const parsed: Record<string, number> = data.config_value as any;
          const asStr: Record<string, string> = {};
          Object.entries(parsed).forEach(([k, v]) => { asStr[k] = String(v); });
          setCommissions(asStr);
          localStorage.setItem('ehi_airline_commissions', JSON.stringify(parsed));
        } else {
          const cached = localStorage.getItem('ehi_airline_commissions');
          if (cached) {
            const parsed = JSON.parse(cached);
            const asStr: Record<string, string> = {};
            Object.entries(parsed).forEach(([k, v]) => { asStr[k] = String(v); });
            setCommissions(asStr);
          }
        }
        setLoading(false);
      }).catch(() => {
        const cached = localStorage.getItem('ehi_airline_commissions');
        if (cached) {
          const parsed = JSON.parse(cached);
          const asStr: Record<string, string> = {};
          Object.entries(parsed).forEach(([k, v]) => { asStr[k] = String(v); });
          setCommissions(asStr);
        }
        setLoading(false);
      });
  }, []);

  const persist = async (data: Record<string, string>) => {
    const numData: Record<string, number> = {};
    Object.entries(data).forEach(([k, v]) => { numData[k] = parseFloat(v) || 0; });
    localStorage.setItem('ehi_airline_commissions', JSON.stringify(numData));
    await supabase.from('pricing_config').upsert({
      config_key: 'airline_commissions',
      config_value: numData,
      description: 'Airline commission percentages',
    }, { onConflict: 'config_key' });
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

  const handleSave = async () => {
    await persist(commissions);
    setSaved(true);
    setTimeout(() => { setSaved(false); onBack(); }, 800);
  };

  return (
    <main className="flex flex-col h-full bg-[var(--color-obsidian)] overflow-y-auto">
      {/* Header */}
      <div className="ehi-view-header">
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-surface-2)] transition-colors group">
          <ArrowLeft size={16} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
        </button>
        <div className="text-center">
          <div className="text-[12px] font-bold text-[var(--color-foreground)]">Airline Commissions</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Synced across all devices</div>
        </div>
        <button
          onClick={handleSave}
          disabled={saved}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.3)] text-[var(--color-accent-amber)] text-[11px] font-bold rounded-lg hover:bg-[rgba(245,158,11,0.2)] transition-colors disabled:opacity-60"
        >
          {saved ? <><Check size={12} /> Saved</> : <><Save size={12} /> Save</>}
        </button>
      </div>

      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader size={20} className="animate-spin text-[var(--color-accent-amber)]" />
          </div>
        ) : (
          <>
            {/* Info banner */}
            <div className="bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] rounded-xl p-3">
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
                  className="px-3 h-10 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
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
                    className="p-1.5 bg-[rgba(239,68,68,0.08)] hover:bg-[rgba(239,68,68,0.18)] rounded-lg text-[var(--color-error)] transition-colors shrink-0"
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

            <button
              onClick={handleSave}
              className="w-full h-12 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] font-bold text-[13px] rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              {saved ? <><Check size={16} /> Saved to all devices</> : <><Save size={16} /> Save Commission Rates</>}
            </button>
          </>
        )}
      </div>
    </main>
  );
};
