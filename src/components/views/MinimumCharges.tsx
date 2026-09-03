import { useState, useEffect } from 'react';
import { PageHeader, Spinner } from '../ui';
import { KgTierEditor, KgTier } from '../KgTierEditor';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useAirlines } from '../../lib/airlines';
import { useHubRoutes } from '../../lib/hubRoutes';

interface MinChargeRow {
  id: string;
  airline: string;
  route_name: string;
  min_kg: number;
  max_kg: number | null;
  minimum_amount: number;
}

export const MinimumCharges = ({ onBack }: { onBack: () => void }) => {
  const airlines = useAirlines({ includeOther: false });
  const routes = useHubRoutes({ includeOther: false });
  const [selectedAirline, setSelectedAirline] = useState('');
  const [selectedRoute, setSelectedRoute] = useState('');
  const [rows, setRows] = useState<MinChargeRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  const { showToast } = useToast();

  useEffect(() => {
    if (airlines.length > 0 && !selectedAirline) setSelectedAirline(airlines[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airlines]);

  useEffect(() => {
    if (routes.length > 0 && !selectedRoute) setSelectedRoute(routes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);

  const fetchRows = async () => {
    if (!selectedAirline || !selectedRoute) { setRows([]); return; }
    setRowsLoading(true);
    const { data, error } = await supabase
      .from('minimum_charges')
      .select('id, airline, route_name, min_kg, max_kg, minimum_amount')
      .eq('airline', selectedAirline)
      .eq('route_name', selectedRoute)
      .order('min_kg');
    if (error) {
      showToast({ message: `Failed to load minimum charges: ${error.message}`, type: 'error' });
    } else {
      setRows(data || []);
    }
    setRowsLoading(false);
  };

  useEffect(() => { fetchRows(); }, [selectedAirline, selectedRoute]);

  const handleAdd = async ({ min_kg, max_kg, price }: { min_kg: number; max_kg: number | null; price: number }) => {
    const { error } = await supabase.from('minimum_charges').insert({
      airline: selectedAirline,
      route_name: selectedRoute,
      min_kg,
      max_kg,
      minimum_amount: price,
    });
    if (error) {
      showToast({ message: `Failed to add bracket: ${error.message}`, type: 'error' });
      return;
    }
    fetchRows();
  };

  // Optimistic update -- rolls back on failure, same pattern as
  // ExcessBaggageAirlines.tsx/SpecialGoodsRates.tsx.
  const handleUpdateField = async (id: string, field: 'min_kg' | 'max_kg' | 'price', value: number | null) => {
    const prev = rows;
    const column = field === 'price' ? 'minimum_amount' : field;
    setRows(cur => cur.map(r => r.id === id ? { ...r, [column]: value } as MinChargeRow : r));
    const { error } = await supabase.from('minimum_charges').update({ [column]: value, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) {
      setRows(prev);
      showToast({ message: `Failed to save change: ${error.message}`, type: 'error' });
    }
  };

  const handleDelete = async (id: string) => {
    const prevRows = rows;
    setRows(cur => cur.filter(r => r.id !== id));
    const { error } = await supabase.from('minimum_charges').delete().eq('id', id);
    if (error) {
      setRows(prevRows);
      showToast({ message: `Failed to remove bracket: ${error.message}`, type: 'error' });
      return;
    }
    showToast({ message: 'Bracket removed', type: 'success' });
  };

  const tiers: KgTier[] = rows.map(r => ({ id: r.id, min_kg: r.min_kg, max_kg: r.max_kg, price: r.minimum_amount }));

  return (
    <main className="flex flex-col h-full bg-[var(--color-canvas)] overflow-y-auto">
      <PageHeader title="Minimum Charges" subtitle="Synced across all devices" onBack={onBack} />

      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        <div className="bg-[var(--color-info-bg)] border border-[var(--color-info-border)] rounded-xl p-3">
          <p className="text-[11px] text-[var(--color-accent-cobalt)] font-sans leading-relaxed">
            Set a flat minimum charge per airline + route for a weight bracket (e.g. 1-13kg = ₦8,000). If the
            normal computed price for a matching weight comes out below this, the minimum is charged instead.
          </p>
        </div>

        <div className="ehi-card p-4 space-y-3">
          <div>
            <label htmlFor="mc-airline" className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">AIRLINE</label>
            <select
              id="mc-airline"
              value={selectedAirline}
              onChange={(e) => setSelectedAirline(e.target.value)}
              className="w-full ehi-input"
            >
              {airlines.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="mc-route" className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">ROUTE</label>
            <select
              id="mc-route"
              value={selectedRoute}
              onChange={(e) => setSelectedRoute(e.target.value)}
              className="w-full ehi-input"
            >
              {routes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {rowsLoading ? (
          <div className="flex justify-center py-8">
            <Spinner size="lg" />
          </div>
        ) : (
          <KgTierEditor
            tiers={tiers}
            priceLabel="MIN CHARGE (₦)"
            priceUnit="MIN CHARGE (₦)"
            itemLabel="minimum charge bracket"
            onAdd={handleAdd}
            onUpdateField={handleUpdateField}
            onDelete={handleDelete}
          />
        )}
      </div>
    </main>
  );
};
