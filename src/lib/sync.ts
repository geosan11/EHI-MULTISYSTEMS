import { db } from './db';
import { supabase } from './supabase';
import Dexie from 'dexie';
import { appLogger } from './logger';
import type { ProofOfDelivery } from './types';

// ProofOfDelivery is stored locally with camelCase fields (see lib/types.ts)
// but the Supabase table uses snake_case columns — convert between the two
// rather than renaming one side and rippling changes through every POD screen.
function podToSupabaseRow(pod: ProofOfDelivery): Record<string, unknown> {
  return {
    id: pod.id,
    awb_number: pod.awbNumber,
    consignee_name: pod.consigneeName,
    delivered_by: pod.deliveredBy,
    received_by_name: pod.receivedByName,
    received_by_phone: pod.receivedByPhone,
    received_by_id_type: pod.receivedByIdType,
    received_by_id_number: pod.receivedByIdNumber,
    signature_data: pod.signatureData,
    photo_data: pod.photoData,
    delivered_at: pod.deliveredAt,
    hub_name: pod.hubName,
    notes: pod.notes,
    gps_latitude: pod.gpsLatitude,
    gps_longitude: pod.gpsLongitude,
  };
}

function supabaseRowToPod(row: Record<string, any>): ProofOfDelivery {
  return {
    id: row.id,
    awbNumber: row.awb_number,
    consigneeName: row.consignee_name,
    deliveredBy: row.delivered_by,
    receivedByName: row.received_by_name,
    receivedByPhone: row.received_by_phone ?? undefined,
    receivedByIdType: row.received_by_id_type ?? undefined,
    receivedByIdNumber: row.received_by_id_number ?? undefined,
    signatureData: row.signature_data,
    photoData: row.photo_data ?? undefined,
    deliveredAt: row.delivered_at,
    hubName: row.hub_name,
    notes: row.notes ?? undefined,
    gpsLatitude: row.gps_latitude ?? undefined,
    gpsLongitude: row.gps_longitude ?? undefined,
  };
}

// Fetches POD records visible to this user: Supabase (cross-device/cross-hub,
// scoped to the user's own hub unless admin) merged with whatever's on this
// device's local Dexie table so a just-captured record shows up immediately
// even before its background sync to Supabase completes.
export async function fetchProofOfDeliveryRecords(
  hubName: string,
  isAdmin: boolean
): Promise<ProofOfDelivery[]> {
  const [localData, supaRes] = await Promise.all([
    db.proof_of_delivery.orderBy('deliveredAt').reverse().toArray(),
    (() => {
      let q = supabase.from('proof_of_delivery').select('*').order('delivered_at', { ascending: false }).limit(300);
      if (!isAdmin) q = q.eq('hub_name', hubName) as any;
      return q;
    })(),
  ]);

  const merged = new Map<string, ProofOfDelivery>();
  (supaRes.data || []).forEach(row => merged.set(row.id, supabaseRowToPod(row)));
  // Local copies win — a record captured seconds ago on this device is more
  // current than whatever (possibly nothing yet) has reached Supabase.
  localData.forEach(pod => merged.set(pod.id, pod));

  return Array.from(merged.values())
    .sort((a, b) => new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime());
}

