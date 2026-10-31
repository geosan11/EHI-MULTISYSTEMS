import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPendingSyncSummary,
  getDeviceId,
  evaluateDeviceStatus,
  isLagosBusinessHours,
  _resetDeviceSyncStateForTesting,
  DEVICE_ID_STORAGE_KEY,
  type DeviceSyncStatusRow,
} from './deviceSync';

describe('deviceSync', () => {
  beforeEach(() => {
    _resetDeviceSyncStateForTesting();
  });

  describe('getPendingSyncSummary', () => {
    test('returns zero counts and null timestamp when database is empty', async () => {
      const mockDb = {
        sync_queue: {
          where: () => ({
            equals: () => ({
              toArray: async () => [],
            }),
          }),
        },
        cargo_entries: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
        manifests: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
        marketing_entries: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
        package_entries: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
      };

      const summary = await getPendingSyncSummary(mockDb);
      assert.strictEqual(summary.pending_total, 0);
      assert.deepStrictEqual(summary.pending_by_table, {});
      assert.strictEqual(summary.quarantined_count, 0);
      assert.strictEqual(summary.oldest_pending_at, null);
    });

    test('counts sync_queue rows and tracks table breakdown and oldest timestamp', async () => {
      const mockDb = {
        sync_queue: {
          where: (field: string) => ({
            equals: (val: any) => ({
              toArray: async () => [
                { table_name: 'cargo_entries', created_at: '2026-10-31T09:00:00.000Z', synced: 0 },
                { table_name: 'cargo_entries', created_at: '2026-10-31T10:00:00.000Z', synced: 0 },
                { table_name: 'manifests', created_at: '2026-10-31T08:30:00.000Z', synced: 0 },
              ],
            }),
          }),
        },
        cargo_entries: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
        manifests: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
        marketing_entries: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
        package_entries: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
      };

      const summary = await getPendingSyncSummary(mockDb);
      assert.strictEqual(summary.pending_total, 3);
      assert.strictEqual(summary.pending_by_table['cargo_entries'], 2);
      assert.strictEqual(summary.pending_by_table['manifests'], 1);
      assert.strictEqual(summary.quarantined_count, 0);
      assert.strictEqual(summary.oldest_pending_at, '2026-10-31T08:30:00.000Z');
    });

    test('counts quarantined records (synced=2 in local tables) and identifies oldest pending', async () => {
      const mockDb = {
        sync_queue: {
          where: () => ({
            equals: () => ({
              toArray: async () => [],
            }),
          }),
        },
        cargo_entries: {
          where: (field: string) => ({
            equals: (val: any) => ({
              toArray: async () => [
                { id: 'cargo-q1', created_at: '2026-10-31T07:15:00.000Z', synced: 2 },
              ],
            }),
          }),
        },
        manifests: {
          where: (field: string) => ({
            equals: (val: any) => ({
              toArray: async () => [
                { id: 'man-q1', created_at: '2026-10-31T06:00:00.000Z', synced: 2 },
                { id: 'man-q2', created_at: '2026-10-31T07:45:00.000Z', synced: 2 },
              ],
            }),
          }),
        },
        marketing_entries: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
        package_entries: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
      };

      const summary = await getPendingSyncSummary(mockDb);
      assert.strictEqual(summary.pending_total, 3);
      assert.strictEqual(summary.quarantined_count, 3);
      assert.strictEqual(summary.pending_by_table['cargo_entries'], 1);
      assert.strictEqual(summary.pending_by_table['manifests'], 2);
      // manifests man-q1 at 06:00 is oldest
      assert.strictEqual(summary.oldest_pending_at, '2026-10-31T06:00:00.000Z');
    });

    test('combines sync_queue rows and quarantined records correctly', async () => {
      const mockDb = {
        sync_queue: {
          where: () => ({
            equals: () => ({
              toArray: async () => [
                { table_name: 'cargo_entries', created_at: '2026-10-31T09:00:00.000Z', synced: 0 },
                { table_name: 'package_entries', created_at: '2026-10-31T09:30:00.000Z', synced: 0 },
              ],
            }),
          }),
        },
        cargo_entries: {
          where: () => ({
            equals: () => ({
              toArray: async () => [
                { id: 'cargo-quarantined', created_at: '2026-10-31T07:00:00.000Z', synced: 2 },
              ],
            }),
          }),
        },
        manifests: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
        marketing_entries: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
        package_entries: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
      };

      const summary = await getPendingSyncSummary(mockDb);
      // 2 in sync_queue + 1 quarantined in cargo_entries = 3 total
      assert.strictEqual(summary.pending_total, 3);
      assert.strictEqual(summary.quarantined_count, 1);
      // cargo_entries breakdown is 1 (queue) + 1 (quarantined) = 2
      assert.strictEqual(summary.pending_by_table['cargo_entries'], 2);
      assert.strictEqual(summary.pending_by_table['package_entries'], 1);
      // oldest timestamp is the quarantined cargo entry from 07:00:00
      assert.strictEqual(summary.oldest_pending_at, '2026-10-31T07:00:00.000Z');
    });
  });

  describe('getDeviceId', () => {
    test('retrieves existing device ID from Dexie device_meta', async () => {
      const stored = { key: 'device_id', value: 'dexie-device-uuid-123' };
      const mockDb = {
        device_meta: {
          get: async (key: string) => (key === 'device_id' ? stored : null),
          put: async () => {},
        },
      } as any;

      const id = await getDeviceId(mockDb);
      assert.strictEqual(id, 'dexie-device-uuid-123');
    });

    test('treats a missing ID as a new device, generating a unique ID and storing it', async () => {
      let putCall: any = null;
      const mockDb = {
        device_meta: {
          get: async () => null,
          put: async (item: any) => {
            putCall = item;
          },
        },
      } as any;

      const id = await getDeviceId(mockDb);
      assert.ok(id && id.length > 5, 'Should generate a non-empty device id');
      assert.deepStrictEqual(putCall, { key: 'device_id', value: id });
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
