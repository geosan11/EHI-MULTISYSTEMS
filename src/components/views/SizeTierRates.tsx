import { useState, useEffect } from 'react';
import { Loader, PackageSearch } from 'lucide-react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { BackButton } from '../BackButton';
import { useToast } from '../../lib/ToastContext';
import { KgTierEditor, KgTier } from '../KgTierEditor';
import { useAirlines } from '../../lib/airlines';
import { useHubRoutes, useValidatedRouteSelection } from '../../lib/hubRoutes';

interface RateRow { id: string; min_inches: number; max_inches: number | null; flat_amount: number; }

// Mirrors FlatTierRates.tsx exactly, keyed on screen-size inches instead of
// weight in kg (e.g. "Plasma TV" priced by screen-size bracket).
export const SizeTierRates = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const { showToast } = useToast();
  const isUnrestricted = ['super_admin', 'admin'].includes(user.role);
  const airlines = useAirlines({ includeOther: false });
  const routes = useHubRoutes();

  const [contentTypes, setContentTypes] = useState<{ id: string; name: string }[]>([]);
  const [hubs, setHubs] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContentTypeId, setSelectedContentTypeId] = useState('');
  const [selectedAirline, setSelectedAirline] = useState('');
  // size_tier_rates requires a specific hub_id/route_name (NOT NULL) -- there
  // is no company-wide/all-routes bracket, so these must always resolve to a
  // real value, never a sentinel. Restricted users are pinned to their own
  // hub; unrestricted users default to the first loaded hub below.
  const [selectedRoute, setSelectedRoute] = useState('');
  const [selectedHubId, setSelectedHubId] = useState<string>(isUnrestricted ? '' : (user.hub_id || ''));
  const [rows, setRows] = useState<RateRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('content_types').select('id, name').eq('is_size_tier', true).eq('active', true).order('name'),
      supabase.from('hubs').select('id, name').eq('active', true).order('name'),
    ]).then(([ct, hb]) => {
      const cts = ct.data || [];
      const hbs = hb.data || [];
      setContentTypes(cts);
      setHubs(hbs);
      if (cts.length > 0) setSelectedContentTypeId(cts[0].id);
      if (isUnrestricted && hbs.length > 0) setSelectedHubId(prev => prev || hbs[0].id);
      setLoading(false);
    });
  }, [isUnrestricted]);

  useEffect(() => { if (airlines.length && !selectedAirline) setSelectedAirline(airlines[0]); }, [airlines]);
  useEffect(() => { if (routes.length && !selectedRoute) setSelectedRoute(routes[0]); }, [routes]);
  // useHubRoutes() paints from a cached/bundled list before the live fetch
  // resolves -- if that first-seeded route was since renamed/deactivated,
  // this snaps the selection to the live list once it arrives (same
  // pattern CargoForm/PackageForm/ExcessBaggageForm/PricingConfiguration
  // already use for their own route pickers).
  useValidatedRouteSelection(routes, selectedRoute, setSelectedRoute);

  const fetchRows = async () => {
    if (!selectedContentTypeId || !selectedAirline || !selectedHubId || !selectedRoute) { setRows([]); return; }
    setRowsLoading(true);
    const { data, error } = await supabase.from('size_tier_rates')
      .select('id, min_inches, max_inches, flat_amount')
      .eq('content_type_id', selectedContentTypeId)
      .eq('airline', selectedAirline)
      .eq('hub_id', selectedHubId)
      .eq('route_name', selectedRoute)
      .order('min_inches');
    if (error) showToast({ message: `Failed to load: ${error.message}`, type: 'error' });
    else setRows((data || []) as RateRow[]);
    setRowsLoading(false);
  };
  useEffect(() => { fetchRows(); }, [selectedContentTypeId, selectedAirline, selectedRoute, selectedHubId]);

  const handleAdd = async ({ min_kg, max_kg, price }: { min_kg: number; max_kg: number | null; price: number }) => {
    const { error } = await supabase.from('size_tier_rates').insert({
      hub_id: selectedHubId,
      content_type_id: selectedContentTypeId,
      airline: selectedAirline,
      route_name: selectedRoute,
      min_inches: min_kg,
      max_inches: max_kg,
      flat_amount: price,
      updated_by: user.name,
    });
    if (error) { showToast({ message: `Failed to add: ${error.message}`, type: 'error' }); return; }
    fetchRows();
  };
  const handleUpdateField = async (id: string, field: 'min_kg' | 'max_kg' | 'price', value: number | null) => {
    const prev = rows;
    const column = field === 'price' ? 'flat_amount' : field === 'min_kg' ? 'min_inches' : 'max_inches';
    setRows(cur => cur.map(r => r.id === id ? { ...r, [column]: value } as RateRow : r));
    const { error } = await supabase.from('size_tier_rates').update({ [column]: value, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { setRows(prev); showToast({ message: `Failed to save: ${error.message}`, type: 'error' }); }
  };
  const handleDelete = async (id: string) => {
    const prev = rows;
    setRows(cur => cur.filter(r => r.id !== id));
    const { error } = await supabase.from('size_tier_rates').delete().eq('id', id);
    if (error) { setRows(prev); showToast({ message: `Failed to remove: ${error.message}`, type: 'error' }); return; }
    showToast({ message: 'Bracket removed', type: 'success' });
  };

  const tiers: KgTier[] = rows.map(r => ({ id: r.id, min_kg: r.min_inches, max_kg: r.max_inches, price: r.flat_amount }));
  const selCls = "w-full h-10 px-2 text-[12px] font-mono rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)]";

  return (
    <main className="flex flex-col h-full bg-[var(--color-obsidian)] overflow-y-auto">
      <div className="ehi-view-header">
        <BackButton onClick={onBack} />
        <div className="text-center">
          <div className="text-[12px] font-bold text-[var(--color-foreground)]">Size Tier Rates</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Flat price per screen-size bracket (e.g. Plasma TV)</div>
        </div>
        <div className="w-8" />
      </div>
      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        <div className="bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] rounded-xl p-3">
          <p className="text-[11px] text-[var(--color-accent-cobalt)] leading-relaxed">
            Flat screen-size-bracket pricing for content types flagged "size tier" in Content Types. The matching
            bracket's amount is the whole price — it overrides the per-kg route rate and any minimum charge.
            Set brackets per airline + route + hub.
          </p>
        </div>
        {loading ? (
          <div className="flex justify-center py-12"><Loader size={20} className="animate-spin text-[var(--color-accent-amber)]" /></div>
        ) : contentTypes.length === 0 ? (
          <div className="ehi-card p-6 text-center space-y-2">
            <PackageSearch size={24} className="mx-auto text-[var(--color-muted)]" />
            <div className="text-[12px] text-[var(--color-muted)]">No content types are flagged as size tier yet. Flag one from Content Types first.</div>
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
                {routes.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={selectedHubId} onChange={e => setSelectedHubId(e.target.value)} disabled={!isUnrestricted} className={selCls}>
                {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            {rowsLoading ? (
              <div className="flex justify-center py-8"><Loader size={16} className="animate-spin text-[var(--color-muted)]" /></div>
            ) : (
              <KgTierEditor tiers={tiers} priceLabel="Flat Amount" priceUnit="₦" itemLabel="bracket" unitLabel="IN"
                onAdd={handleAdd} onUpdateField={handleUpdateField} onDelete={handleDelete} />
            )}
          </>
        )}
      </div>
    </main>
  );
};
