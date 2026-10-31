import { db } from './db';
import { supabase } from './supabase';

export interface PendingSyncSummary {
  pending_total: number;
  pending_by_table: Record<string, number>;
  quarantined_count: number;
  /** Local-only breakdown of quarantined (synced=2) records; not sent to the server. */
  quarantined_by_table: Record<string, number>;
  /** Oldest record in the retryable queue only; quarantined records never count. */
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
export const HEARTBEAT_INTERVAL_MS = 5 * 60_000; // Idle cadence while visible and signed in

let cachedDeviceId: string | null = null;
let lastHeartbeatSentAt = 0;
let heartbeatTrailingTimer: ReturnType<typeof setTimeout> | null = null;
let lastSuccessfulSyncAtMemo: string | null = null;
type HeartbeatOptions = { lastSuccessfulSyncAt?: string; hubId?: string; force?: boolean };
let pendingTrailingOptions: HeartbeatOptions | undefined;

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
  pendingTrailingOptions = undefined;
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
 * Calculates the pending summary using count queries (no payloads are loaded):
 * - pending_total / pending_by_table / oldest_pending_at: retryable sync_queue rows (synced=0) only
 * - quarantined_count / quarantined_by_table: records quarantined by sync.ts (synced=2 in their own tables),
 *   reported separately so they never inflate "Sync now" counts or the >4h red rule.
 */
export async function getPendingSyncSummary(database: any = db): Promise<PendingSyncSummary> {
  const pendingByTable: Record<string, number> = {};
  const quarantinedByTable: Record<string, number> = {};
  let pendingTotal = 0;
  let quarantinedCount = 0;
  let oldestPendingAt: string | null = null;

  try {
    const queue = database?.sync_queue;
    if (queue) {
      pendingTotal = await queue.where('synced').equals(0).count();
      if (pendingTotal > 0) {
        const tableNames: string[] = await queue.orderBy('table_name').uniqueKeys();
        for (const tableName of tableNames) {
          const n = await queue
            .where('table_name')
            .equals(tableName)
            .and((r: { synced?: number }) => r.synced === 0)
            .count();
          if (n > 0) pendingByTable[tableName || 'unknown'] = n;
        }
        const oldest = await queue
          .orderBy('created_at')
          .filter((r: { synced?: number }) => r.synced === 0)
          .first();
        if (oldest?.created_at) {
          const t = new Date(oldest.created_at).getTime();
          if (!isNaN(t)) oldestPendingAt = new Date(t).toISOString();
        }
      }
    }
  } catch (err: any) {
    if (err?.name !== 'MissingAPIError') {
      console.warn('getPendingSyncSummary: error reading sync_queue', err);
    }
  }

  for (const table of QUARANTINED_TABLES) {
    try {
      const tableObj = database?.[table];
      if (!tableObj) continue;
      const count: number = await tableObj.where('synced').equals(2).count();
      if (count > 0) {
        quarantinedByTable[table] = count;
        quarantinedCount += count;
      }
    } catch (err: any) {
      if (err?.name !== 'MissingAPIError') {
        console.warn(`getPendingSyncSummary: error reading ${table}`, err);
      }
    }
  }

  return {
    pending_total: pendingTotal,
    pending_by_table: pendingByTable,
    quarantined_count: quarantinedCount,
    quarantined_by_table: quarantinedByTable,
    oldest_pending_at: oldestPendingAt,
  };
}

/**
 * A session counts as expired only when we are ONLINE and a refresh actually fails.
 * Offline, an expired access token is normal and must never push the user out.
 */
export async function isSessionReallyExpired(deps: {
  online: boolean;
  getSession: () => Promise<{ expires_at?: number | null } | null>;
  refreshSession: () => Promise<boolean>;
  nowMs?: number;
}): Promise<boolean> {
  if (!deps.online) return false;
  try {
    const session = await deps.getSession();
    const nowMs = deps.nowMs ?? Date.now();
    if (session && !(session.expires_at && session.expires_at * 1000 < nowMs)) return false;
    return !(await deps.refreshSession());
  } catch {
    return false; // can't tell (e.g. network blip): don't lock anyone out
  }
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
 * - Amber if pending > 0 or quarantined > 0 (quarantined records never cause red)
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

  // 4. Quarantined records need an admin; they get their own reason and never turn a device red
  if ((device.quarantined_count || 0) > 0) {
    const q = device.quarantined_count;
    reasons.push(`${q} quarantined record${q === 1 ? '' : 's'} need admin attention`);
    return { status: 'amber', reasons };
  }

  return { status: 'green', reasons: ['In sync'] };
}

/**
 * Internal heartbeat invocation to report_device_sync_status RPC.
 * The hub is resolved server-side from user_profiles; hubId is only honoured for admins.
 */
async function sendHeartbeatNow(options?: HeartbeatOptions): Promise<void> {
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

    // Nothing queued and we just reached the server: the device is fully synced right now.
    if (summary.pending_total === 0 && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      lastSync = new Date().toISOString();
    }

    if (lastSync && lastSync !== lastSuccessfulSyncAtMemo) {
      lastSuccessfulSyncAtMemo = lastSync;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(LAST_SUCCESSFUL_SYNC_KEY, lastSync);
        }
        if (db.device_meta) {
          await db.device_meta.put({ key: 'last_successful_sync_at', value: lastSync });
        }
      } catch {}
    }

    const { error } = await supabase.rpc('report_device_sync_status', {
      p_device_id: deviceId,
      p_hub_id: options?.hubId || null,
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
 * Heartbeat trigger (app open with force, reconnect, after a sync run, and the idle interval).
 * Throttled to at most once per 90s; the trailing call always uses the LATEST options.
 */
export async function reportDeviceSyncHeartbeat(options?: HeartbeatOptions): Promise<void> {
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
    pendingTrailingOptions = undefined;
    lastHeartbeatSentAt = now;
    await sendHeartbeatNow(options);
    return;
  }

  // Throttled: remember the newest options and schedule one trailing execution
  pendingTrailingOptions = { ...pendingTrailingOptions, ...options, force: false };
  if (!heartbeatTrailingTimer) {
    const remainingDelay = Math.max(1000, HEARTBEAT_THROTTLE_MS - elapsed);
    heartbeatTrailingTimer = setTimeout(async () => {
      heartbeatTrailingTimer = null;
      const latest = pendingTrailingOptions;
      pendingTrailingOptions = undefined;
      lastHeartbeatSentAt = Date.now();
      await sendHeartbeatNow(latest);
    }, remainingDelay);
  }
}

/**
 * Idle heartbeat, independent of the sync queue: forced on start, then every
 * HEARTBEAT_INTERVAL_MS while the tab is visible and online, so a healthy idle
 * counter never looks inactive. Returns a stop function.
 */
export function startDeviceHeartbeat(getHubId?: () => string | undefined): () => void {
  const beat = (force = false) => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    reportDeviceSyncHeartbeat({ hubId: getHubId?.(), force }).catch(() => {});
  };
  beat(true);
  const timer = setInterval(() => beat(false), HEARTBEAT_INTERVAL_MS);
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') beat(false);
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}
