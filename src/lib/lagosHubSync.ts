import { supabase } from './supabase';

export interface LagosHubsInfo {
  headOfficeId: string | null;
  cargoStationId: string | null;
  allLagosHubIds: string[];
}

let cachedLagosInfo: LagosHubsInfo | null = null;

export async function getLagosHubInfo(): Promise<LagosHubsInfo> {
  if (cachedLagosInfo) return cachedLagosInfo;

  try {
    const { data: hubs } = await supabase.from('hubs').select('id, name, code');
    if (!hubs || hubs.length === 0) {
      return { headOfficeId: null, cargoStationId: null, allLagosHubIds: [] };
    }

    let headOfficeId: string | null = null;
    let cargoStationId: string | null = null;
    const allLagosHubIds: string[] = [];

    hubs.forEach((h: any) => {
      const nameNorm = (h.name || '').toLowerCase();
      const codeNorm = (h.code || '').toLowerCase();
      const isLagos = nameNorm.includes('lagos') || codeNorm === 'los' || codeNorm === 'hq' || nameNorm.includes('head office') || nameNorm.includes('cargo station');

      if (isLagos) {
        allLagosHubIds.push(h.id);
        if (nameNorm.includes('head office') || codeNorm === 'hq') {
          headOfficeId = h.id;
        } else if (nameNorm.includes('cargo') || nameNorm.includes('station') || codeNorm === 'los') {
          cargoStationId = h.id;
        }
      }
    });

    // Fallback if one was not distinctly categorized
    if (!headOfficeId && allLagosHubIds.length > 0) headOfficeId = allLagosHubIds[0];
    if (!cargoStationId && allLagosHubIds.length > 1) cargoStationId = allLagosHubIds[1];
    if (!cargoStationId && headOfficeId) cargoStationId = headOfficeId;

    cachedLagosInfo = { headOfficeId, cargoStationId, allLagosHubIds };
    return cachedLagosInfo;
  } catch {
    return { headOfficeId: null, cargoStationId: null, allLagosHubIds: [] };
  }
}

/**
 * Given any hubId, returns all equivalent hub IDs.
 * For Lagos hubs (Head Office or Air Cargo Station), returns all Lagos hub IDs.
 */
export async function getEquivalentHubIds(hubId?: string | null): Promise<string[]> {
  if (!hubId) return [];
  const info = await getLagosHubInfo();
  if (info.allLagosHubIds.includes(hubId)) {
    return info.allLagosHubIds;
  }
  return [hubId];
}

/**
 * Synchronizes all rate configuration tables (hub cargo rates, special goods rates,
 * flat tier rates, size tier rates, corporate B2B rates) between EHI Head Office Lagos
 * and Lagos Air Cargo Station so that both stations share identical pricing.
 */
