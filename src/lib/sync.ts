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

// TripPing's local (Dexie) shape is camelCase (tripId/timestamp/latitude/
// longitude) to match lib/types.ts, but public.trip_pings uses trip_id/
// created_at/lat/lng and has no speed column at all -- upserting the raw
// local object verbatim would fail with "could not find column 'tripId'
// in schema cache" even after the id is a valid uuid.
function tripPingToSupabaseRow(ping: Record<string, any>): Record<string, unknown> {
  return {
    id: ping.id,
    trip_id: ping.tripId,
    lat: ping.latitude,
    lng: ping.longitude,
    accuracy: ping.accuracy,
    created_at: ping.timestamp,
  };
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

  // Add to sync queue if not already queued with same record_id
  const existingQueue = await db.sync_queue.where('record_id').equals(payload.id as string).first();
  if (!existingQueue) {
    await db.sync_queue.add({
      table_name: tableName,
      record_id: payload.id as string,
      action: 'INSERT',
      payload,
      synced: 0,
      created_at: new Date().toISOString(),
    });
  }

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

export async function getUnsyncedLocalTransactions(): Promise<{ transactions: any[]; expenses: any[] }> {
  try {
    const [cargo, baggage, marketing, packages, queue] = await Promise.all([
      db.cargo_entries.where('synced').equals(0).toArray().catch(() => []),
      db.manifests.where('synced').equals(0).toArray().catch(() => []),
      db.marketing_entries.where('synced').equals(0).toArray().catch(() => []),
      db.package_entries.where('synced').equals(0).toArray().catch(() => []),
      db.sync_queue.where('synced').equals(0).toArray().catch(() => []),
    ]);

    const txs: any[] = [];
    const expenses: any[] = [];

    for (const q of queue) {
      if (q.table_name === 'expenses') {
        expenses.push({
          id: q.record_id || (q.payload as any).id,
          type: (q.payload as any).category || 'General',
          amount: (q.payload as any).amount || 0,
          description: (q.payload as any).description || '',
          time: q.created_at,
          created_at: q.created_at,
          status: 'pending',
          logged_by: (q.payload as any).logged_by,
        });
      }
    }

    cargo.forEach(item => {
      const r = item.data as any;
      if (r) {
        txs.push({
          id: r.id || r.entry_ref,
          name: r.consignee_name || 'Cargo',
          detail: `${r.airline || ''} · ${r.awb_tag_number || ''} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg · ${r.route || ''} · ${r.content_type || 'Package'}`,
          amount: r.amount || 0,
          mode: r.receipt_mode || 'Cash',
          time: new Date(item.created_at || Date.now()).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
          type: 'cargo',
          status: r.status || 'Intake',
          awb_tag_number: r.awb_tag_number,
          kg: r.total_kg,
          pieces: r.total_pcs,
          pickupPin: r.pickup_pin || undefined,
          created_at: item.created_at || r.created_at,
          airline: r.airline,
          bank: r.bank,
          route: r.route,
          hub_id: r.hub_id,
          contentType: r.content_type,
          remarks: r.remark || undefined,
          amountPaid: r.amount_paid || 0,
          paymentHistory: r.payment_history || [],
          paymentConfirmed: r.payment_confirmed,
          wallet_id: r.wallet_id || undefined,
          wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
        });
      }
    });

    baggage.forEach(item => {
      const r = item.data as any;
      if (r) {
        txs.push({
          id: r.id || r.transaction_id,
          name: r.passenger_name || 'Baggage Passenger',
          detail: `${r.flight_no || ''} · ${r.destination || ''} · ${r.total_pcs || 1}pcs · +${r.excess_kg || 0}kg excess`,
          amount: r.amount || 0,
          mode: r.payment_mode || 'POS',
          time: new Date(item.created_at || Date.now()).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
          type: 'baggage',
          status: 'Delivered',
          created_at: item.created_at || r.created_at,
          bank: r.bank,
          hub_id: r.hub_id,
          airline: r.airline,
          destination: r.destination,
          excessKg: r.excess_kg,
          totalKg: r.total_kg,
          flight: r.flight_no,
          pnr: r.pnr || undefined,
          kg: r.excess_kg,
          pieces: r.total_pcs,
          amountPaid: r.amount_paid || 0,
          paymentHistory: r.payment_history || [],
          paymentConfirmed: r.payment_confirmed,
          wallet_id: r.wallet_id || undefined,
          wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
        });
      }
    });

    marketing.forEach(item => {
      const r = item.data as any;
      if (r) {
        txs.push({
          id: r.id || r.entry_ref,
          awb_tag_number: r.awb_tag_number || undefined,
          name: r.customer_name || 'Customer',
          detail: `${r.route || ''} · ${r.qty_big_bag || 0}BB ${r.qty_med_bag || 0}MB ${r.qty_small_bag || 0}SB`,
          amount: r.amount_paid || 0,
          mode: r.payment_mode || 'Cash',
          time: new Date(item.created_at || Date.now()).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
          type: 'marketing',
          status: 'Intake',
          created_at: item.created_at || r.created_at,
          hub_id: r.hub_id,
          route: r.route,
          wallet_id: r.wallet_id || undefined,
          wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
        });
      }
    });

    packages.forEach(item => {
      const r = item.data as any;
      if (r) {
        txs.push({
          id: r.id || r.entry_ref,
          name: r.customer_name || 'Customer',
          detail: `${r.destination || ''} · ${r.content_type || 'Package'} · ${r.contents || ''}`,
          amount: r.amount || 0,
          mode: r.payment_mode || 'Cash',
          time: new Date(item.created_at || Date.now()).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
          type: 'package',
          status: r.status || 'Intake',
          created_at: item.created_at || r.created_at,
          hub_id: r.hub_id,
          destination: r.destination,
          contents: r.contents,
          wallet_id: r.wallet_id || undefined,
          wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
        });
      }
    });

    return { transactions: txs, expenses };
  } catch (err) {
    console.error('Failed to read unsynced local transactions:', err);
    return { transactions: [], expenses: [] };
  }
}

export async function processSyncQueue(): Promise<number> {
  const pending = await db.sync_queue.where('synced').equals(0).toArray();
  let synced = 0;

  for (const item of pending) {
    try {
      let supabasePayload = item.table_name === 'proof_of_delivery'
        ? podToSupabaseRow(item.payload as unknown as ProofOfDelivery)
        : item.table_name === 'trip_pings'
        ? tripPingToSupabaseRow(item.payload as any)
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
        if (['cargo_entries', 'manifests', 'marketing_entries', 'package_entries'].includes(item.table_name)) {
          const recId = item.record_id || (item.payload as any).id || (item.payload as any).entry_ref || (item.payload as any).transaction_id;
          if (recId) {
            try {
              await (db[item.table_name as keyof typeof db] as Dexie.Table).where('id').equals(recId).modify({ synced: 1 });
            } catch {}
          }
        }
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

