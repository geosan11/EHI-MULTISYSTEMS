import { useState, useEffect } from 'react';
import { PackageSearch, Loader } from 'lucide-react';
import { BackButton } from '../BackButton';
import { KgTierEditor, KgTier } from '../KgTierEditor';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useAirlines } from '../../lib/airlines';
import { useHubRoutes } from '../../lib/hubRoutes';
import { User } from '../../lib/types';

// Sentinel for the company-wide default row (hub_id IS NULL) -- same
// convention as HubCargoRates.tsx's HUB_DEFAULT_AIRLINE for a "wildcard"
// select option that doesn't correspond to a real row value.
const ALL_HUBS = '__ALL_HUBS__';
// Same wildcard convention for the route dimension (see the migration's own
// comment on why route_name NULL means "applies to any route").
const ALL_ROUTES = '__all_routes__';

interface SpecialContentType {
  id: string;
  name: string;
}

interface Hub {
  id: string;
  name: string;
}

interface RateRow {
  id: string;
  content_type_id: string;
  airline: string;
  hub_id: string | null;
  route_name: string | null;
  min_kg: number;
  max_kg: number | null;
  rate_per_kg: number;
}

export const SpecialGoodsRates = ({ onBack, presetContentTypeId, user }: { onBack: () => void; presetContentTypeId?: string; user: User }) => {
  const isUnrestricted = user.role === 'super_admin' || user.role === 'admin';
  const [contentTypes, setContentTypes] = useState<SpecialContentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContentTypeId, setSelectedContentTypeId] = useState<string>(presetContentTypeId || '');
  const [selectedAirline, setSelectedAirline] = useState<string>('');
  // super_admin/admin can browse/edit any hub's override (or the ALL_HUBS
  // company-wide default); accountant is locked to their own hub -- RLS
  // would reject a write to any other hub_id anyway (20260820_special_goods_hub_scoping.sql).
  const [selectedHubId, setSelectedHubId] = useState<string>(isUnrestricted ? ALL_HUBS : (user.hub_id || ALL_HUBS));
  const [selectedRoute, setSelectedRoute] = useState<string>(ALL_ROUTES);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [rows, setRows] = useState<RateRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  const { showToast } = useToast();
  const airlines = useAirlines({ includeOther: false });
  const routes = useHubRoutes();

  useEffect(() => {
    if (!isUnrestricted) return;
    supabase.from('hubs').select('id, name').eq('active', true).order('name').then(({ data }) => {
      if (data) setHubs(data);
    });
  }, [isUnrestricted]);

  useEffect(() => {
    const fetchTypes = async () => {
      const { data, error } = await supabase
        .from('content_types')
        .select('id, name')
        .eq('is_special_goods', true)
        .order('name');
      if (error) {
        showToast({ message: `Failed to load special goods: ${error.message}`, type: 'error' });
      } else {
        setContentTypes(data || []);
        if (!selectedContentTypeId && data && data.length > 0) setSelectedContentTypeId(data[0].id);
      }
      setLoading(false);
    };
    fetchTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (airlines.length > 0 && !selectedAirline) setSelectedAirline(airlines[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airlines]);

  const fetchRows = async () => {
    if (!selectedContentTypeId || !selectedAirline) { setRows([]); return; }
    setRowsLoading(true);
    let query = supabase
      .from('special_goods_rates')
      .select('id, content_type_id, airline, hub_id, route_name, min_kg, max_kg, rate_per_kg')
      .eq('content_type_id', selectedContentTypeId)
      .eq('airline', selectedAirline);
    query = selectedHubId === ALL_HUBS ? query.is('hub_id', null) : query.eq('hub_id', selectedHubId);
    query = selectedRoute === ALL_ROUTES ? query.is('route_name', null) : query.eq('route_name', selectedRoute);
    const { data, error } = await query.order('min_kg');
    if (error) {
      showToast({ message: `Failed to load rate brackets: ${error.message}`, type: 'error' });
    } else {
      setRows(data || []);
    }
    setRowsLoading(false);
  };

  useEffect(() => { fetchRows(); }, [selectedContentTypeId, selectedAirline, selectedHubId, selectedRoute]);

  const handleAdd = async ({ min_kg, max_kg, price }: { min_kg: number; max_kg: number | null; price: number }) => {
    const { error } = await supabase.from('special_goods_rates').insert({
      content_type_id: selectedContentTypeId,
      airline: selectedAirline,
      hub_id: selectedHubId === ALL_HUBS ? null : selectedHubId,
      route_name: selectedRoute === ALL_ROUTES ? null : selectedRoute,
      min_kg,
      max_kg,
      rate_per_kg: price,
    });
    if (error) {
      showToast({ message: `Failed to add bracket: ${error.message}`, type: 'error' });
      return;
    }
    fetchRows();
  };

  // Optimistic update -- rolls back on failure, same pattern as
  // ExcessBaggageAirlines.tsx/ContentTypes.tsx.
  const handleUpdateField = async (id: string, field: 'min_kg' | 'max_kg' | 'price', value: number | null) => {
    const prev = rows;
    const column = field === 'price' ? 'rate_per_kg' : field;
    setRows(cur => cur.map(r => r.id === id ? { ...r, [column]: value } as RateRow : r));
    const { error } = await supabase.from('special_goods_rates').update({ [column]: value, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) {
      setRows(prev);
      showToast({ message: `Failed to save change: ${error.message}`, type: 'error' });
    }
  };

  const handleDelete = async (id: string) => {
    const prevRows = rows;
    setRows(cur => cur.filter(r => r.id !== id));
    const { error } = await supabase.from('special_goods_rates').delete().eq('id', id);
    if (error) {
      setRows(prevRows);
      showToast({ message: `Failed to remove bracket: ${error.message}`, type: 'error' });
      return;
    }
    showToast({ message: 'Bracket removed', type: 'success' });
  };

  const tiers: KgTier[] = rows.map(r => ({ id: r.id, min_kg: r.min_kg, max_kg: r.max_kg, price: r.rate_per_kg }));

  return (
    <main className="flex flex-col h-full bg-[var(--color-obsidian)] overflow-y-auto">
      <div className="ehi-view-header">
        <BackButton onClick={onBack} />
        <div className="text-center">
          <div className="text-[12px] font-bold text-[var(--color-foreground)]">Special Goods Rates</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Synced across all devices</div>
        </div>
        <div className="w-8" />
      </div>

      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        <div className="bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] rounded-xl p-3">
          <p className="text-[11px] text-[var(--color-accent-cobalt)] font-sans leading-relaxed">
            Set per-airline weight brackets for content types flagged "special goods" in Content Types. When
            staff pick this content type + airline at intake, the matching bracket's rate overrides the
            normal route rate. Set "All Hubs (Default)" for a company-wide rate, or pick a specific hub to
            override it just for that hub. Leave route on All Routes for a rate that applies everywhere, or
            pick a route to override it for that destination. Flag more content types from the Content Types screen.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader size={20} className="animate-spin text-[var(--color-accent-amber)]" />
          </div>
        ) : contentTypes.length === 0 ? (
          <div className="ehi-card p-6 text-center space-y-2">
            <PackageSearch size={24} className="mx-auto text-[var(--color-muted)]" />
            <div className="text-[12px] text-[var(--color-muted)]">
              No content types are flagged as special goods yet. Flag one from Content Types first.
            </div>
          </div>
        ) : (
          <>
            <div className="ehi-card p-4 space-y-3">
              <div>
                <label htmlFor="sg-content-type" className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">SPECIAL GOOD</label>
                <select
                  id="sg-content-type"
                  value={selectedContentTypeId}
                  onChange={(e) => setSelectedContentTypeId(e.target.value)}
                  className="w-full ehi-input"
                >
                  {contentTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="sg-airline" className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">AIRLINE</label>
                <select
                  id="sg-airline"
                  value={selectedAirline}
                  onChange={(e) => setSelectedAirline(e.target.value)}
                  className="w-full ehi-input"
                >
                  {airlines.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="sg-hub" className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">HUB</label>
                {isUnrestricted ? (
                  <select
                    id="sg-hub"
                    value={selectedHubId}
                    onChange={(e) => setSelectedHubId(e.target.value)}
                    className="w-full ehi-input"
                  >
                    <option value={ALL_HUBS}>All Hubs (Default)</option>
                    {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                ) : (
                  <div className="w-full ehi-input flex items-center text-[var(--color-muted)]">{user.hub || 'Your Hub'}</div>
                )}
              </div>
              <div>
                <label htmlFor="sg-route" className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">ROUTE</label>
                <select
                  id="sg-route"
                  value={selectedRoute}
                  onChange={(e) => setSelectedRoute(e.target.value)}
                  className="w-full ehi-input"
                >
                  <option value={ALL_ROUTES}>All Routes (Default)</option>
                  {routes.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>

            {rowsLoading ? (
              <div className="flex justify-center py-8">
                <Loader size={18} className="animate-spin text-[var(--color-accent-amber)]" />
              </div>
            ) : (
              <KgTierEditor
                tiers={tiers}
                priceLabel="RATE (₦/KG)"
                priceUnit="₦/kg"
                itemLabel="rate bracket"
                onAdd={handleAdd}
                onUpdateField={handleUpdateField}
                onDelete={handleDelete}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
};
