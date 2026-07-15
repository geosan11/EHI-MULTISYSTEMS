import React, { useState, useEffect } from 'react';
import { CARGO_ROUTES } from '../../lib/constants';
import { Plus, DollarSign } from 'lucide-react';
import { BackButton } from '../BackButton';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';

export interface CorporateClient {
  id: string;
  company_name: string;
  contact_phone: string;
  accumulated_monthly_debt: number;
}

export interface CorporateRouteRate {
  id: string;
  corporate_client_id: string;
  route_name: string;
  rate_per_kg: number;
}

export const PricingConfiguration = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [standardRates, setStandardRates] = useState<Record<string, number>>({});
  
  const [corpClients, setCorpClients] = useState<CorporateClient[]>([]);
  const [corpRates, setCorpRates] = useState<CorporateRouteRate[]>([]);
  
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [selectedRateClient, setSelectedRateClient] = useState<CorporateClient | null>(null);
  const [rateRoute, setRateRoute] = useState(CARGO_ROUTES[0]);
  const [ratePrice, setRatePrice] = useState('');
  const { showToast } = useToast();

  // BB/MB/SB pricing matrix used to be localStorage-only -- a value set on
  // one device was invisible everywhere else. It now loads from Supabase
  // (localStorage is kept only as an offline-read cache, never the source
  // of truth) and every edit writes straight back to the server so other
  // devices see it on their next fetch.
  // (Excess-baggage airline pricing, formerly ValueJet-only "VJ settings"
  // here, now lives in its own screen: ExcessBaggageAirlines.tsx.)
  const [pricing, setPricing] = useState(() => {
    const saved = localStorage.getItem('ehi_setting_pricing');
    return saved ? JSON.parse(saved) : [
      { id: '1', route: 'LOS/Lagos - ABV/Abuja', bb: 18000, mb: 12000, sb: 7500 },
      { id: '2', route: 'LOS/Lagos - PHC/Port Harcourt', bb: 22000, mb: 15000, sb: 9500 },
      { id: '3', route: 'ABV/Abuja - LOS/Lagos', bb: 18000, mb: 12000, sb: 7500 },
      { id: '4', route: 'PHC/Port Harcourt - LOS/Lagos', bb: 22000, mb: 15000, sb: 9500 },
      { id: '5', route: 'LOS/Lagos - ENU/Enugu', bb: 19500, mb: 13000, sb: 8000 }
    ];
  });

  useEffect(() => {
    const fetchRoutePricing = async () => {
      const { data, error } = await supabase.from('marketing_route_rates').select('*').order('route_name');
      if (data && !error && data.length > 0) {
        const mapped = data.map((r: any) => ({ id: r.id, route: r.route_name, bb: Number(r.bb_rate), mb: Number(r.mb_rate), sb: Number(r.sb_rate) }));
        setPricing(mapped);
        localStorage.setItem('ehi_setting_pricing', JSON.stringify(mapped));
      }
    };
    fetchRoutePricing();
  }, []);

  const handlePriceUpdate = async (id: string, field: 'bb'|'mb'|'sb', value: string) => {
    const numVal = Number(value);
    if (isNaN(numVal)) return;
    const prev = pricing;
    const next = pricing.map((p: any) => p.id === id ? { ...p, [field]: numVal } : p);
    setPricing(next);
    localStorage.setItem('ehi_setting_pricing', JSON.stringify(next));

    const row = next.find((p: any) => p.id === id);
    if (!row) return;
    const { error } = await supabase.from('marketing_route_rates').upsert({
      route_name: row.route,
      bb_rate: row.bb,
      mb_rate: row.mb,
      sb_rate: row.sb,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'route_name' });
    if (error) {
      // Roll back the optimistic update (and its localStorage cache) --
      // otherwise this screen and the cache both keep showing a rate that
      // was never actually saved, diverging from what every other device
      // still sees as the real server value.
      setPricing(prev);
      localStorage.setItem('ehi_setting_pricing', JSON.stringify(prev));
      showToast({ message: `Failed to save ${row.route} rate: ${error.message}`, type: 'error' });
    }
  };


  // Fetch standard rates from Supabase
  useEffect(() => {
    const fetchStandardRates = async () => {
      const { data, error } = await supabase.from('standard_cargo_rates').select('*');
      if (data && !error && data.length > 0) {
        const ratesMap: Record<string, number> = {};
        data.forEach(d => {
          ratesMap[d.route_name] = d.rate_per_kg;
        });
        setStandardRates(ratesMap);
      } else {
        const initial: Record<string, number> = {};
        CARGO_ROUTES.forEach(r => initial[r] = 500); // 500 base rate
        setStandardRates(initial);
      }
    };
    fetchStandardRates();
  }, []);

  // Fetch corp clients and rates from Supabase
  useEffect(() => {
    const fetchCorpData = async () => {
      const [{ data: clients }, { data: rates }] = await Promise.all([
        supabase.from('corporate_clients').select('*'),
        supabase.from('corporate_route_rates').select('*')
      ]);

      if (clients) {
        setCorpClients(clients);
      }
      if (rates) {
        setCorpRates(rates);
      }
    };
    fetchCorpData();
  }, []);

  const handleUpdateStandardRate = async (route: string, val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const prev = standardRates;
    setStandardRates({ ...standardRates, [route]: num });

    const { error } = await supabase.from('standard_cargo_rates').upsert({
      route_name: route,
      rate_per_kg: num,
      updated_at: new Date().toISOString()
    }, { onConflict: 'route_name' });
    if (error) {
      // Roll back the optimistic update -- otherwise the screen shows a
      // rate that was never actually saved, and every other device keeps
      // using the real (unchanged) server value.
      setStandardRates(prev);
      showToast({ message: `Failed to save ${route} rate: ${error.message}`, type: 'error' });
    }
  };

  const handleCreateCorpClient = async () => {
    if (!newClientName.trim()) return;

    // corporate_clients.id is a real `uuid` column (DEFAULT gen_random_uuid())
    // -- a client-generated id like "corp_<timestamp>" isn't valid UUID
    // syntax, so this insert failed unconditionally with every attempt.
    // Let the DB generate the real id and read it back instead.
    const { data, error } = await supabase.from('corporate_clients').insert({
      company_name: newClientName,
      contact_phone: newClientPhone,
      created_at: new Date().toISOString()
    }).select().single();
    if (error) {
      // Do not add to local state on failure -- a client that only exists
      // in this browser's memory (e.g. a duplicate company_name rejected
      // by the DB's unique constraint) would look real here but be
      // invisible on every other device.
      showToast({ message: `Failed to create ${newClientName}: ${error.message}`, type: 'error' });
      return;
    }

    const newClient: CorporateClient = { id: data.id, company_name: data.company_name, contact_phone: data.contact_phone, accumulated_monthly_debt: data.accumulated_monthly_debt };
    setCorpClients([...corpClients, newClient]);
    setNewClientName('');
    setNewClientPhone('');
    setSelectedRateClient(newClient);
  };

  const handleSetCorpRate = async () => {
    if (!selectedRateClient || !ratePrice) return;
    const priceNum = parseFloat(ratePrice);
    if (isNaN(priceNum) || priceNum <= 0) return;

    // Upsert on the (corporate_client_id, route_name) unique constraint
    // instead of branching on whether *this device's* stale local corpRates
    // snapshot already has a row for this client/route -- deciding insert
    // vs. update from local state races if two devices set the same
    // client's rate around the same time: both would see no existing row
    // and both attempt INSERT, and the second would fail on the unique
    // constraint with no error handling. An upsert is correct either way
    // regardless of what this device has actually seen.
    const { data, error } = await supabase.from('corporate_route_rates').upsert({
      corporate_client_id: selectedRateClient.id,
      route_name: rateRoute,
      rate_per_kg: priceNum,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'corporate_client_id,route_name' }).select().single();

    if (error) {
      showToast({ message: `Failed to save rate: ${error.message}`, type: 'error' });
      return;
    }

    setCorpRates(prev => {
      const idx = prev.findIndex(r => r.corporate_client_id === selectedRateClient.id && r.route_name === rateRoute);
      const saved: CorporateRouteRate = { id: data.id, corporate_client_id: data.corporate_client_id, route_name: data.route_name, rate_per_kg: data.rate_per_kg };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setRatePrice('');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4 mb-4">
        <BackButton onClick={onBack} />
        <div>
          <h2 className="text-[20px] font-sans font-bold text-[var(--color-foreground)] tracking-tight">Pricing Configuration</h2>
          <p className="text-[12px] font-mono text-[var(--color-muted)]">Manage standard retail rates and B2B negotiated tariffs</p>
        </div>
      </div>

      <div className="ehi-card p-4 space-y-4 mb-6">
        <div className="flex justify-between items-center">
          <div className="text-[9px] font-mono text-[var(--color-foreground)] tracking-widest uppercase flex items-center space-x-1.5">
            <DollarSign size={12} className="text-[var(--color-accent-amber)]" />
            <span>ROUTE PRICING MATRIX (STREAM 1)</span>
          </div>
          <span className="text-[8px] font-mono text-[var(--color-muted)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded uppercase">BB/MB/SB ONLY</span>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {pricing.map((r: any) => (
            <div key={r.id} className="p-3 bg-[var(--color-surface-2)] rounded border border-[var(--color-border)] space-y-2">
              <span className="text-[11px] font-bold text-[var(--color-foreground)] uppercase tracking-wide block">{r.route}</span>
              {/* defaultValue+onBlur (uncontrolled), not value+onChange -- the
                  previous version wrote the parsed number straight back as
                  the controlled value on every keystroke (plus a live
                  Supabase write per keystroke), so typing a decimal point
                  immediately vanished and the next digit landed on the
                  whole-number part instead, e.g. "450.5" silently becoming
                  "4505". Same fix as ExcessBaggageAirlines.tsx. */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor={`bb-${r.id}`} className="text-[8px] font-mono text-[var(--color-muted)] block mb-1">BB BAG (₦)</label>
                  <input
                    id={`bb-${r.id}`}
                    type="number"
                    defaultValue={r.bb}
                    key={`bb-${r.id}-${r.bb}`}
                    onBlur={(e) => e.target.value && handlePriceUpdate(r.id, 'bb', e.target.value)}
                    className="w-full bg-[var(--color-surface-1)] border border-[var(--color-surface-2)] rounded px-2 py-1 text-[11px] font-mono text-[var(--color-foreground)] text-center focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <div>
                  <label htmlFor={`mb-${r.id}`} className="text-[8px] font-mono text-[var(--color-muted)] block mb-1">MB BAG (₦)</label>
                  <input
                    id={`mb-${r.id}`}
                    type="number"
                    defaultValue={r.mb}
                    key={`mb-${r.id}-${r.mb}`}
                    onBlur={(e) => e.target.value && handlePriceUpdate(r.id, 'mb', e.target.value)}
                    className="w-full bg-[var(--color-surface-1)] border border-[var(--color-surface-2)] rounded px-2 py-1 text-[11px] font-mono text-[var(--color-foreground)] text-center focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <div>
                  <label htmlFor={`sb-${r.id}`} className="text-[8px] font-mono text-[var(--color-muted)] block mb-1">SB BAG (₦)</label>
                  <input
                    id={`sb-${r.id}`}
                    type="number"
                    defaultValue={r.sb}
                    key={`sb-${r.id}-${r.sb}`}
                    onBlur={(e) => e.target.value && handlePriceUpdate(r.id, 'sb', e.target.value)}
                    className="w-full bg-[var(--color-surface-1)] border border-[var(--color-surface-2)] rounded px-2 py-1 text-[11px] font-mono text-[var(--color-foreground)] text-center focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Standard Rates Panel */}
        <div className="bg-[var(--color-surface-1)] p-5 rounded-xl border border-[var(--color-border)]">
          <h3 className="text-[14px] font-sans font-bold text-[var(--color-foreground)] mb-4">Standard Retail Rates</h3>
          <p className="text-[11px] text-[var(--color-muted)] mb-4 leading-relaxed">
            These rates auto-calculate for retail cargo entries based on weight and route.
          </p>
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {CARGO_ROUTES.map(r => (
              <div key={r} className="flex justify-between items-center bg-[var(--color-surface-2)] p-2 rounded">
                <span className="text-[12px] font-mono text-[var(--color-light-muted)]">{r}</span>
                <div className="flex items-center space-x-2">
                  <span className="text-[12px] font-mono text-[var(--color-muted)]">₦</span>
                  <input
                    type="number"
                    defaultValue={standardRates[r] || ''}
                    key={`standard-rate-${r}-${standardRates[r] ?? 'empty'}`}
                    onBlur={(e) => e.target.value && handleUpdateStandardRate(r, e.target.value)}
                    className="w-24 bg-[var(--color-bg)] border border-[var(--color-surface-2)] rounded px-2 py-1 text-[12px] font-mono text-[var(--color-foreground)] text-right focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                  <span className="text-[10px] text-[var(--color-muted)]">/KG</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* B2B Clients Panel */}
        <div className="bg-[var(--color-surface-1)] p-5 rounded-xl border border-[var(--color-border)] flex flex-col">
          <h3 className="text-[14px] font-sans font-bold text-[var(--color-foreground)] mb-4">B2B Clients & Negotiated Rates</h3>
          <div className="flex space-x-2 mb-6">
            <input 
              type="text"
              placeholder="Company Name"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              className="flex-1 bg-[var(--color-bg)] border border-[var(--color-surface-2)] rounded px-3 py-2 text-[12px] focus:border-[var(--color-accent-amber)] outline-none"
            />
            <button 
              onClick={handleCreateCorpClient}
              disabled={!newClientName.trim()}
              className="bg-[var(--color-accent-amber)] hover:bg-amber-600 disabled:opacity-50 text-black px-4 py-2 rounded text-[12px] font-bold font-sans flex items-center space-x-1 transition-colors"
            >
              <Plus size={14} />
              <span>Add</span>
            </button>
          </div>

          <div className="flex flex-col md:flex-row gap-4 flex-1">
            {/* Client List */}
            <div className="w-full md:w-1/2 space-y-2 overflow-y-auto max-h-[300px] border-r border-[var(--color-border)] pr-2">
              {corpClients.map(c => (
                <div 
                  key={c.id}
                  onClick={() => setSelectedRateClient(c)}
                  className={`p-3 rounded border cursor-pointer transition-colors ${selectedRateClient?.id === c.id ? 'bg-[rgba(251,191,36,0.1)] border-[var(--color-accent-amber)]' : 'bg-[var(--color-bg)] border-[var(--color-border)] hover:border-[var(--color-muted)]'}`}
                >
                  <div className="font-bold text-[12px] text-[var(--color-foreground)]">{c.company_name}</div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="text-[10px] text-[var(--color-muted)] font-mono">{corpRates.filter(r => r.corporate_client_id === c.id).length} routes configured</div>
                    <div className="text-[10px] font-mono font-bold" style={{ color: (c.accumulated_monthly_debt || 0) > 0 ? 'var(--color-error)' : 'var(--color-muted)' }}>
                      ₦{(c.accumulated_monthly_debt || 0).toLocaleString()} owed
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Rate Editor */}
            <div className="w-full md:w-1/2">
              {selectedRateClient ? (
                <div className="flex flex-col h-full space-y-4 pl-0 md:pl-2">
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--color-border)]">
                    <div className="text-[14px] font-bold text-[var(--color-accent-amber)]">{selectedRateClient.company_name}</div>
                    <div className="text-[10px] font-mono text-[var(--color-muted)] bg-[var(--color-surface-2)] px-2 py-0.5 rounded">Tariffs</div>
                  </div>
                  
                  <div className="bg-[var(--color-surface-2)] p-4 rounded-lg border border-[var(--color-border)] space-y-4">
                    <div className="flex flex-col space-y-3">
                      <div>
                        <label htmlFor="corp-route" className="text-[11px] font-medium text-[var(--color-muted)] block mb-1.5">Route</label>
                        <select
                          id="corp-route"
                          value={rateRoute}
                          onChange={(e) => setRateRoute(e.target.value)}
                          className="w-full bg-[var(--color-bg)] border border-[var(--color-surface-2)] rounded-md px-3 py-2 text-[13px] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
                        >
                          {CARGO_ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="corp-tariff" className="text-[11px] font-medium text-[var(--color-muted)] block mb-1.5">Tariff (₦/KG)</label>
                        <input
                          id="corp-tariff"
                          type="number"
                          value={ratePrice}
                          onChange={(e) => setRatePrice(e.target.value)}
                          placeholder="e.g. 450"
                          className="w-full bg-[var(--color-bg)] border border-[var(--color-surface-2)] rounded-md px-3 py-2 text-[13px] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
                        />
                      </div>
                      <button 
                        onClick={handleSetCorpRate}
                        disabled={!ratePrice}
                        className="w-full bg-[var(--color-accent-amber)] hover:bg-amber-600 text-black py-2 rounded-md text-[12px] font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
                      >
                        Set Rate
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto pr-1 space-y-2 mt-4">
                    <div className="text-[11px] text-[var(--color-muted)] uppercase tracking-wider font-semibold mb-3">Configured Routes</div>
                    <div className="space-y-2">
                      {corpRates.filter(r => r.corporate_client_id === selectedRateClient.id).map(r => (
                        <div key={r.id} className="flex justify-between items-center bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-2.5 rounded-md">
                          <span className="text-[12px] text-[var(--color-light-muted)] font-medium">{r.route_name}</span>
                          <span className="text-[13px] text-[var(--color-accent-amber)] font-bold font-mono">₦{r.rate_per_kg}</span>
                        </div>
                      ))}
                      {corpRates.filter(r => r.corporate_client_id === selectedRateClient.id).length === 0 && (
                        <div className="text-[12px] text-[var(--color-muted)] italic text-center py-6 bg-[var(--color-surface-2)] rounded-md border border-[rgba(255,255,255,0.02)]">
                          No custom rates set.<br/>Baseline standard rate will apply.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-[12px] text-[var(--color-muted)] text-center p-4">
                  Select a B2B client to configure negotiated route rates
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
