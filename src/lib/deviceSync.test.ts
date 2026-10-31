import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import {
  getPendingSyncSummary,
  getDeviceId,
  evaluateDeviceStatus,
  isLagosBusinessHours,
  isSessionReallyExpired,
  reportDeviceSyncHeartbeat,
  startDeviceHeartbeat,
  _resetDeviceSyncStateForTesting,
  DEVICE_ID_STORAGE_KEY,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_THROTTLE_MS,
  type DeviceSyncStatusRow,
} from './deviceSync';

type Row = Record<string, any>;
type Call = { table: string; op: string; field?: string; value?: unknown };

/**
 * Minimal Dexie-like table that actually honours where/equals/orderBy arguments,
 * and records every call so tests fail if the code queries the wrong field/value.
 */
function fakeTable(name: string, rows: Row[], calls: Call[]) {
  const collection = (list: Row[]) => ({
    count: async () => list.length,
    toArray: async () => list.slice(),
    and: (fn: (r: Row) => boolean) => collection(list.filter(fn)),
    filter: (fn: (r: Row) => boolean) => collection(list.filter(fn)),
    first: async () => list[0],
  });
  return {
    where: (field: string) => ({
      equals: (value: unknown) => {
        calls.push({ table: name, op: 'where.equals', field, value });
        return collection(rows.filter((r) => r[field] === value));
      },
    }),
    orderBy: (field: string) => {
      calls.push({ table: name, op: 'orderBy', field });
      const sorted = rows.slice().sort((x, y) => String(x[field]).localeCompare(String(y[field])));
      return {
        ...collection(sorted),
        uniqueKeys: async () => Array.from(new Set(sorted.map((r) => r[field]))),
      };
    },
  };
}

function fakeDb(data: { queue?: Row[]; cargo_entries?: Row[]; manifests?: Row[]; marketing_entries?: Row[]; package_entries?: Row[] }) {
  const calls: Call[] = [];
  const db = {
    sync_queue: fakeTable('sync_queue', data.queue || [], calls),
    cargo_entries: fakeTable('cargo_entries', data.cargo_entries || [], calls),
    manifests: fakeTable('manifests', data.manifests || [], calls),
    marketing_entries: fakeTable('marketing_entries', data.marketing_entries || [], calls),
    package_entries: fakeTable('package_entries', data.package_entries || [], calls),
  };
  return { db, calls };
}

