import { db } from './db';
import { supabase } from './supabase';
import Dexie from 'dexie';
import { appLogger } from './logger';

export async function cleanupOldQueue(): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  await db.sync_queue
    .where('created_at')
    .below(sevenDaysAgo)
    .delete();
}

export async function writeWithOfflineSupport(
  tableName: 'shipments' | 'manifests' | 'marketing_entries' | 'cargo_entries',
  payload: Record<string, unknown>
): Promise<{ success: boolean; offline: boolean; error?: any }> {
  const record = { id: payload.id as string, data: payload, synced: 0 as const, created_at: new Date().toISOString() };

  // Always write to local IndexedDB first (instant)
  await (db[tableName] as Dexie.Table).put(record);

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
    const supabasePayload = { ...payload };
    // Remove the client-side ID since Supabase uses a UUID for the primary key.
    // Our client-side ID is stored in entry_ref or transaction_id
    if (tableName === 'marketing_entries' || tableName === 'cargo_entries' || tableName === 'manifests') {
      delete supabasePayload.id;
    }

    const onConflictColumn = tableName === 'manifests' ? 'transaction_id' : 'entry_ref';
    const { error } = await supabase.from(tableName).upsert(supabasePayload, { onConflict: onConflictColumn });
    if (!error) {
      await db.sync_queue.where('record_id').equals(payload.id as string).delete();
      await (db[tableName] as Dexie.Table).where('id').equals(payload.id as string).modify({ synced: 1 });
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

  return { success: true, offline: true };
}

export async function processSyncQueue(): Promise<number> {
  const pending = await db.sync_queue.where('synced').equals(0).toArray();
  let synced = 0;

  for (const item of pending) {
    try {
      const supabasePayload = { ...(item.payload as any) };
      if (item.table_name === 'marketing_entries' || item.table_name === 'cargo_entries' || item.table_name === 'manifests') {
        delete supabasePayload.id;
      }
      
      const { error } = await supabase
        .from(item.table_name)
        .upsert(supabasePayload, { onConflict: item.table_name === 'manifests' ? 'transaction_id' : 'entry_ref' });
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
