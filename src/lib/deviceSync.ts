import { db } from './db';
import { supabase } from './supabase';

export interface PendingSyncSummary {
  pending_total: number;
  pending_by_table: Record<string, number>;
  quarantined_count: number;
  oldest_pending_at: string | null;
}

export interface DeviceSyncStatusRow {
  device_id: string;
  hub_id: string | null;
  last_staff_id: string | null;
  pending_total: number;
  pending_by_table: Record<string, number> | null;
  quarantined_count: number;
  oldest_pending_at: string | null;
  last_seen_at: string;
  last_successful_sync_at: string | null;
  // Resolved display fields
  hub_name?: string;
  hub_code?: string;
  staff_name?: string;
  staff_email?: string;
}

export type DeviceHealthStatus = 'red' | 'amber' | 'green';

export interface DeviceEvaluation {
  status: DeviceHealthStatus;
  reasons: string[];
}

export const QUARANTINED_TABLES = ['cargo_entries', 'manifests', 'marketing_entries', 'package_entries'] as const;

export const DEVICE_ID_STORAGE_KEY = 'ehi_device_id';
export const LAST_SUCCESSFUL_SYNC_KEY = 'ehi_last_successful_sync_at';
export const HEARTBEAT_THROTTLE_MS = 90_000; // At most once per 90 seconds

let cachedDeviceId: string | null = null;
let lastHeartbeatSentAt = 0;
let heartbeatTrailingTimer: ReturnType<typeof setTimeout> | null = null;
let lastSuccessfulSyncAtMemo: string | null = null;

/**
 * Resets in-memory cached state (useful for unit testing).
 */
export function _resetDeviceSyncStateForTesting(): void {
  cachedDeviceId = null;
  lastHeartbeatSentAt = 0;
  if (heartbeatTrailingTimer) {
    clearTimeout(heartbeatTrailingTimer);
    heartbeatTrailingTimer = null;
  }
  lastSuccessfulSyncAtMemo = null;
}

/**
 * Stable device ID stored in Dexie (and synced to localStorage).
 * Treats a missing ID as a new device.
 */
export async function getDeviceId(database: typeof db = db): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  // 1. Try Dexie first
  try {
    if (database.device_meta) {
      const meta = await database.device_meta.get('device_id');
      if (meta?.value && meta.value.trim().length > 0) {
        cachedDeviceId = meta.value.trim();
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(DEVICE_ID_STORAGE_KEY, cachedDeviceId);
          }
        } catch {}
        return cachedDeviceId;
      }
    }
  } catch {
    // Dexie may be unavailable or running in a headless test
  }

  // 2. Try localStorage if Dexie was empty
  let localId: string | null = null;
  try {
    if (typeof localStorage !== 'undefined') {
      localId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    }
  } catch {}

  if (localId && localId.trim().length > 0) {
    cachedDeviceId = localId.trim();
    try {
      if (database.device_meta) {
        await database.device_meta.put({ key: 'device_id', value: cachedDeviceId });
      }
    } catch {}
    return cachedDeviceId;
  }

  // 3. Missing ID: treat as a brand new device!
  const newId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'dev_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now().toString(36);

  cachedDeviceId = newId;

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, newId);
    }
  } catch {}

  try {
    if (database.device_meta) {
      await database.device_meta.put({ key: 'device_id', value: newId });
    }
  } catch {}

  return newId;
}

/**
 * Calculates pending summary:
 * pending = sync_queue rows (synced=0) + records quarantined by sync.ts (synced=2 in their own tables),
 * broken down per table, plus the oldest pending timestamp across all of them.
 */
