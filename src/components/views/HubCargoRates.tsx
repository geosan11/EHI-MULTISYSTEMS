import { useState, useEffect, useMemo } from 'react';
import { useHubRoutes } from '../../lib/hubRoutes';
import { useAirlines } from '../../lib/airlines';
import { DollarSign, Trash2 } from 'lucide-react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { syncLagosRates } from '../../lib/lagosHubSync';
import { PageHeader } from '../ui';

const HUB_DEFAULT_AIRLINE = '__HUB_DEFAULT__';

interface Hub {
  id: string;
  name: string;
}

// Rates here are additive overrides on top of the company-wide
// standard_cargo_rates (edited in PricingConfiguration.tsx, which stays
// super_admin-only and untouched) -- see CargoForm.tsx's resolveRate() for
// the exact hub+airline -> hub-default -> company-wide fallback order this
// screen's writes feed into.
export const HubCargoRates = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const isUnrestricted = user.role === 'super_admin' || user.role === 'admin';
  const allRoutes = useHubRoutes();
  const ROUTES = useMemo(() => allRoutes.filter((r) => r !== 'Other'), [allRoutes]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [selectedHubId, setSelectedHubId] = useState<string>(user.hub_id || '');
  // Same canonical airline source CargoForm.tsx uses -- the key-set of
  // pricing_config's airline_commissions row, not a separate hardcoded list.
  const airlines = useAirlines({ includeOther: false });
  const [selectedAirline, setSelectedAirline] = useState<string>(HUB_DEFAULT_AIRLINE);
  const [hubRouteRates, setHubRouteRates] = useState<Record<string, number>>({});
  const [hubAirlineRouteRates, setHubAirlineRouteRates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    if (!isUnrestricted) return;
    supabase.from('hubs').select('id, name').eq('active', true).order('name').then(({ data }) => {
      if (data) setHubs(data);
    });
  }, [isUnrestricted]);

  const fetchHubRates = async (hubId: string) => {
    if (!hubId) { setHubRouteRates({}); setHubAirlineRouteRates({}); setLoading(false); return; }
    setLoading(true);
    const [hubRes, airlineRes] = await Promise.all([
      supabase.from('hub_route_rates').select('route_name, rate_per_kg').eq('hub_id', hubId),
      supabase.from('hub_airline_route_rates').select('airline, route_name, rate_per_kg').eq('hub_id', hubId),
    ]);
    if (hubRes.data && !hubRes.error) {
      const rates: Record<string, number> = {};
      hubRes.data.forEach((r: any) => { rates[r.route_name] = Number(r.rate_per_kg); });
      setHubRouteRates(rates);
    }
    if (airlineRes.data && !airlineRes.error) {
      const rates: Record<string, number> = {};
      airlineRes.data.forEach((r: any) => { rates[`${r.airline}|${r.route_name}`] = Number(r.rate_per_kg); });
      setHubAirlineRouteRates(rates);
    }
    setLoading(false);
  };

  useEffect(() => { fetchHubRates(selectedHubId); }, [selectedHubId]);

  const currentHubName = useMemo(
    () => (isUnrestricted ? hubs.find((h) => h.id === selectedHubId)?.name : user.hub) || '',
    [isUnrestricted, hubs, selectedHubId, user.hub],
  );

  const handleSetRate = async (route: string, value: string) => {
    if (!selectedHubId) return;
    const rate = parseFloat(value);
    if (isNaN(rate) || rate < 0) return;

    if (selectedAirline === HUB_DEFAULT_AIRLINE) {
      const prev = hubRouteRates;
      setHubRouteRates({ ...hubRouteRates, [route]: rate });
      const { error } = await supabase.from('hub_route_rates').upsert({
        hub_id: selectedHubId,
        route_name: route,
        rate_per_kg: rate,
        updated_by: user.name,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'hub_id,route_name' });
      if (error) {
        setHubRouteRates(prev);
        showToast({ message: `Failed to save ${route} default rate: ${error.message}`, type: 'error' });
      } else {
        syncLagosRates();
        showToast({ message: `${route} default rate saved.`, type: 'success' });
      }
    } else {
      const key = `${selectedAirline}|${route}`;
      const prev = hubAirlineRouteRates;
      setHubAirlineRouteRates({ ...hubAirlineRouteRates, [key]: rate });
      const { error } = await supabase.from('hub_airline_route_rates').upsert({
        hub_id: selectedHubId,
        airline: selectedAirline,
        route_name: route,
        rate_per_kg: rate,
        updated_by: user.name,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'hub_id,airline,route_name' });
      if (error) {
        setHubAirlineRouteRates(prev);
        showToast({ message: `Failed to save ${route} rate for ${selectedAirline}: ${error.message}`, type: 'error' });
      } else {
        syncLagosRates();
        showToast({ message: `${route} rate for ${selectedAirline} saved.`, type: 'success' });
      }
    }
  };

  const handleClearRate = async (route: string) => {
    if (!selectedHubId) return;
    if (selectedAirline === HUB_DEFAULT_AIRLINE) {
      const prev = hubRouteRates;
      const next = { ...hubRouteRates };
      delete next[route];
      setHubRouteRates(next);
      const { error } = await supabase.from('hub_route_rates').delete().eq('hub_id', selectedHubId).eq('route_name', route);
      if (error) {
        setHubRouteRates(prev);
        showToast({ message: `Failed to clear ${route} default rate: ${error.message}`, type: 'error' });
      } else {
        syncLagosRates();
        showToast({ message: `${route} default rate cleared.`, type: 'success' });
      }
    } else {
      const key = `${selectedAirline}|${route}`;
      const prev = hubAirlineRouteRates;
      const next = { ...hubAirlineRouteRates };
      delete next[key];
      setHubAirlineRouteRates(next);
      const { error } = await supabase.from('hub_airline_route_rates').delete().eq('hub_id', selectedHubId).eq('airline', selectedAirline).eq('route_name', route);
      if (error) {
        setHubAirlineRouteRates(prev);
        showToast({ message: `Failed to clear ${route} rate for ${selectedAirline}: ${error.message}`, type: 'error' });
      } else {
        syncLagosRates();
        showToast({ message: `${route} rate for ${selectedAirline} cleared.`, type: 'success' });
      }
    }
  };

  const activeRates = selectedAirline === HUB_DEFAULT_AIRLINE ? hubRouteRates : hubAirlineRouteRates;
  const rateFor = (route: string) => selectedAirline === HUB_DEFAULT_AIRLINE ? hubRouteRates[route] : hubAirlineRouteRates[`${selectedAirline}|${route}`];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hub Cargo Rates"
        subtitle="Per-hub, per-airline overrides on top of the standard route rate"
        onBack={onBack}
        sticky={false}
      />

      <div className="ehi-card p-4 space-y-4">
        <div className="flex justify-between items-center">
          <div className="text-[9px] font-mono text-[var(--color-foreground)] tracking-widest uppercase flex items-center space-x-1.5">
            <DollarSign size={12} className="text-[var(--color-accent-amber)]" />
            <span>{currentHubName ? `${currentHubName.toUpperCase()} RATES` : 'SELECT A HUB'}</span>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          {isUnrestricted && (
            <div>
              <label htmlFor="hub-select" className="text-[11px] font-medium text-[var(--color-muted)] block mb-1.5">Hub</label>
              <select
                id="hub-select"
                value={selectedHubId}
                onChange={(e) => setSelectedHubId(e.target.value)}
                className="w-full bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[13px] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
              >
                <option value="">Select a hub…</option>
                {hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="airline-select" className="text-[11px] font-medium text-[var(--color-muted)] block mb-1.5">Airline</label>
            <select
              id="airline-select"
              value={selectedAirline}
              onChange={(e) => setSelectedAirline(e.target.value)}
              className="w-full bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[13px] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
            >
              <option value={HUB_DEFAULT_AIRLINE}>Hub default (any airline)</option>
              {airlines.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        {!selectedHubId ? (
          <div className="text-[12px] text-[var(--color-muted)] text-center py-8">Select a hub to configure its rates.</div>
        ) : loading ? (
          <div className="text-[12px] text-[var(--color-muted)] text-center py-8">Loading…</div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
            {ROUTES.map((route) => {
              const val = rateFor(route);
              return (
                <div key={route} className="flex justify-between items-center bg-[var(--color-surface-2)] p-2 rounded">
                  <span className="text-[12px] font-mono text-[var(--color-light-muted)]">{route}</span>
                  <div className="flex items-center space-x-2">
                    {val != null && (
                      <button
                        onClick={() => handleClearRate(route)}
                        aria-label={`Clear override for ${route}`}
                        className="p-1 rounded hover:bg-[var(--color-surface-3)] text-[var(--color-muted)] hover:text-[var(--color-error)] transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                    <span className="text-[12px] font-mono text-[var(--color-muted)]">₦</span>
                    <input
                      type="number"
                      placeholder="—"
                      defaultValue={val ?? ''}
                      key={`${route}-${selectedAirline}-${val ?? 'empty'}`}
                      onBlur={(e) => {
                        if (!e.target.value) {
                          // Clearing the box does not delete the rate -- use
                          // the trash-icon button to actually remove an
                          // override. Restore the last saved value so the
                          // field never visually implies an unsaved change.
                          e.target.value = val != null ? String(val) : '';
                          return;
                        }
                        handleSetRate(route, e.target.value);
                      }}
                      className="w-24 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded px-2 py-1 text-[12px] font-mono text-[var(--color-foreground)] text-right focus:outline-none focus:border-[var(--color-accent-amber)]"
                    />
                    <span className="text-[10px] text-[var(--color-muted)]">/KG</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {Object.keys(activeRates).length === 0 && selectedHubId && !loading && (
          <div className="text-[11px] text-[var(--color-muted)] italic text-center py-2">
            No overrides set for this {selectedAirline === HUB_DEFAULT_AIRLINE ? 'hub default' : 'hub + airline'} yet — falls back to the standard route rate.
          </div>
        )}
      </div>
    </div>
  );
};
