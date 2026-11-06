import { supabase } from './supabase';

export interface LagosHubsInfo {
  headOfficeId: string | null;
  cargoStationId: string | null;
  allLagosHubIds: string[];
}

export interface LagosSyncResult {
  success: boolean;
  count: number;
  failed: number;
  message?: string;
}

export interface SelectableHub {
  id: string;
  name: string;
  code?: string;
  state?: string;
}

export type RateSyncTable =
  | 'hub_route_rates'
  | 'hub_airline_route_rates'
  | 'special_goods_rates'
  | 'flat_tier_rates'
  | 'size_tier_rates';

export interface DeleteLagosRateParams {
  table: RateSyncTable;
  sourceHubId: string | null | undefined;
  keys: {
    route_name?: string | null;
    airline?: string;
    content_type_id?: string;
    min_kg?: number;
    min_inches?: number;
  };
}

let cachedLagosInfo: LagosHubsInfo | null = null;
let cachedAt = 0;
// Bounds how long a hub rename/creation/merge made elsewhere in the app can
// stay invisible to this module in a long-running session -- there was
// previously no invalidation at all, so a change was only ever picked up
// after a full page reload.
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getLagosHubInfo(): Promise<LagosHubsInfo> {
  if (cachedLagosInfo && (Date.now() - cachedAt) < CACHE_TTL_MS) return cachedLagosInfo;

  try {
    // Explicit order -- allLagosHubIds[0]/[1] (the fallback below) is a
    // stable, reproducible pick with this, instead of whatever row order
    // Postgres happens to return absent an ORDER BY (not guaranteed, and
    // could silently swap which Lagos hub acts as "master" for
    // syncLagosRates() between calls/sessions).
    const { data: hubs } = await supabase.from('hubs').select('id, name, code').order('name');
    if (!hubs || hubs.length === 0) {
      return { headOfficeId: null, cargoStationId: null, allLagosHubIds: [] };
    }

    let headOfficeId: string | null = null;
    let cargoStationId: string | null = null;
    const allLagosHubIds: string[] = [];

    hubs.forEach((h: any) => {
      const nameNorm = (h.name || '').toLowerCase();
      const codeNorm = (h.code || '').toLowerCase();
      // 'lagos' (or the LOS code) must actually appear -- the previous
      // version also matched ANY hub coded "HQ" or whose name contained
      // "head office"/"cargo station" with no requirement that "lagos"
      // appear anywhere, so a future hub like "Abuja Head Office" would
      // have been misclassified as a Lagos hub: its transactions would
      // leak into Lagos-scoped views, and syncLagosRates() would silently
      // overwrite its real pricing with Lagos's rates.
      const isLagos = nameNorm.includes('lagos') || codeNorm === 'los';

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
    cachedAt = Date.now();
    return cachedLagosInfo;
  } catch {
    return { headOfficeId: null, cargoStationId: null, allLagosHubIds: [] };
  }
}

// Call after creating/renaming/merging a hub so this module doesn't keep
// serving a stale classification for the rest of a long-running session.
export function invalidateLagosHubCache(): void {
  cachedLagosInfo = null;
  cachedAt = 0;
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
 * Returns the list of hubs a user is authorized to select for rate management.
 * - super_admin / admin: all active hubs.
 * - accountant: own hub and sibling hubs (same state or equivalent Lagos hubs).
 * - other roles: empty array (not authorized to manage rates).
 */
export async function getSelectableHubsForUser(user: { role: string; hub_id?: string; hub?: string }): Promise<SelectableHub[]> {
  if (user.role === 'super_admin' || user.role === 'admin') {
    const { data } = await supabase.from('hubs').select('id, name, code, state').eq('active', true).order('name');
    return (data || []) as SelectableHub[];
  }

  if (user.role === 'accountant') {
    const { data: allHubs } = await supabase.from('hubs').select('id, name, code, state').eq('active', true).order('name');
    if (!allHubs || allHubs.length === 0) return [];

    const userHub = allHubs.find((h: any) =>
      (user.hub_id && h.id === user.hub_id) ||
      (user.hub && (h.name || '').toLowerCase() === user.hub.toLowerCase())
    );
    const userState = (userHub?.state || '').trim().toLowerCase();
    const lagosInfo = await getLagosHubInfo();
    const isLagosUser = user.hub_id
      ? lagosInfo.allLagosHubIds.includes(user.hub_id)
      : Boolean(user.hub && user.hub.toLowerCase().includes('lagos'));

    return (allHubs as SelectableHub[]).filter((h) => {
      if (user.hub_id && h.id === user.hub_id) return true;
      if (userHub && h.id === userHub.id) return true;
      if (isLagosUser && lagosInfo.allLagosHubIds.includes(h.id)) return true;
      if (userState && (h.state || '').trim().toLowerCase() === userState) return true;
      return false;
    });
  }

  return [];
}

/**
 * Synchronizes all rate configuration tables (hub cargo rates, special goods rates,
 * flat tier rates, size tier rates, corporate B2B rates) between EHI Head Office Lagos
 * and Lagos Air Cargo Station so that both stations share identical pricing.
 *
 * @param sourceHubId Optional ID of the hub that was just edited/saved. When provided
 * and that hub is a Lagos hub, it is used as master to copy rows onto the other Lagos
 * hub(s). If omitted or not a Lagos hub, falls back to the canonical cargo station master.
 */
export async function syncLagosRates(sourceHubId?: string | null): Promise<LagosSyncResult> {
  try {
    const info = await getLagosHubInfo();
    if (!info.allLagosHubIds || info.allLagosHubIds.length < 2) {
      return { success: true, count: 0, failed: 0, message: 'Fewer than 2 Lagos hubs found; nothing to sync.' };
    }

    let masterHubId: string;
    if (sourceHubId && info.allLagosHubIds.includes(sourceHubId)) {
      masterHubId = sourceHubId;
    } else {
      masterHubId = info.cargoStationId || info.allLagosHubIds[0];
    }

    const targetHubIds = info.allLagosHubIds.filter((id) => id !== masterHubId);
    if (targetHubIds.length === 0) {
      return { success: true, count: 0, failed: 0, message: 'No target Lagos hubs to sync.' };
    }

    let syncCount = 0;
    let failedCount = 0;
    const errorMessages: string[] = [];

    // 1. Sync hub_airline_route_rates
    const { data: airlineRates, error: airlineFetchErr } = await supabase
      .from('hub_airline_route_rates')
      .select('*')
      .eq('hub_id', masterHubId);

    if (airlineFetchErr) {
      failedCount++;
      errorMessages.push(`hub_airline_route_rates: ${airlineFetchErr.message}`);
    } else if (airlineRates && airlineRates.length > 0) {
      for (const targetHubId of targetHubIds) {
        for (const row of airlineRates) {
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
          if (error) {
            failedCount++;
            errorMessages.push(`hub_airline_route_rates: ${error.message}`);
          } else {
            syncCount++;
          }
        }
      }
    }

    // 2. Sync hub_route_rates
    const { data: routeRates, error: routeFetchErr } = await supabase
      .from('hub_route_rates')
      .select('*')
      .eq('hub_id', masterHubId);

    if (routeFetchErr) {
      failedCount++;
      errorMessages.push(`hub_route_rates: ${routeFetchErr.message}`);
    } else if (routeRates && routeRates.length > 0) {
      for (const targetHubId of targetHubIds) {
        for (const row of routeRates) {
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
          if (error) {
            failedCount++;
            errorMessages.push(`hub_route_rates: ${error.message}`);
          } else {
            syncCount++;
          }
        }
      }
    }

    // 3. Sync special_goods_rates
    const { data: specialRates, error: specialFetchErr } = await supabase
      .from('special_goods_rates')
      .select('*')
      .eq('hub_id', masterHubId);

    if (specialFetchErr) {
      failedCount++;
      errorMessages.push(`special_goods_rates: ${specialFetchErr.message}`);
    } else if (specialRates && specialRates.length > 0) {
      for (const targetHubId of targetHubIds) {
        for (const row of specialRates) {
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
            p_updated_by: row.updated_by || 'Lagos Rate Sync',
          });
          if (error) {
            failedCount++;
            errorMessages.push(`special_goods_rates: ${error.message}`);
          } else {
            syncCount++;
          }
        }
      }
    }

    // 4. Sync flat_tier_rates
    const { data: flatRates, error: flatFetchErr } = await supabase
      .from('flat_tier_rates')
      .select('*')
      .eq('hub_id', masterHubId);

    if (flatFetchErr) {
      failedCount++;
      errorMessages.push(`flat_tier_rates: ${flatFetchErr.message}`);
    } else if (flatRates && flatRates.length > 0) {
      for (const targetHubId of targetHubIds) {
        for (const row of flatRates) {
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
              updated_by: row.updated_by || 'Lagos Rate Sync',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'hub_id,content_type_id,airline,route_name,min_kg' }
          );
          if (error) {
            failedCount++;
            errorMessages.push(`flat_tier_rates: ${error.message}`);
          } else {
            syncCount++;
          }
        }
      }
    }

    // 5. Sync size_tier_rates
    const { data: sizeRates, error: sizeFetchErr } = await supabase
      .from('size_tier_rates')
      .select('*')
      .eq('hub_id', masterHubId);

    if (sizeFetchErr) {
      failedCount++;
      errorMessages.push(`size_tier_rates: ${sizeFetchErr.message}`);
    } else if (sizeRates && sizeRates.length > 0) {
      for (const targetHubId of targetHubIds) {
        for (const row of sizeRates) {
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
              updated_by: row.updated_by || 'Lagos Rate Sync',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'hub_id,content_type_id,airline,route_name,min_inches' }
          );
          if (error) {
            failedCount++;
            errorMessages.push(`size_tier_rates: ${error.message}`);
          } else {
            syncCount++;
          }
        }
      }
    }

    const success = failedCount === 0;
    const message = failedCount > 0
      ? `Sync encountered ${failedCount} error(s): ${errorMessages.slice(0, 3).join('; ')}${errorMessages.length > 3 ? '...' : ''}`
      : `Successfully synchronized ${syncCount} price configuration records across Lagos stations.`;

    return {
      success,
      count: syncCount,
      failed: failedCount,
      message,
    };
  } catch (err: any) {
    return {
      success: false,
      count: 0,
      failed: 1,
      message: err?.message || 'Failed to sync Lagos rates',
    };
  }
}

