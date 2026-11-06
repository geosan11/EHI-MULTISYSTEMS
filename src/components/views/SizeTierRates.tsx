import { useState, useEffect } from 'react';
import { PackageSearch } from 'lucide-react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { PageHeader, Spinner } from '../ui';
import { useToast } from '../../lib/ToastContext';
import { KgTierEditor, KgTier } from '../KgTierEditor';
import { useAirlines } from '../../lib/airlines';
import { useHubRoutes, useValidatedRouteSelection } from '../../lib/hubRoutes';
import { syncLagosRates, deleteLagosRateRow, getSelectableHubsForUser, SelectableHub } from '../../lib/lagosHubSync';

interface RateRow { id: string; min_inches: number; max_inches: number | null; flat_amount: number; }

// Mirrors FlatTierRates.tsx exactly, keyed on screen-size inches instead of
// weight in kg (e.g. "Plasma TV" priced by screen-size bracket).
export const SizeTierRates = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const { showToast } = useToast();
  const isUnrestricted = ['super_admin', 'admin'].includes(user.role);
  const isAccountant = user.role === 'accountant';
  const canSelectHub = isUnrestricted || isAccountant;

  const airlines = useAirlines({ includeOther: false });
  const routes = useHubRoutes();

  const [contentTypes, setContentTypes] = useState<{ id: string; name: string }[]>([]);
  const [hubs, setHubs] = useState<SelectableHub[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContentTypeId, setSelectedContentTypeId] = useState('');
  const [selectedAirline, setSelectedAirline] = useState('');
  // size_tier_rates requires a specific hub_id/route_name (NOT NULL) -- there
  // is no company-wide/all-routes bracket, so these must always resolve to a
  // real value, never a sentinel. Restricted users are pinned to their own
  // hub (or sibling hubs for accountants); unrestricted users default to the first loaded hub below.
  const [selectedRoute, setSelectedRoute] = useState('');
  const [selectedHubId, setSelectedHubId] = useState<string>(user.hub_id || '');
  const [rows, setRows] = useState<RateRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('content_types').select('id, name').eq('is_size_tier', true).eq('active', true).order('name'),
      getSelectableHubsForUser(user),
    ]).then(([ct, hb]) => {
      const cts = ct.data || [];
      const hbs = (hb || []) as SelectableHub[];
      setContentTypes(cts);
      setHubs(hbs);
      if (cts.length > 0) setSelectedContentTypeId(cts[0].id);
      if (hbs.length > 0) {
        setSelectedHubId(prev => prev || user.hub_id || hbs[0].id);
      }
      setLoading(false);
    });
  }, [user]);

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
    // Keeps EHI Head Office Lagos and Lagos Air Cargo Station on identical
    // pricing -- HubCargoRates.tsx's equivalent save already does this;
    // sync from edited hub and surface any sibling copy failures.
    const syncRes = await syncLagosRates(selectedHubId);
    if (!syncRes.success) {
      showToast({ message: `Bracket added, but sibling hub sync failed: ${syncRes.message}`, type: 'warning' });
    } else {
      showToast({ message: 'Bracket added', type: 'success' });
    }
    fetchRows();
  };
  const handleUpdateField = async (id: string, field: 'min_kg' | 'max_kg' | 'price', value: number | null) => {
    const prev = rows;
    const column = field === 'price' ? 'flat_amount' : field === 'min_kg' ? 'min_inches' : 'max_inches';
    setRows(cur => cur.map(r => r.id === id ? { ...r, [column]: value } as RateRow : r));
    const { error } = await supabase.from('size_tier_rates').update({ [column]: value, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) {
      setRows(prev);
      showToast({ message: `Failed to save: ${error.message}`, type: 'error' });
    } else {
      const syncRes = await syncLagosRates(selectedHubId);
      if (!syncRes.success) {
        showToast({ message: `Saved, but sibling hub sync failed: ${syncRes.message}`, type: 'warning' });
      }
    }
  };
  const handleDelete = async (id: string) => {
    const prev = rows;
    const targetRow = rows.find(r => r.id === id);
    setRows(cur => cur.filter(r => r.id !== id));
    const { error } = await supabase.from('size_tier_rates').delete().eq('id', id);
    if (error) {
      setRows(prev);
      showToast({ message: `Failed to remove: ${error.message}`, type: 'error' });
      return;
    }
    if (targetRow) {
      const delRes = await deleteLagosRateRow({
        table: 'size_tier_rates',
        sourceHubId: selectedHubId,
        keys: {
          content_type_id: selectedContentTypeId,
          airline: selectedAirline,
          route_name: selectedRoute,
          min_inches: targetRow.min_inches,
        },
      });
      if (!delRes.success) {
        showToast({ message: `Bracket removed, but sibling hub delete failed: ${delRes.message}`, type: 'warning' });
        return;
      }
    }
    showToast({ message: 'Bracket removed', type: 'success' });
  };

  const tiers: KgTier[] = rows.map(r => ({ id: r.id, min_kg: r.min_inches, max_kg: r.max_inches, price: r.flat_amount }));
  const selCls = "w-full h-10 px-2 text-[12px] font-mono rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)]";

  return (
    <main className="flex flex-col h-full bg-[var(--color-canvas)] overflow-y-auto">
      <PageHeader title="Size Tier Rates" subtitle="Flat price per screen-size bracket" onBack={onBack} />
      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        <div className="bg-[var(--color-info-bg)] border border-[var(--color-info-border)] rounded-xl p-3">
          <p className="text-[11px] text-[var(--color-accent-cobalt)] leading-relaxed">
            Flat screen-size-bracket pricing for content types flagged "size tier" in Content Types. The matching
            bracket's amount is the whole price — it overrides the per-kg route rate and any minimum charge.
            Set brackets per airline + route + hub.
          </p>
        </div>
        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
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
              <select value={selectedHubId} onChange={e => setSelectedHubId(e.target.value)} disabled={!canSelectHub} className={selCls}>
                {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            {rowsLoading ? (
              <div className="flex justify-center py-8"><Spinner size="md" tone="muted" /></div>
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
