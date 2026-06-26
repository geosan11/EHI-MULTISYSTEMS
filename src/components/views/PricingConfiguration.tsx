import React, { useState, useEffect } from 'react';
import { CARGO_ROUTES } from '../../lib/constants';
import { Save, Plus, ArrowLeft, Trash2, Edit3, Building } from 'lucide-react';
import { User } from '../../lib/types';

export interface CorporateClient {
  id: string;
  company_name: string;
  contact_phone: string;
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

  // Load standard rates
  useEffect(() => {
    const saved = localStorage.getItem('ehi_standard_cargo_rates');
    if (saved) {
      setStandardRates(JSON.parse(saved));
    } else {
      const initial: Record<string, number> = {};
      CARGO_ROUTES.forEach(r => initial[r] = 500); // 500 base rate
      setStandardRates(initial);
      localStorage.setItem('ehi_standard_cargo_rates', JSON.stringify(initial));
    }
  }, []);

  // Load corp clients
  useEffect(() => {
    const savedClients = localStorage.getItem('ehi_corporate_clients_v2');
    if (savedClients) {
      setCorpClients(JSON.parse(savedClients));
    } else {
      const initial = [
        { id: 'corp_1', company_name: 'GlobaCom', contact_phone: '08055555555' },
        { id: 'corp_2', company_name: 'ZeemMax', contact_phone: '09012345678' }
      ];
      setCorpClients(initial);
      localStorage.setItem('ehi_corporate_clients_v2', JSON.stringify(initial));
    }

    const savedRates = localStorage.getItem('ehi_corporate_route_rates_v2');
    if (savedRates) {
      setCorpRates(JSON.parse(savedRates));
    } else {
      const initialRates = [
        { id: 'rate_1', corporate_client_id: 'corp_1', route_name: 'ABV/Abuja', rate_per_kg: 600 },
        { id: 'rate_2', corporate_client_id: 'corp_1', route_name: 'BNI/Benin City', rate_per_kg: 400 },
      ];
      setCorpRates(initialRates);
      localStorage.setItem('ehi_corporate_route_rates_v2', JSON.stringify(initialRates));
    }
  }, []);

  const handleUpdateStandardRate = (route: string, val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const next = { ...standardRates, [route]: num };
    setStandardRates(next);
    localStorage.setItem('ehi_standard_cargo_rates', JSON.stringify(next));
  };

  const handleCreateCorpClient = () => {
    if (!newClientName.trim()) return;
    const newClient: CorporateClient = {
      id: 'corp_' + Date.now().toString(),
      company_name: newClientName,
      contact_phone: newClientPhone
    };
    const next = [...corpClients, newClient];
    setCorpClients(next);
    localStorage.setItem('ehi_corporate_clients_v2', JSON.stringify(next));
    setNewClientName('');
    setNewClientPhone('');
    setSelectedRateClient(newClient);
  };