/**
 * Propagates a rate deletion performed on a source Lagos hub onto all other Lagos hubs.
 * If the source hub is not a Lagos hub, no deletion is attempted.
 * If the matching sibling row is already gone, that counts as success.
 */
export async function deleteLagosRateRow(params: DeleteLagosRateParams): Promise<LagosSyncResult> {
  const { table, sourceHubId, keys } = params;
  if (!sourceHubId) {
    return { success: true, count: 0, failed: 0, message: 'No source hub; nothing to delete on siblings.' };
  }

  try {
    const info = await getLagosHubInfo();
    // Do not delete rows on non-Lagos hubs.
    if (!info.allLagosHubIds.includes(sourceHubId)) {
      return { success: true, count: 0, failed: 0, message: 'Source hub is not a Lagos hub; no sibling deletes.' };
    }

    const targetHubIds = info.allLagosHubIds.filter((id) => id !== sourceHubId);
    if (targetHubIds.length === 0) {
      return { success: true, count: 0, failed: 0, message: 'No sibling Lagos hubs found.' };
    }

    let deletedCount = 0;
    let failedCount = 0;
    const errorMessages: string[] = [];

    for (const targetHubId of targetHubIds) {
      let query = supabase.from(table).delete().eq('hub_id', targetHubId);

      if (table === 'hub_route_rates') {
        if (keys.route_name) {
          query = query.eq('route_name', keys.route_name);
        }
      } else if (table === 'hub_airline_route_rates') {
        if (keys.airline) query = query.eq('airline', keys.airline);
        if (keys.route_name) query = query.eq('route_name', keys.route_name);
      } else if (table === 'special_goods_rates') {
        if (keys.content_type_id) query = query.eq('content_type_id', keys.content_type_id);
        if (keys.airline) query = query.eq('airline', keys.airline);
        if (keys.route_name) {
          query = query.eq('route_name', keys.route_name);
        } else {
          query = query.is('route_name', null);
        }
        if (keys.min_kg != null) query = query.eq('min_kg', keys.min_kg);
      } else if (table === 'flat_tier_rates') {
        if (keys.content_type_id) query = query.eq('content_type_id', keys.content_type_id);
        if (keys.airline) query = query.eq('airline', keys.airline);
        if (keys.route_name) query = query.eq('route_name', keys.route_name);
        if (keys.min_kg != null) query = query.eq('min_kg', keys.min_kg);
      } else if (table === 'size_tier_rates') {
        if (keys.content_type_id) query = query.eq('content_type_id', keys.content_type_id);
        if (keys.airline) query = query.eq('airline', keys.airline);
        if (keys.route_name) query = query.eq('route_name', keys.route_name);
        if (keys.min_inches != null) query = query.eq('min_inches', keys.min_inches);
      }

      const { error } = await query;
      if (error) {
        failedCount++;
        errorMessages.push(`${table}: ${error.message}`);
      } else {
        deletedCount++;
      }
    }

    const success = failedCount === 0;
    const message = failedCount > 0
      ? `Failed to delete from sibling hub: ${errorMessages.slice(0, 3).join('; ')}${errorMessages.length > 3 ? '...' : ''}`
      : `Deleted matching rate from sibling Lagos hub(s).`;

    return { success, count: deletedCount, failed: failedCount, message };
  } catch (err: any) {
    return {
      success: false,
      count: 0,
      failed: 1,
      message: err?.message || 'Failed to delete Lagos rate on sibling hub',
    };
  }
}
