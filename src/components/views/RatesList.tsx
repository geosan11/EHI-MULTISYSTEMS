import { useState, useEffect, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight, Loader } from 'lucide-react';
import { BackButton } from '../BackButton';
import { supabase } from '../../lib/supabase';
import { fmt } from '../../lib/helpers';
import { useSpecialGoodsRates } from '../../lib/specialGoodsRates';
import { useMinimumCharges } from '../../lib/minimumCharges';

export type RatesConfigTarget = 'pricing' | 'hubRates' | 'excessBaggage' | 'contentTypes' | 'specialGoods' | 'minimumCharges' | 'airlineCommissions';

interface StandardRate { route_name: string; rate_per_kg: number; }
interface HubRouteRate { hub_id: string; route_name: string; rate_per_kg: number; }
interface HubAirlineRouteRate { hub_id: string; airline: string; route_name: string; rate_per_kg: number; }
interface CorporateRouteRate { corporate_client_id: string; route_name: string; rate_per_kg: number; minimum_amount?: number; }
interface MarketingRate { route_name: string; bb_rate: number; mb_rate: number; sb_rate: number; }
interface ExcessBaggageRow { name: string; free_allowance_kg: number; rate_per_kg: number; active: boolean; }

// Pure display -- this screen never writes to any table. Every section
// links back to its real configuration screen via onOpenConfig for anyone
// with the write role; everyone else (any authenticated role that can open
// More at all) can still see every number, matching MORE_TAB_ROLES' broad
// read tier in permissions.ts.
export const RatesList = ({ onBack, onOpenConfig }: { onBack: () => void; onOpenConfig: (target: RatesConfigTarget) => void }) => {
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [standardRates, setStandardRates] = useState<StandardRate[]>([]);
  const [hubs, setHubs] = useState<{ id: string; name: string }[]>([]);
  const [hubRouteRates, setHubRouteRates] = useState<HubRouteRate[]>([]);
  const [hubAirlineRouteRates, setHubAirlineRouteRates] = useState<HubAirlineRouteRate[]>([]);
  const [corporateClients, setCorporateClients] = useState<{ id: string; company_name: string }[]>([]);
  const [corporateRates, setCorporateRates] = useState<CorporateRouteRate[]>([]);
  const [marketingRates, setMarketingRates] = useState<MarketingRate[]>([]);
  const [excessBaggage, setExcessBaggage] = useState<ExcessBaggageRow[]>([]);
  const [airlineCommissions, setAirlineCommissions] = useState<Record<string, number>>({});

  const specialGoodsRates = useSpecialGoodsRates();
  const minimumCharges = useMinimumCharges();

  useEffect(() => {
    const fetchAll = async () => {
      const [
        standardRes, hubsRes, hubRouteRes, hubAirlineRouteRes,
        corpClientsRes, corpRatesRes, marketingRes, excessRes, commissionsRes,
      ] = await Promise.all([
        supabase.from('standard_cargo_rates').select('route_name, rate_per_kg').order('route_name'),
        supabase.from('hubs').select('id, name').order('name'),
        supabase.from('hub_route_rates').select('hub_id, route_name, rate_per_kg'),
        supabase.from('hub_airline_route_rates').select('hub_id, airline, route_name, rate_per_kg'),
        supabase.from('corporate_clients').select('id, company_name').order('company_name'),
        supabase.from('corporate_route_rates').select('corporate_client_id, route_name, rate_per_kg, minimum_amount'),
        supabase.from('marketing_route_rates').select('route_name, bb_rate, mb_rate, sb_rate').order('route_name'),
        supabase.from('excess_baggage_airlines').select('name, free_allowance_kg, rate_per_kg, active').order('name'),
        supabase.from('pricing_config').select('config_value').eq('config_key', 'airline_commissions').single(),
      ]);
      setStandardRates(standardRes.data || []);
      setHubs(hubsRes.data || []);
      setHubRouteRates(hubRouteRes.data || []);
      setHubAirlineRouteRates(hubAirlineRouteRes.data || []);
      setCorporateClients(corpClientsRes.data || []);
      setCorporateRates(corpRatesRes.data || []);
      setMarketingRates(marketingRes.data || []);
      setExcessBaggage(excessRes.data || []);
      setAirlineCommissions((commissionsRes.data?.config_value as Record<string, number>) || {});
      setLoading(false);
    };
    fetchAll();
  }, []);

  const hubName = (id: string) => hubs.find(h => h.id === id)?.name || id;
  const clientName = (id: string) => corporateClients.find(c => c.id === id)?.company_name || id;

  const q = query.trim().toLowerCase();
  const matches = (...vals: (string | number | null | undefined)[]) =>
    q === '' || vals.some(v => v != null && String(v).toLowerCase().includes(q));

  const toggle = (id: string) => setCollapsed(c => ({ ...c, [id]: !c[id] }));

  const specialGoodsByGroup = useMemo(() => {
    const groups = new Map<string, typeof specialGoodsRates>();
    for (const r of specialGoodsRates) {
      const key = `${r.content_type_name}|${r.airline}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return Array.from(groups.entries()).map(([key, tiers]) => {
      const [content_type_name, airline] = key.split('|');
      return { content_type_name, airline, tiers: [...tiers].sort((a, b) => a.min_kg - b.min_kg) };
    });
  }, [specialGoodsRates]);

  const minChargesByGroup = useMemo(() => {
    const groups = new Map<string, typeof minimumCharges>();
    for (const r of minimumCharges) {
      const key = `${r.airline}|${r.route_name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return Array.from(groups.entries()).map(([key, tiers]) => {
      const [airline, route_name] = key.split('|');
      return { airline, route_name, tiers: [...tiers].sort((a, b) => a.min_kg - b.min_kg) };
    });
  }, [minimumCharges]);

  const kgLabel = (min: number, max: number | null) => max == null ? `${min}kg & up` : `${min}-${max}kg`;

  const Section = ({
    id, title, count, editTarget, children,
  }: { id: string; title: string; count: number; editTarget: RatesConfigTarget; children: React.ReactNode }) => {
    const isCollapsed = collapsed[id];
    return (
      <div className="ehi-card overflow-hidden">
        <button
          onClick={() => toggle(id)}
          className="w-full flex items-center gap-2 p-3.5 text-left hover:bg-[var(--color-surface-1)] transition-colors"
        >
          {isCollapsed ? <ChevronRight size={14} className="text-[var(--color-muted)] shrink-0" /> : <ChevronDown size={14} className="text-[var(--color-muted)] shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-bold text-[var(--color-foreground)]">{title}</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">{count} configured</div>
          </div>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onOpenConfig(editTarget); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpenConfig(editTarget); } }}
            className="text-[10px] font-bold text-[var(--color-accent-amber)] hover:opacity-80 shrink-0 px-2 py-1"
          >
            Edit →
          </span>
        </button>
        {!isCollapsed && (
          <div className="px-3.5 pb-3.5 space-y-1.5 border-t border-[var(--color-border)] pt-2.5">
            {children}
          </div>
        )}
      </div>
    );
  };

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between gap-2 text-[11px] font-mono py-1">
      <span className="text-[var(--color-muted)] truncate">{label}</span>
      <span className="text-[var(--color-foreground)] font-semibold shrink-0">{value}</span>
    </div>
  );

  const filteredStandard = standardRates.filter(r => matches(r.route_name));
  const filteredHubRoute = hubRouteRates.filter(r => matches(hubName(r.hub_id), r.route_name));
  const filteredHubAirline = hubAirlineRouteRates.filter(r => matches(hubName(r.hub_id), r.airline, r.route_name));
  const filteredCorporate = corporateRates.filter(r => matches(clientName(r.corporate_client_id), r.route_name));
  const filteredMarketing = marketingRates.filter(r => matches(r.route_name));
  const filteredExcess = excessBaggage.filter(r => matches(r.name));
  const filteredCommissions = Object.entries(airlineCommissions).filter(([airline]) => matches(airline));
  const filteredSpecialGoods = specialGoodsByGroup.filter(g => matches(g.content_type_name, g.airline));
  const filteredMinCharges = minChargesByGroup.filter(g => matches(g.airline, g.route_name));

  return (
    <main className="flex flex-col h-full bg-[var(--color-obsidian)] overflow-y-auto">
      <div className="ehi-view-header">
        <BackButton onClick={onBack} />
        <div className="text-center">
          <div className="text-[12px] font-bold text-[var(--color-foreground)]">Rates Directory</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Read-only &middot; edit from each config screen</div>
        </div>
        <div className="w-8" />
      </div>

      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            type="text"
            placeholder="Search route, hub, airline, content type..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full ehi-input pl-9"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader size={20} className="animate-spin text-[var(--color-accent-amber)]" />
          </div>
        ) : (
          <>
            <Section id="standard" title="Standard Cargo Rates" count={filteredStandard.length} editTarget="pricing">
              {filteredStandard.map(r => <Row key={r.route_name} label={r.route_name} value={`${fmt(r.rate_per_kg)}/kg`} />)}
            </Section>

            <Section id="hubRoute" title="Hub Rate Overrides (any airline)" count={filteredHubRoute.length} editTarget="hubRates">
              {filteredHubRoute.map((r, i) => <Row key={i} label={`${hubName(r.hub_id)} · ${r.route_name}`} value={`₦${fmt(r.rate_per_kg)}/kg`} />)}
            </Section>

            <Section id="hubAirline" title="Hub + Airline Rate Overrides" count={filteredHubAirline.length} editTarget="hubRates">
              {filteredHubAirline.map((r, i) => <Row key={i} label={`${hubName(r.hub_id)} · ${r.airline} · ${r.route_name}`} value={`₦${fmt(r.rate_per_kg)}/kg`} />)}
            </Section>

            <Section id="corporate" title="Corporate Client Rates" count={filteredCorporate.length} editTarget="pricing">
              {filteredCorporate.map((r, i) => (
                <Row 
                  key={i} 
                  label={`${clientName(r.corporate_client_id)} · ${r.route_name}`} 
                  value={`₦${fmt(r.rate_per_kg)}/kg${r.minimum_amount && r.minimum_amount > 0 ? ` (Min: ₦${r.minimum_amount.toLocaleString()})` : ''}`} 
                />
              ))}
            </Section>

            <Section id="marketing" title="Marketing Bag Rates" count={filteredMarketing.length} editTarget="pricing">
              {filteredMarketing.map(r => <Row key={r.route_name} label={r.route_name} value={`BB ₦${fmt(r.bb_rate)} · MB ₦${fmt(r.mb_rate)} · SB ₦${fmt(r.sb_rate)}`} />)}
            </Section>

            <Section id="excess" title="Excess Baggage Airlines" count={filteredExcess.length} editTarget="excessBaggage">
              {filteredExcess.map(r => <Row key={r.name} label={`${r.name}${r.active ? '' : ' (inactive)'}`} value={`${r.free_allowance_kg}kg free · ₦${fmt(r.rate_per_kg)}/kg`} />)}
            </Section>

            <Section id="commissions" title="Airline Commissions" count={filteredCommissions.length} editTarget="airlineCommissions">
              {filteredCommissions.map(([airline, pct]) => <Row key={airline} label={airline} value={`${pct}%`} />)}
            </Section>

            <Section id="specialGoods" title="Special Goods Rates" count={filteredSpecialGoods.length} editTarget="specialGoods">
              {filteredSpecialGoods.map((g, i) => (
                <div key={i} className="space-y-1 pb-1.5 mb-1.5 border-b border-[var(--color-border)] last:border-0 last:mb-0 last:pb-0">
                  <div className="text-[10px] font-bold text-[var(--color-foreground)]">{g.content_type_name} · {g.airline}</div>
                  {g.tiers.map(t => (
                    <Row
                      key={t.id}
                      label={`${kgLabel(t.min_kg, t.max_kg)} · ${t.hub_name || 'All Hubs'} · ${t.route_name || 'All Routes'}`}
                      value={`₦${fmt(t.rate_per_kg)}/kg`}
                    />
                  ))}
                </div>
              ))}
            </Section>

            <Section id="minCharges" title="Minimum Charges" count={filteredMinCharges.length} editTarget="minimumCharges">
              {filteredMinCharges.map((g, i) => (
                <div key={i} className="space-y-1 pb-1.5 mb-1.5 border-b border-[var(--color-border)] last:border-0 last:mb-0 last:pb-0">
                  <div className="text-[10px] font-bold text-[var(--color-foreground)]">{g.airline} · {g.route_name}</div>
                  {g.tiers.map(t => <Row key={t.id} label={kgLabel(t.min_kg, t.max_kg)} value={`₦${fmt(t.minimum_amount)}`} />)}
                </div>
              ))}
            </Section>
          </>
        )}
      </div>
    </main>
  );
};