export async function syncLagosRates(): Promise<{ success: boolean; count: number; message?: string }> {
  try {
    const info = await getLagosHubInfo();
    if (!info.allLagosHubIds || info.allLagosHubIds.length < 2) {
      return { success: true, count: 0, message: 'Fewer than 2 Lagos hubs found; nothing to sync.' };
    }

    let syncCount = 0;

    // 1. Sync hub_airline_route_rates
    const { data: airlineRates } = await supabase
      .from('hub_airline_route_rates')
      .select('*')
      .in('hub_id', info.allLagosHubIds);

    if (airlineRates && airlineRates.length > 0) {
      const recordsByHub: Record<string, typeof airlineRates> = {};
      info.allLagosHubIds.forEach(id => { recordsByHub[id] = []; });
      airlineRates.forEach(r => {
        if (recordsByHub[r.hub_id]) recordsByHub[r.hub_id].push(r);
      });

      const masterHubId = info.cargoStationId || info.allLagosHubIds[0];
      const masterRows = recordsByHub[masterHubId] || airlineRates;

      for (const targetHubId of info.allLagosHubIds) {
        if (targetHubId === masterHubId) continue;
        for (const row of masterRows) {
          const { error } = await supabase.from('hub_airline_route_rates').upsert(
            {
              hub_id: targetHubId,
              airline: row.airline,
              route_name: row.route_name,
              rate_per_kg: row.rate_per_kg,
              updated_by: row.updated_by || 'Lagos Rate Sync',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'hub_id,airline,route_name' }
          );
          if (!error) syncCount++;
        }
      }
    }

    // 2. Sync hub_route_rates
    const { data: routeRates } = await supabase
      .from('hub_route_rates')
      .select('*')
      .in('hub_id', info.allLagosHubIds);

    if (routeRates && routeRates.length > 0) {
      const masterHubId = info.cargoStationId || info.allLagosHubIds[0];
      const masterRows = routeRates.filter(r => r.hub_id === masterHubId) || routeRates;

      for (const targetHubId of info.allLagosHubIds) {
        if (targetHubId === masterHubId) continue;
        for (const row of masterRows) {
          const { error } = await supabase.from('hub_route_rates').upsert(
            {
              hub_id: targetHubId,
              route_name: row.route_name,
              rate_per_kg: row.rate_per_kg,
              updated_by: row.updated_by || 'Lagos Rate Sync',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'hub_id,route_name' }
          );
          if (!error) syncCount++;
        }
      }
    }

    // 3. Sync special_goods_rates
    const { data: specialRates } = await supabase
      .from('special_goods_rates')
      .select('*')
      .in('hub_id', info.allLagosHubIds);

    if (specialRates && specialRates.length > 0) {
      const masterHubId = info.cargoStationId || info.allLagosHubIds[0];
      const masterRows = specialRates.filter(r => r.hub_id === masterHubId);

      for (const targetHubId of info.allLagosHubIds) {
        if (targetHubId === masterHubId) continue;
        for (const row of masterRows) {
          // special_goods_rates' uniqueness is an expression index
          // (coalesce(hub_id::text,''), coalesce(route_name,'')), which
          // PostgREST's upsert onConflict (a bare column list) can't
          // target -- routed through a dedicated RPC that does a raw
          // `INSERT ... ON CONFLICT (<same expressions>) DO UPDATE`
          // instead, same race-proofing as the .upsert() calls elsewhere
          // in this function. See
          // supabase/migrations/20260918_special_goods_rates_lagos_sync_fix.sql.
          const { error } = await supabase.rpc('sync_special_goods_rate', {
            p_hub_id: targetHubId,
            p_content_type_id: row.content_type_id,
            p_airline: row.airline,
            p_route_name: row.route_name,
            p_min_kg: row.min_kg,
            p_max_kg: row.max_kg,
            p_rate_per_kg: row.rate_per_kg,
          });
          if (!error) syncCount++;
        }
      }
    }

    // 4. Sync flat_tier_rates
    const { data: flatRates } = await supabase
      .from('flat_tier_rates')
      .select('*')
      .in('hub_id', info.allLagosHubIds);

    if (flatRates && flatRates.length > 0) {
      const masterHubId = info.cargoStationId || info.allLagosHubIds[0];
      const masterRows = flatRates.filter(r => r.hub_id === masterHubId);

      for (const targetHubId of info.allLagosHubIds) {
        if (targetHubId === masterHubId) continue;
        for (const row of masterRows) {
          // upsert, not insert: two staff sessions loading the app around the
          // same time both snapshot flatRates before either has synced, so a
          // plain existence-check-then-insert races -- the second session's
          // insert of a row the first session just created 409s. onConflict
          // matches flat_tier_rates' UNIQUE(hub_id, content_type_id, airline,
          // route_name, min_kg) constraint, same fix already applied to
          // hub_airline_route_rates/hub_route_rates above.
          const { error } = await supabase.from('flat_tier_rates').upsert(
            {
              hub_id: targetHubId,
              content_type_id: row.content_type_id,
              airline: row.airline,
              route_name: row.route_name,
              min_kg: row.min_kg,
              max_kg: row.max_kg,
              flat_amount: row.flat_amount,
            },
            { onConflict: 'hub_id,content_type_id,airline,route_name,min_kg' }
          );
          if (!error) syncCount++;
        }
      }
    }

    // 5. Sync size_tier_rates
    const { data: sizeRates } = await supabase
      .from('size_tier_rates')
      .select('*')
      .in('hub_id', info.allLagosHubIds);

    if (sizeRates && sizeRates.length > 0) {
      const masterHubId = info.cargoStationId || info.allLagosHubIds[0];
      const masterRows = sizeRates.filter(r => r.hub_id === masterHubId);

      for (const targetHubId of info.allLagosHubIds) {
        if (targetHubId === masterHubId) continue;
        for (const row of masterRows) {
          // Same race fix as flat_tier_rates above -- onConflict matches
          // size_tier_rates' UNIQUE(hub_id, content_type_id, airline,
          // route_name, min_inches) constraint.
          const { error } = await supabase.from('size_tier_rates').upsert(
            {
              hub_id: targetHubId,
              content_type_id: row.content_type_id,
              airline: row.airline,
              route_name: row.route_name,
              min_inches: row.min_inches,
              max_inches: row.max_inches,
              flat_amount: row.flat_amount,
            },
            { onConflict: 'hub_id,content_type_id,airline,route_name,min_inches' }
          );
          if (!error) syncCount++;
        }
      }
    }

    return { success: true, count: syncCount, message: `Successfully synchronized ${syncCount} price configuration records across Lagos stations.` };
  } catch (err: any) {
    return { success: false, count: 0, message: err?.message || 'Failed to sync Lagos rates' };
  }
}
