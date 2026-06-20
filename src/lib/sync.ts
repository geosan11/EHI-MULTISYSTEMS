import { db } from './db';
import { supabase } from './supabase';
import Dexie from 'dexie';

export async function writeWithOfflineSupport(
  tableName: 'shipments' | 'manifests' | 'marketing_entries' | 'air_consignments',
  payload: Record<string, unknown>
): Promise<{ success: boolean; offline: boolean }> {
  const record = { id: payload.id as string, data: payload, synced: false, created_at: new Date().toISOString() };

  // Always write to local IndexedDB first (instant)
  await (db[tableName] as Dexie.Table).put(record);

  // Add to sync queue
  await db.sync_queue.add({
    table_name: tableName,
    record_id: payload.id as string,
    action: 'INSERT',
    payload,
    synced: false,
    created_at: new Date().toISOString(),
  });

  // Attempt immediate Supabase insert
  try {
    const { error } = await supabase.from(tableName).insert(payload);
    if (!error) {
      await db.sync_queue.where('record_id').equals(payload.id as string).modify({ synced: true });
      await (db[tableName] as Dexie.Table).where('id').equals(payload.id as string).modify({ synced: true });
      return { success: true, offline: false };
    }
  } catch {
    // Network unavailable — leave in queue
  }

  return { success: true, offline: true };
}

export async function processSyncQueue(): Promise<number> {
  const pending = await db.sync_queue.where('synced').equals(0).toArray();
  let synced = 0;

  for (const item of pending) {
    try {
      const { error } = await supabase
        .from(item.table_name)
        .upsert(item.payload as Record<string, unknown>);

      if (!error) {
        await db.sync_queue.update(item.id!, { synced: true });
        synced++;
      }
    } catch {
      // Still offline — skip
    }
  }

  return synced;
}