export async function getPendingSyncSummary(database: any = db): Promise<PendingSyncSummary> {
  const pendingByTable: Record<string, number> = {};
  let quarantinedCount = 0;
  let oldestPendingTime: number | null = null;

  // 1. sync_queue rows pending sync (synced === 0)
  try {
    let queueRows: Array<{ table_name?: string; created_at?: string; synced?: number }> = [];
    if (database?.sync_queue) {
      if (typeof database.sync_queue.where === 'function') {
        queueRows = await database.sync_queue.where('synced').equals(0).toArray().catch(() => []);
      } else if (typeof database.sync_queue.toArray === 'function') {
        const all = await database.sync_queue.toArray().catch(() => []);
        queueRows = all.filter((r: any) => r.synced === 0);
      }
    }

    for (const item of queueRows) {
      const table = item.table_name || 'unknown';
      pendingByTable[table] = (pendingByTable[table] || 0) + 1;

      if (item.created_at) {
        const t = new Date(item.created_at).getTime();
        if (!isNaN(t)) {
          if (oldestPendingTime === null || t < oldestPendingTime) {
            oldestPendingTime = t;
          }
        }
      }
    }
  } catch (err) {
    console.warn('getPendingSyncSummary: error reading sync_queue', err);
  }

  // 2. Quarantined records in their own tables (synced === 2)
  for (const table of QUARANTINED_TABLES) {
    try {
      const tableObj = database?.[table];
      if (!tableObj) continue;

      let quarantinedRows: Array<{ id?: string; created_at?: string; synced?: number; data?: any }> = [];
      if (typeof tableObj.where === 'function') {
        quarantinedRows = await tableObj.where('synced').equals(2).toArray().catch(() => []);
      } else if (typeof tableObj.toArray === 'function') {
        const all = await tableObj.toArray().catch(() => []);
        quarantinedRows = all.filter((r: any) => r.synced === 2);
      }

      const count = quarantinedRows.length;
      if (count > 0) {
        quarantinedCount += count;
        pendingByTable[table] = (pendingByTable[table] || 0) + count;

        for (const row of quarantinedRows) {
          const ts = row.created_at || row.data?.created_at;
          if (ts) {
            const t = new Date(ts).getTime();
            if (!isNaN(t)) {
              if (oldestPendingTime === null || t < oldestPendingTime) {
                oldestPendingTime = t;
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn(`getPendingSyncSummary: error reading ${table}`, err);
    }
  }

  const pendingTotal = Object.values(pendingByTable).reduce((acc, curr) => acc + curr, 0);

  return {
    pending_total: pendingTotal,
    pending_by_table: pendingByTable,
    quarantined_count: quarantinedCount,
    oldest_pending_at: oldestPendingTime !== null ? new Date(oldestPendingTime).toISOString() : null,
  };
}

/**
 * Checks whether a given timestamp falls within 07:00 - 20:00 Africa/Lagos time (UTC+1).
 */
export function isLagosBusinessHours(date: Date = new Date()): boolean {
  try {
    const hourStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Lagos',
      hour: 'numeric',
      hour12: false,
    }).format(date);
    const hour = parseInt(hourStr, 10);
    return hour >= 7 && hour < 20;
  } catch {
    // Fallback: Africa/Lagos is UTC+1 (no daylight saving time)
    const utcHour = date.getUTCHours();
    const lagosHour = (utcHour + 1) % 24;
    return lagosHour >= 7 && lagosHour < 20;
  }
}

/**
 * Evaluates health status for a device:
 * - Red if last_seen_at is over 2 hours old during 07:00-20:00 Lagos time OR oldest pending is over 4 hours old
 * - Amber if pending > 0
 * - Green otherwise
 */
export function evaluateDeviceStatus(
  device: DeviceSyncStatusRow,
  now: Date = new Date()
): DeviceEvaluation {
  const reasons: string[] = [];
  const nowMs = now.getTime();

  // 1. Red check: last_seen_at is over 2 hours old during 07:00-20:00 Lagos time
  const inBusinessHours = isLagosBusinessHours(now);
  const lastSeenMs = device.last_seen_at ? new Date(device.last_seen_at).getTime() : 0;
  const lastSeenAgeMs = nowMs - lastSeenMs;
  const isLastSeenStale = inBusinessHours && (lastSeenAgeMs > 2 * 60 * 60 * 1000);

  if (isLastSeenStale) {
    const hoursAgo = (lastSeenAgeMs / (60 * 60 * 1000)).toFixed(1);
    reasons.push(`Inactive for ${hoursAgo}h during Lagos business hours (07:00-20:00)`);
  }

  // 2. Red check: oldest pending is over 4 hours old
  let isOldestPendingStale = false;
  if (device.pending_total > 0 && device.oldest_pending_at) {
    const oldestPendingMs = new Date(device.oldest_pending_at).getTime();
    if (!isNaN(oldestPendingMs)) {
      const oldestPendingAgeMs = nowMs - oldestPendingMs;
      if (oldestPendingAgeMs > 4 * 60 * 60 * 1000) {
        isOldestPendingStale = true;
        const hoursAgo = (oldestPendingAgeMs / (60 * 60 * 1000)).toFixed(1);
        reasons.push(`Oldest pending record is ${hoursAgo}h old (>4h limit)`);
      }
    }
  }

  if (isLastSeenStale || isOldestPendingStale) {
    return { status: 'red', reasons };
  }

  // 3. Amber check: pending > 0
  if (device.pending_total > 0) {
    reasons.push(`${device.pending_total} record${device.pending_total === 1 ? '' : 's'} pending sync`);
    return { status: 'amber', reasons };
  }

  return { status: 'green', reasons: ['In sync'] };
}

/**
 * Internal heartbeat invocation to report_device_sync_status RPC.
 */
async function sendHeartbeatNow(options?: { lastSuccessfulSyncAt?: string; hubId?: string }): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return; // Heartbeat requires an active authenticated staff session
    }

    const deviceId = await getDeviceId();
    const summary = await getPendingSyncSummary();

    let lastSync = options?.lastSuccessfulSyncAt || lastSuccessfulSyncAtMemo;
    if (!lastSync) {
      try {
        if (typeof localStorage !== 'undefined') {
          lastSync = localStorage.getItem(LAST_SUCCESSFUL_SYNC_KEY);
        }
      } catch {}
    }

    if (options?.lastSuccessfulSyncAt) {
      lastSuccessfulSyncAtMemo = options.lastSuccessfulSyncAt;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(LAST_SUCCESSFUL_SYNC_KEY, options.lastSuccessfulSyncAt);
        }
        if (db.device_meta) {
          await db.device_meta.put({ key: 'last_successful_sync_at', value: options.lastSuccessfulSyncAt });
        }
      } catch {}
    }

    const hubId = options?.hubId || session.user.user_metadata?.hub_id || null;

    const { error } = await supabase.rpc('report_device_sync_status', {
      p_device_id: deviceId,
      p_hub_id: hubId,
      p_pending_total: summary.pending_total,
      p_pending_by_table: summary.pending_by_table,
      p_quarantined_count: summary.quarantined_count,
      p_oldest_pending_at: summary.oldest_pending_at,
      p_last_successful_sync_at: lastSync || null,
    });

    if (error) {
      console.warn('report_device_sync_status RPC error:', error.message || error);
    }
  } catch (err) {
    console.warn('Heartbeat execution error:', err);
  }
}