  const handleSetCorpRate = () => {
    if (!selectedRateClient || !ratePrice) return;
    const priceNum = parseFloat(ratePrice);
    if (isNaN(priceNum) || priceNum <= 0) return;

    const existingIndex = corpRates.findIndex(
      r => r.corporate_client_id === selectedRateClient.id && r.route_name === rateRoute
    );

    let updatedRates = [...corpRates];
    if (existingIndex >= 0) {
      updatedRates[existingIndex].rate_per_kg = priceNum;
    } else {
      updatedRates.push({
        id: 'rate_' + Date.now().toString(),
        corporate_client_id: selectedRateClient.id,
        route_name: rateRoute,
        rate_per_kg: priceNum
      });
    }

    setCorpRates(updatedRates);
    localStorage.setItem('ehi_corporate_route_rates_v2', JSON.stringify(updatedRates));
    setRatePrice('');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4 mb-4">
        <button onClick={onBack} className="p-2 hover:bg-[var(--color-surface-2)] rounded-full transition-colors text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-[20px] font-sans font-bold text-[var(--color-foreground)] tracking-tight">Pricing Configuration</h2>
          <p className="text-[12px] font-mono text-[var(--color-muted)]">Manage standard retail rates and B2B negotiated tariffs</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Standard Rates Panel */}
        <div className="bg-[var(--color-surface-1)] p-5 rounded-xl border border-[rgba(255,255,255,0.07)]">
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
                    value={standardRates[r] || ''}
                    onChange={(e) => handleUpdateStandardRate(r, e.target.value)}
                    className="w-24 bg-[var(--color-bg)] border border-[rgba(255,255,255,0.1)] rounded px-2 py-1 text-[12px] font-mono text-[var(--color-foreground)] text-right focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                  <span className="text-[10px] text-[var(--color-muted)]">/KG</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* B2B Clients Panel */}
        <div className="bg-[var(--color-surface-1)] p-5 rounded-xl border border-[rgba(255,255,255,0.07)] flex flex-col">
          <h3 className="text-[14px] font-sans font-bold text-[var(--color-foreground)] mb-4">B2B Clients & Negotiated Rates</h3>
          <div className="flex space-x-2 mb-6">
            <input 
              type="text"
              placeholder="Company Name"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              className="flex-1 bg-[var(--color-bg)] border border-[rgba(255,255,255,0.1)] rounded px-3 py-2 text-[12px] focus:border-[var(--color-accent-amber)] outline-none"
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
            <div className="w-full md:w-1/2 space-y-2 overflow-y-auto max-h-[300px] border-r border-[rgba(255,255,255,0.07)] pr-2">
              {corpClients.map(c => (
                <div 
                  key={c.id}
                  onClick={() => setSelectedRateClient(c)}
                  className={`p-3 rounded border cursor-pointer transition-colors ${selectedRateClient?.id === c.id ? 'bg-[rgba(251,191,36,0.1)] border-[var(--color-accent-amber)]' : 'bg-[var(--color-bg)] border-[rgba(255,255,255,0.07)] hover:border-[rgba(255,255,255,0.2)]'}`}
                >
                  <div className="font-bold text-[12px] text-[var(--color-foreground)]">{c.company_name}</div>
                  <div className="text-[10px] text-[var(--color-muted)] font-mono mt-1">{corpRates.filter(r => r.corporate_client_id === c.id).length} routes configured</div>
                </div>
              ))}
            </div>

            {/* Rate Editor */}
            <div className="w-full md:w-1/2">
              {selectedRateClient ? (
                <div className="flex flex-col h-full space-y-4 pl-0 md:pl-2">
                  <div className="flex items-center justify-between pb-2 border-b border-[rgba(255,255,255,0.05)]">
                    <div className="text-[14px] font-bold text-[var(--color-accent-amber)]">{selectedRateClient.company_name}</div>
                    <div className="text-[10px] font-mono text-[var(--color-muted)] bg-[var(--color-surface-2)] px-2 py-0.5 rounded">Tariffs</div>
                  </div>
                  
                  <div className="bg-[var(--color-surface-2)] p-4 rounded-lg border border-[rgba(255,255,255,0.05)] space-y-4">
                    <div className="flex flex-col space-y-3">
                      <div>
                        <label className="text-[11px] font-medium text-[var(--color-muted)] block mb-1.5">Route</label>
                        <select
                          value={rateRoute}
                          onChange={(e) => setRateRoute(e.target.value)}
                          className="w-full bg-[var(--color-bg)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-[13px] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
                        >
                          {CARGO_ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-[var(--color-muted)] block mb-1.5">Tariff (₦/KG)</label>
                        <input 
                          type="number"
                          value={ratePrice}
                          onChange={(e) => setRatePrice(e.target.value)}
                          placeholder="e.g. 450"
                          className="w-full bg-[var(--color-bg)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-[13px] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
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
                        <div key={r.id} className="flex justify-between items-center bg-[var(--color-bg)] border border-[rgba(255,255,255,0.05)] px-3 py-2.5 rounded-md">
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