describe('deviceSync', () => {
  beforeEach(() => {
    _resetDeviceSyncStateForTesting();
  });

  describe('getPendingSyncSummary', () => {
    test('returns zero counts and null timestamp when database is empty', async () => {
      const { db, calls } = fakeDb({});
      const summary = await getPendingSyncSummary(db);
      assert.strictEqual(summary.pending_total, 0);
      assert.deepStrictEqual(summary.pending_by_table, {});
      assert.strictEqual(summary.quarantined_count, 0);
      assert.strictEqual(summary.oldest_pending_at, null);
      // The queue is filtered on synced = 0, and each local table on synced = 2
      assert.ok(calls.some((c) => c.table === 'sync_queue' && c.field === 'synced' && c.value === 0));
      for (const t of ['cargo_entries', 'manifests', 'marketing_entries', 'package_entries']) {
        assert.ok(calls.some((c) => c.table === t && c.field === 'synced' && c.value === 2), `${t} queried on synced=2`);
      }
    });

    test('counts only synced=0 queue rows, with table breakdown and oldest timestamp', async () => {
      const { db } = fakeDb({
        queue: [
          { table_name: 'cargo_entries', created_at: '2026-10-31T09:00:00.000Z', synced: 0 },
          { table_name: 'cargo_entries', created_at: '2026-10-31T10:00:00.000Z', synced: 0 },
          { table_name: 'manifests', created_at: '2026-10-31T08:30:00.000Z', synced: 0 },
          // already synced rows (kept up to 7 days) must be ignored everywhere
          { table_name: 'manifests', created_at: '2026-10-30T01:00:00.000Z', synced: 1 },
        ],
      });
      const summary = await getPendingSyncSummary(db);
      assert.strictEqual(summary.pending_total, 3);
      assert.deepStrictEqual(summary.pending_by_table, { cargo_entries: 2, manifests: 1 });
      assert.strictEqual(summary.quarantined_count, 0);
      assert.strictEqual(summary.oldest_pending_at, '2026-10-31T08:30:00.000Z');
    });

    test('quarantined records are reported separately and never affect pending or oldest', async () => {
      const { db, calls } = fakeDb({
        queue: [{ table_name: 'cargo_entries', created_at: '2026-10-31T09:00:00.000Z', synced: 0 }],
        cargo_entries: [
          { id: 'c1', created_at: '2026-10-30T07:00:00.000Z', synced: 2 },
          { id: 'c2', created_at: '2026-10-31T07:00:00.000Z', synced: 1 },
        ],
        manifests: [
          { id: 'm1', created_at: '2026-10-29T06:00:00.000Z', synced: 2 },
          { id: 'm2', created_at: '2026-10-29T07:45:00.000Z', synced: 2 },
        ],
      });
      const summary = await getPendingSyncSummary(db);
      assert.strictEqual(summary.pending_total, 1);
      assert.deepStrictEqual(summary.pending_by_table, { cargo_entries: 1 });
      assert.strictEqual(summary.quarantined_count, 3);
      assert.deepStrictEqual(summary.quarantined_by_table, { cargo_entries: 1, manifests: 2 });
      // The old quarantined rows must not make the device look >4h stale
      assert.strictEqual(summary.oldest_pending_at, '2026-10-31T09:00:00.000Z');
      assert.ok(calls.some((c) => c.table === 'cargo_entries' && c.field === 'synced' && c.value === 2));
    });

    test('device with only quarantined records has pending_total 0 (no futile Sync now)', async () => {
      const { db } = fakeDb({ package_entries: [{ id: 'p1', created_at: '2026-10-01T00:00:00.000Z', synced: 2 }] });
      const summary = await getPendingSyncSummary(db);
      assert.strictEqual(summary.pending_total, 0);
      assert.strictEqual(summary.quarantined_count, 1);
      assert.strictEqual(summary.oldest_pending_at, null);
    });
  });

  describe('getDeviceId', () => {
    const store = new Map<string, string>();
    const g = globalThis as any;
    let hadLocalStorage = false;
    let prevLocalStorage: any;

    beforeEach(() => {
      store.clear();
      hadLocalStorage = 'localStorage' in g;
      prevLocalStorage = g.localStorage;
      g.localStorage = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      };
    });
    afterEach(() => {
      if (hadLocalStorage) g.localStorage = prevLocalStorage;
      else delete g.localStorage;
    });

    test('retrieves existing device ID from Dexie device_meta', async () => {
      const gets: string[] = [];
      const mockDb = {
        device_meta: {
          get: async (key: string) => {
            gets.push(key);
            return key === 'device_id' ? { key: 'device_id', value: 'dexie-device-uuid-123' } : null;
          },
          put: async () => {},
        },
      } as any;
      assert.strictEqual(await getDeviceId(mockDb), 'dexie-device-uuid-123');
      assert.deepStrictEqual(gets, ['device_id']);
      assert.strictEqual(store.get(DEVICE_ID_STORAGE_KEY), 'dexie-device-uuid-123');
    });

    test('falls back to localStorage when Dexie is empty and re-seeds Dexie', async () => {
      store.set(DEVICE_ID_STORAGE_KEY, 'ls-device-9');
      let putCall: any = null;
      const mockDb = {
        device_meta: { get: async () => undefined, put: async (i: any) => void (putCall = i) },
      } as any;
      assert.strictEqual(await getDeviceId(mockDb), 'ls-device-9');
      assert.deepStrictEqual(putCall, { key: 'device_id', value: 'ls-device-9' });
    });

    test('falls back to localStorage when Dexie throws', async () => {
      store.set(DEVICE_ID_STORAGE_KEY, 'ls-device-10');
      const mockDb = {
        device_meta: { get: async () => { throw new Error('IDB blocked'); }, put: async () => { throw new Error('IDB blocked'); } },
      } as any;
      assert.strictEqual(await getDeviceId(mockDb), 'ls-device-10');
    });

    test('treats a missing ID as a new device, generating a unique ID and storing it everywhere', async () => {
      let putCall: any = null;
      const mockDb = {
        device_meta: { get: async () => null, put: async (item: any) => void (putCall = item) },
      } as any;
      const id = await getDeviceId(mockDb);
      assert.ok(id && id.length > 5, 'Should generate a non-empty device id');
      assert.deepStrictEqual(putCall, { key: 'device_id', value: id });
      assert.strictEqual(store.get(DEVICE_ID_STORAGE_KEY), id);
    });
  });

  describe('isSessionReallyExpired', () => {
    const expiredSession = { expires_at: 1000 };
    const nowMs = 2_000_000;

    test('offline: an expired token is NOT an expired session and no refresh is attempted', async () => {
      let refreshed = 0;
      const expired = await isSessionReallyExpired({
        online: false,
        getSession: async () => expiredSession,
        refreshSession: async () => { refreshed++; return false; },
        nowMs,
      });
      assert.strictEqual(expired, false);
      assert.strictEqual(refreshed, 0);
    });

    test('offline with no session at all is still not expired', async () => {
      assert.strictEqual(
        await isSessionReallyExpired({ online: false, getSession: async () => null, refreshSession: async () => false }),
        false
      );
    });

    test('online, expired token, refresh fails: expired', async () => {
      assert.strictEqual(
        await isSessionReallyExpired({ online: true, getSession: async () => expiredSession, refreshSession: async () => false, nowMs }),
        true
      );
    });

    test('online, expired token, refresh succeeds: not expired', async () => {
      assert.strictEqual(
        await isSessionReallyExpired({ online: true, getSession: async () => expiredSession, refreshSession: async () => true, nowMs }),
        false
      );
    });

    test('online, valid token: not expired and refresh not needed', async () => {
      let refreshed = 0;
      const expired = await isSessionReallyExpired({
        online: true,
        getSession: async () => ({ expires_at: nowMs / 1000 + 600 }),
        refreshSession: async () => { refreshed++; return false; },
        nowMs,
      });
      assert.strictEqual(expired, false);
      assert.strictEqual(refreshed, 0);
    });

    test('online, no session, refresh fails: expired; a thrown error is not treated as expired', async () => {
      assert.strictEqual(
        await isSessionReallyExpired({ online: true, getSession: async () => null, refreshSession: async () => false }),
        true
      );
      assert.strictEqual(
        await isSessionReallyExpired({ online: true, getSession: async () => { throw new Error('net'); }, refreshSession: async () => false }),
        false
      );
    });
  });

  describe('heartbeat throttle and idle cadence (fake timers)', () => {
    let rpcCalls: Array<{ fn: string; args: any }>;
    const g = globalThis as any;
    let savedDocument: any;
    let hadDocument = false;

    beforeEach(() => {
      rpcCalls = [];
      mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_800_000_000_000 });
      mock.method(SupabaseClient.prototype, 'rpc', (async (fn: string, args: any) => {
        rpcCalls.push({ fn, args });
        return { data: null, error: null };
      }) as any);
      (supabase.auth as any).getSession = async () => ({ data: { session: { user: { id: 'u1' } } } });
      hadDocument = 'document' in g;
      savedDocument = g.document;
    });
    afterEach(() => {
      mock.timers.reset();
      mock.restoreAll();
      if (hadDocument) g.document = savedDocument;
      else delete g.document;
    });

    const flush = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise<void>((r) => setImmediate(r));
    };

    test('first call sends immediately; throttled calls collapse into one trailing send with the LATEST options', async () => {
      await reportDeviceSyncHeartbeat({ hubId: 'hub-A' });
      assert.strictEqual(rpcCalls.length, 1);
      assert.strictEqual(rpcCalls[0].fn, 'report_device_sync_status');
      assert.strictEqual(rpcCalls[0].args.p_hub_id, 'hub-A');

      mock.timers.tick(10_000);
      await reportDeviceSyncHeartbeat({ hubId: 'hub-B' });
      mock.timers.tick(10_000);
      await reportDeviceSyncHeartbeat({ hubId: 'hub-C', lastSuccessfulSyncAt: '2026-10-31T10:00:00.000Z' });
      await flush();
      assert.strictEqual(rpcCalls.length, 1, 'throttled: nothing sent inside the 90s window');

      mock.timers.tick(HEARTBEAT_THROTTLE_MS);
      await flush();
      assert.strictEqual(rpcCalls.length, 2, 'exactly one trailing send');
      assert.strictEqual(rpcCalls[1].args.p_hub_id, 'hub-C', 'trailing send uses the newest hubId, not the first');
    });

    test('force bypasses the throttle and cancels a pending trailing send', async () => {
      await reportDeviceSyncHeartbeat({});
      mock.timers.tick(5_000);
      await reportDeviceSyncHeartbeat({});
      await reportDeviceSyncHeartbeat({ force: true });
      assert.strictEqual(rpcCalls.length, 2);
      mock.timers.tick(HEARTBEAT_THROTTLE_MS * 2);
      await flush();
      assert.strictEqual(rpcCalls.length, 2, 'trailing timer was cancelled by the forced send');
    });

    test('no heartbeat is sent without a signed-in session', async () => {
      (supabase.auth as any).getSession = async () => ({ data: { session: null } });
      await reportDeviceSyncHeartbeat({ force: true });
      assert.strictEqual(rpcCalls.length, 0);
    });

    test('an idle device (empty queue) keeps reporting every interval and stamps last_successful_sync_at', async () => {
      const stop = startDeviceHeartbeat(() => 'hub-1');
      await flush();
      assert.strictEqual(rpcCalls.length, 1, 'forced heartbeat on start');
      assert.ok(rpcCalls[0].args.p_last_successful_sync_at, 'idle, fully synced device is not "Synced: Never"');

      for (let i = 2; i <= 5; i++) {
        mock.timers.tick(HEARTBEAT_INTERVAL_MS);
        await flush();
        assert.strictEqual(rpcCalls.length, i, `heartbeat #${i} after ${(i - 1) * 5} idle minutes`);
      }

      // 2h in business hours would be red; the longest gap between heartbeats stays far below that
      assert.ok(HEARTBEAT_INTERVAL_MS <= 10 * 60_000);

      stop();
      mock.timers.tick(HEARTBEAT_INTERVAL_MS * 3);
      await flush();
      assert.strictEqual(rpcCalls.length, 5, 'stopped: no more heartbeats');
    });

    test('hidden tab skips the idle heartbeat', async () => {
      g.document = { visibilityState: 'hidden', addEventListener: () => {}, removeEventListener: () => {} };
      const stop = startDeviceHeartbeat();
      mock.timers.tick(HEARTBEAT_INTERVAL_MS * 2);
      await flush();
      assert.strictEqual(rpcCalls.length, 0);
      stop();
    });
  });

  describe('evaluateDeviceStatus', () => {
    // 12:00 Lagos time (UTC 11:00) is business hours (07:00-20:00)
    const lagosNoon = new Date('2026-10-31T11:00:00.000Z');
    // 22:00 Lagos time (UTC 21:00) is outside business hours
    const lagosNight = new Date('2026-10-31T21:00:00.000Z');

    test('returns green for recently seen device with 0 pending', () => {
      const device: DeviceSyncStatusRow = {
        device_id: 'dev-1',
        hub_id: 'hub-1',
        last_staff_id: 'staff-1',
        pending_total: 0,
        pending_by_table: {},
        quarantined_count: 0,
        oldest_pending_at: null,
        // Seen 10 minutes ago
        last_seen_at: new Date(lagosNoon.getTime() - 10 * 60 * 1000).toISOString(),
        last_successful_sync_at: new Date(lagosNoon.getTime() - 10 * 60 * 1000).toISOString(),
      };

      const result = evaluateDeviceStatus(device, lagosNoon);
      assert.strictEqual(result.status, 'green');
    });

    test('returns red if last_seen_at is over 2 hours old during 07:00-20:00 Lagos time', () => {
      const device: DeviceSyncStatusRow = {
        device_id: 'dev-2',
        hub_id: 'hub-1',
        last_staff_id: 'staff-1',
        pending_total: 0,
        pending_by_table: {},
        quarantined_count: 0,
        oldest_pending_at: null,
        // Seen 2.5 hours ago during business hours
        last_seen_at: new Date(lagosNoon.getTime() - 2.5 * 60 * 60 * 1000).toISOString(),
        last_successful_sync_at: null,
      };

      const result = evaluateDeviceStatus(device, lagosNoon);
      assert.strictEqual(result.status, 'red');
      assert.ok(result.reasons[0].includes('Lagos business hours'));
    });

    test('does NOT flag red for last_seen_at over 2 hours old outside 07:00-20:00 Lagos time', () => {
      const device: DeviceSyncStatusRow = {
        device_id: 'dev-3',
        hub_id: 'hub-1',
        last_staff_id: 'staff-1',
        pending_total: 0,
        pending_by_table: {},
        quarantined_count: 0,
        oldest_pending_at: null,
        // Seen 3 hours ago, but current time is 22:00 Lagos time
        last_seen_at: new Date(lagosNight.getTime() - 3 * 60 * 60 * 1000).toISOString(),
        last_successful_sync_at: null,
      };

      const result = evaluateDeviceStatus(device, lagosNight);
      assert.strictEqual(result.status, 'green');
    });

    test('returns red if oldest pending is over 4 hours old (even if recently seen)', () => {
      const device: DeviceSyncStatusRow = {
        device_id: 'dev-4',
        hub_id: 'hub-1',
        last_staff_id: 'staff-1',
        pending_total: 3,
        pending_by_table: { cargo_entries: 3 },
        quarantined_count: 0,
        // Seen 5 minutes ago
        last_seen_at: new Date(lagosNoon.getTime() - 5 * 60 * 1000).toISOString(),
        // But oldest pending was created 4.5 hours ago
        oldest_pending_at: new Date(lagosNoon.getTime() - 4.5 * 60 * 60 * 1000).toISOString(),
        last_successful_sync_at: null,
      };

      const result = evaluateDeviceStatus(device, lagosNoon);
      assert.strictEqual(result.status, 'red');
      assert.ok(result.reasons[0].includes('>4h limit'));
    });

    test('returns amber if pending > 0 but not red', () => {
      const device: DeviceSyncStatusRow = {
        device_id: 'dev-5',
        hub_id: 'hub-1',
        last_staff_id: 'staff-1',
        pending_total: 2,
        pending_by_table: { cargo_entries: 2 },
        quarantined_count: 0,
        // Seen 5 minutes ago
        last_seen_at: new Date(lagosNoon.getTime() - 5 * 60 * 1000).toISOString(),
        // Pending created 30 minutes ago (< 4h)
        oldest_pending_at: new Date(lagosNoon.getTime() - 30 * 60 * 1000).toISOString(),
        last_successful_sync_at: null,
      };

      const result = evaluateDeviceStatus(device, lagosNoon);
      assert.strictEqual(result.status, 'amber');
      assert.ok(result.reasons[0].includes('2 records pending sync'));
    });

    test('quarantined-only device is amber with its own reason, never red', () => {
      const device: DeviceSyncStatusRow = {
        device_id: 'dev-7',
        hub_id: 'hub-1',
        last_staff_id: 'staff-1',
        pending_total: 0,
        pending_by_table: {},
        quarantined_count: 2,
        last_seen_at: new Date(lagosNoon.getTime() - 5 * 60 * 1000).toISOString(),
        oldest_pending_at: null,
        last_successful_sync_at: null,
      };
      const result = evaluateDeviceStatus(device, lagosNoon);
      assert.strictEqual(result.status, 'amber');
      assert.ok(result.reasons[0].includes('quarantined'));
    });

    test('quarantined records are identified and tracked', () => {
      const device: DeviceSyncStatusRow = {
        device_id: 'dev-6',
        hub_id: 'hub-1',
        last_staff_id: 'staff-1',
        pending_total: 1,
        pending_by_table: { cargo_entries: 1 },
        quarantined_count: 1,
        last_seen_at: new Date(lagosNoon.getTime() - 5 * 60 * 1000).toISOString(),
        oldest_pending_at: new Date(lagosNoon.getTime() - 30 * 60 * 1000).toISOString(),
        last_successful_sync_at: null,
      };

      const result = evaluateDeviceStatus(device, lagosNoon);
      assert.strictEqual(result.status, 'amber');
      assert.strictEqual(device.quarantined_count, 1);
    });
  });

  describe('isLagosBusinessHours', () => {
    test('identifies 07:00-20:00 in Africa/Lagos correctly', () => {
      // 08:00 UTC = 09:00 Lagos -> in business hours
      assert.strictEqual(isLagosBusinessHours(new Date('2026-10-31T08:00:00.000Z')), true);
      // 18:30 UTC = 19:30 Lagos -> in business hours
      assert.strictEqual(isLagosBusinessHours(new Date('2026-10-31T18:30:00.000Z')), true);
      // 20:00 Lagos = 19:00 UTC -> 20:00 is end of business window (false)
      assert.strictEqual(isLagosBusinessHours(new Date('2026-10-31T19:00:00.000Z')), false);
      // 03:00 UTC = 04:00 Lagos -> outside business hours
      assert.strictEqual(isLagosBusinessHours(new Date('2026-10-31T03:00:00.000Z')), false);
    });
  });
});