/**
 * Heartbeat trigger: on app open, when coming back online, and after each sync attempt.
 * Strictly throttled to at most once per 90s.
 * Trailing edge ensures the newest sync/offline status is delivered after cooldown.
 */
export async function reportDeviceSyncHeartbeat(options?: {
  lastSuccessfulSyncAt?: string;
  hubId?: string;
  force?: boolean;
}): Promise<void> {
  if (options?.lastSuccessfulSyncAt) {
    lastSuccessfulSyncAtMemo = options.lastSuccessfulSyncAt;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LAST_SUCCESSFUL_SYNC_KEY, options.lastSuccessfulSyncAt);
      }
    } catch {}
  }

  const now = Date.now();
  const elapsed = now - lastHeartbeatSentAt;

  if (options?.force || elapsed >= HEARTBEAT_THROTTLE_MS) {
    if (heartbeatTrailingTimer) {
      clearTimeout(heartbeatTrailingTimer);
      heartbeatTrailingTimer = null;
    }
    lastHeartbeatSentAt = now;
    await sendHeartbeatNow(options);
    return;
  }

  // Throttled: schedule a trailing execution so the latest pending counts aren't dropped
  if (!heartbeatTrailingTimer) {
    const remainingDelay = Math.max(1000, HEARTBEAT_THROTTLE_MS - elapsed);
    heartbeatTrailingTimer = setTimeout(async () => {
      heartbeatTrailingTimer = null;
      lastHeartbeatSentAt = Date.now();
      await sendHeartbeatNow(options);
    }, remainingDelay);
  }
}
