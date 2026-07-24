import { useState, useEffect } from 'react';
import { Loader, PackageSearch } from 'lucide-react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { BackButton } from '../BackButton';
import { useToast } from '../../lib/ToastContext';
import { KgTierEditor, KgTier } from '../KgTierEditor';
import { useAirlines } from '../../lib/airlines';
import { useHubRoutes } from '../../lib/hubRoutes';

const ALL_HUBS = '__all_hubs__';
const ALL_ROUTES = '__all_routes__';

interface RateRow { id: string; min_kg: number; max_kg: number | null; flat_amount: number; }

export const FlatTierRates = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const { showToast } = useToast();
  const isUnrestricted = ['super_admin', 'admin'].includes(user.role);
  const airlines = useAirlines({ includeOther: false });
  const routes = useHubRoutes();

  const [contentTypes, setContentTypes] = useState<{ id: string; name: string }[]>([]);
  const [hubs, setHubs] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContentTypeId, setSelectedContentTypeId] = useState('');
  const [selectedAirline, setSelectedAirline] = useState('');
  const [selectedRoute, setSelectedRoute] = useState(ALL_ROUTES);
  const [selectedHubId, setSelectedHubId] = useState<string>(isUnrestricted ? ALL_HUBS : (user.hub_id || ALL_HUBS));
  const [rows, setRows] = useState<RateRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('content_types').select('id, name').eq('is_flat_tier', true).eq('active', true).order('name'),
      supabase.from('hubs').select('id, name').eq('active', true).order('name'),
    ]).then(([ct, hb]) => {
      const cts = ct.data || [];
      setContentTypes(cts);
      setHubs(hb.data || []);
      if (cts.length > 0) setSelectedContentTypeId(cts[0].id);
      setLoading(false);
    });
  }, []);

  useEffect(() => { if (airlines.length && !selectedAirline) setSelectedAirline(airlines[0]); }, [airlines]);

  const fetchRows = async () => {
    if (!selectedContentTypeId || !selectedAirline) { setRows([]); return; }
    setRowsLoading(true);
    let query = supabase.from('flat_tier_rates')
      .select('id, min_kg, max_kg, flat_amount')
      .eq('content_type_id', selectedContentTypeId)
      .eq('airline', selectedAirline);
    query = selectedHubId === ALL_HUBS ? query.is('hub_id', null) : query.eq('hub_id', selectedHubId);
    query = selectedRoute === ALL_ROUTES ? query.is('route_name', null) : query.eq('route_name', selectedRoute);
    const { data, error } = await query.order('min_kg');
    if (error) showToast({ message: `Failed to load: ${error.message}`, type: 'error' });
    else setRows((data || []) as RateRow[]);
    setRowsLoading(false);
  };
  useEffect(() => { fetchRows(); }, [selectedContentTypeId, selectedAirline, selectedRoute, selectedHubId]);

  const handleAdd = async ({ min_kg, max_kg, price }: { min_kg: number; max_kg: number | null; price: number }) => {
    const { error } = await supabase.from('flat_tier_rates').insert({
      hub_id: selectedHubId === ALL_HUBS ? null : selectedHubId,
      content_type_id: selectedContentTypeId,
      airline: selectedAirline,
      route_name: selectedRoute === ALL_ROUTES ? null : selectedRoute,
      min_kg,
      max_kg,
      flat_amount: price,
      updated_by: user.name,
    });
    if (error) { showToast({ message: `Failed to add: ${error.message}`, type: 'error' }); return; }
    fetchRows();
  };
  const handleUpdateField = async (id: string, field: 'min_kg' | 'max_kg' | 'price', value: number | null) => {
    const prev = rows;
    const column = field === 'price' ? 'flat_amount' : field;
    setRows(cur => cur.map(r => r.id === id ? { ...r, [column]: value } as RateRow : r));
    const { error } = await supabase.from('flat_tier_rates').update({ [column]: value, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { setRows(prev); showToast({ message: `Failed to save: ${error.message}`, type: 'error' }); }
  };
  const handleDelete = async (id: string) => {
    const prev = rows;
    setRows(cur => cur.filter(r => r.id !== id));
    const { error } = await supabase.from('flat_tier_rates').delete().eq('id', id);
    if (error) { setRows(prev); showToast({ message: `Failed to remove: ${error.message}`, type: 'error' }); return; }
    showToast({ message: 'Bracket removed', type: 'success' });
  };

  const tiers: KgTier[] = rows.map(r => ({ id: r.id, min_kg: r.min_kg, max_kg: r.max_kg, price: r.flat_amount }));
  const selCls = "w-full h-10 px-2 text-[12px] font-mono rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)]";

  return (
    <main className="flex flex-col h-full bg-[var(--color-obsidian)] overflow-y-auto">
      <div className="ehi-view-header">
        <BackButton onClick={onBack} />
        <div className="text-center">
          <div className="text-[12px] font-bold text-[var(--color-foreground)]">Flat Tier Rates</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Bumper &amp; Burnet · flat price per weight bracket</div>
        </div>
        <div className="w-8" />
      </div>
      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        <div className="bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] rounded-xl p-3">
          <p className="text-[11px] text-[var(--color-accent-cobalt)] leading-relaxed">
            Flat weight-bracket pricing for content types flagged "flat tier" in Content Types. The matching
            bracket's amount is the whole price — it overrides the per-kg route rate and any minimum charge.
            Set brackets per airline + route + hub, or use All Hubs / All Routes defaults.
          </p>
        </div>
        {loading ? (
          <div className="flex justify-center py-12"><Loader size={20} className="animate-spin text-[var(--color-accent-amber)]" /></div>
        ) : contentTypes.length === 0 ? (
          <div className="ehi-card p-6 text-center space-y-2">
            <PackageSearch size={24} className="mx-auto text-[var(--color-muted)]" />
            <div className="text-[12px] text-[var(--color-muted)]">No content types are flagged as flat tier yet. Flag one from Content Types first.</div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <select value={selectedContentTypeId} onChange={e => setSelectedContentTypeId(e.target.value)} className={selCls}>
                {contentTypes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={selectedAirline} onChange={e => setSelectedAirline(e.target.value)} className={selCls}>
                {airlines.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <select value={selectedRoute} onChange={e => setSelectedRoute(e.target.value)} className={selCls}>
                <option value={ALL_ROUTES}>All Routes (Default)</option>
                {routes.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={selectedHubId} onChange={e => setSelectedHubId(e.target.value)} disabled={!isUnrestricted} className={selCls}>
                <option value={ALL_HUBS}>All Hubs (Default)</option>
                {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            {rowsLoading ? (
              <div className="flex justify-center py-8"><Loader size={16} className="animate-spin text-[var(--color-muted)]" /></div>
            ) : (
              <KgTierEditor tiers={tiers} priceLabel="Flat Amount" priceUnit="₦" itemLabel="bracket"
                onAdd={handleAdd} onUpdateField={handleUpdateField} onDelete={handleDelete} />
            )}
          </>
        )}
      </div>
    </main>
  );
};