// Proof of Delivery records are saved to the local Dexie table first (so
// signature capture always works offline and PODLog can always show them on
// this device), then upserted to Supabase so the record is visible from any
// device/hub — not just the one that captured the signature. On failure this
// queues silently for the existing background retry (processSyncQueue runs
// on reconnect and every 60s from EHIApp) instead of surfacing an error to
// the staff member who just captured the signature.
export async function syncProofOfDelivery(pod: ProofOfDelivery): Promise<void> {
  try {
    const { error } = await supabase
      .from('proof_of_delivery')
      .upsert(podToSupabaseRow(pod), { onConflict: 'id' });
    if (error) throw error;
  } catch (err) {
    await db.sync_queue.add({
      table_name: 'proof_of_delivery',
      record_id: pod.id,
      action: 'INSERT',
      payload: pod as unknown as Record<string, unknown>,
      synced: 0,
      created_at: new Date().toISOString(),
    });
    appLogger.log('ERROR', 'SYNC', `POD upsert failed, queued for retry: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function cleanupOldQueue(): Promise<void> {
  // Only prune items that already made it to Supabase (synced: 1).
  // Deleting unsynced (synced: 0) items regardless of age was silently
  // discarding real, never-uploaded records after a week.
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  await db.sync_queue
    .where('created_at')
    .below(sevenDaysAgo)
    .and(item => item.synced === 1)
    .delete();
}

// manifests has no free_allowance_kg/rate_per_kg columns -- a caller
// briefly wrote them here (fixed since), so any record queued before that
// fix still carries them baked into its stored payload. Without this,
// those specific queued records retry this upsert forever, 400ing every
// time, with no way to self-correct short of a manual database fix.
// Stripping it here on every write means an already-stuck item heals on
// its very next retry.
function sanitizeManifestsPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const { free_allowance_kg, rate_per_kg, ...rest } = payload;
  return rest;
}

export async function writeWithOfflineSupport(
  tableName: 'manifests' | 'marketing_entries' | 'cargo_entries' | 'package_entries' | 'expenses',
  payload: Record<string, unknown>
): Promise<{ success: boolean; offline: boolean; error?: any }> {
  const record = { id: payload.id as string, data: payload, synced: 0 as const, created_at: new Date().toISOString() };

  // Always write to local IndexedDB first (instant) — expenses has no local mirror table
  if (tableName !== 'expenses') {
    await (db[tableName] as Dexie.Table).put(record);
  }

  // Add to sync queue
  await db.sync_queue.add({
    table_name: tableName,
    record_id: payload.id as string,
    action: 'INSERT',
    payload,
    synced: 0,
    created_at: new Date().toISOString(),
  });

  // Attempt immediate Supabase insert
  try {
    let supabasePayload = { ...payload };
    // Remove the client-side ID since Supabase uses a UUID for the primary key.
    // Our client-side ID is stored in entry_ref or transaction_id
    if (tableName === 'marketing_entries' || tableName === 'cargo_entries' || tableName === 'manifests' || tableName === 'package_entries') {
      delete supabasePayload.id;
    }
    if (tableName === 'manifests') {
      supabasePayload = sanitizeManifestsPayload(supabasePayload);
    }

    // expenses uses its own id column, others use entry_ref / transaction_id
    const onConflictColumn =
      tableName === 'manifests'      ? 'transaction_id' :
      tableName === 'expenses'       ? 'id'             :
      'entry_ref';
    const { error } = await supabase.from(tableName).upsert(supabasePayload, { onConflict: onConflictColumn });
    if (!error) {
      await db.sync_queue.where('record_id').equals(payload.id as string).delete();
      if (tableName !== 'expenses') {
        await (db[tableName] as Dexie.Table).where('id').equals(payload.id as string).modify({ synced: 1 });
      }
      return { success: true, offline: false };
    } else {
      console.error('Supabase insert error (falling back to offline queue):', error);
      const errMsg = error.message || error.details || JSON.stringify(error);
      appLogger.log('ERROR', 'SYNC', `Supabase upsert error on ${tableName}: ${errMsg} - Payload: ${JSON.stringify(supabasePayload)}`);
      return { success: false, offline: true, error: errMsg };
    }
  } catch (err) {
    console.error('Network exception in writeWithOfflineSupport:', err);
    appLogger.log('ERROR', 'NETWORK', `Exception in writeWithOfflineSupport: ${err instanceof Error ? err.message : String(err)}`);
    // Network unavailable — leave in queue
    return { success: false, offline: true, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function processSyncQueue(): Promise<number> {
  const pending = await db.sync_queue.where('synced').equals(0).toArray();
  let synced = 0;

  for (const item of pending) {
    try {
      let supabasePayload = item.table_name === 'proof_of_delivery'
        ? podToSupabaseRow(item.payload as unknown as ProofOfDelivery)
        : { ...(item.payload as any) };
      if (item.table_name === 'marketing_entries' || item.table_name === 'cargo_entries' || item.table_name === 'manifests' || item.table_name === 'package_entries') {
        delete supabasePayload.id;
      }
      if (item.table_name === 'manifests') {
        supabasePayload = sanitizeManifestsPayload(supabasePayload);
      }

      const onConflictColumn =
        item.table_name === 'manifests'          ? 'transaction_id' :
        item.table_name === 'expenses'           ? 'id'             :
        item.table_name === 'trip_pings'         ? 'id'             :
        item.table_name === 'proof_of_delivery'  ? 'id'             :
        'entry_ref';
      const { error } = await supabase
        .from(item.table_name)
        .upsert(supabasePayload, { onConflict: onConflictColumn });
      if (!error) {
        await db.sync_queue.delete(item.id!);
        synced++;
      } else {
        const errMsg = error.message || error.details || JSON.stringify(error);
        appLogger.log('ERROR', 'SYNC_QUEUE', `Background sync failed for ${item.table_name}: ${errMsg}`);
      }
    } catch (err) {
      appLogger.log('ERROR', 'SYNC_QUEUE', `Background sync exception for ${item.table_name}: ${err instanceof Error ? err.message : String(err)}`);
      // leave for next sync attempt
    }
  }
  return synced;
}
