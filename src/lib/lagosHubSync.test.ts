import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from './supabase';
import {
  getLagosHubInfo,
  invalidateLagosHubCache,
  getEquivalentHubIds,
  getSelectableHubsForUser,
  syncLagosRates,
  deleteLagosRateRow,
} from './lagosHubSync';

describe('lagosHubSync', () => {
  const originalFrom = supabase.from;
  const originalRpc = supabase.rpc;

  const mockHubs = [
    { id: 'hub-ho', name: 'EHI Head Office Lagos', code: 'LOS-HQ', state: 'Lagos', active: true },
    { id: 'hub-cs', name: 'Lagos Air Cargo Station', code: 'LOS', state: 'Lagos', active: true },
    { id: 'hub-abj', name: 'Abuja Head Office', code: 'ABJ', state: 'FCT', active: true },
    { id: 'hub-ph', name: 'Port Harcourt Hub', code: 'PHC', state: 'Rivers', active: true },
  ];

  beforeEach(() => {
    invalidateLagosHubCache();
  });

  afterEach(() => {
    supabase.from = originalFrom;
    supabase.rpc = originalRpc;
    invalidateLagosHubCache();
  });

  describe('getLagosHubInfo & getEquivalentHubIds', () => {
    test('categorizes Lagos hubs and excludes out-of-state hubs', async () => {
      (supabase.from as any) = (table: string) => {
        if (table === 'hubs') {
          return {
            select: () => ({
              order: () => Promise.resolve({ data: mockHubs, error: null }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      };

      const info = await getLagosHubInfo();
      assert.equal(info.headOfficeId, 'hub-ho');
      assert.equal(info.cargoStationId, 'hub-cs');
      assert.deepEqual(info.allLagosHubIds.sort(), ['hub-cs', 'hub-ho'].sort());

      const equivLagos = await getEquivalentHubIds('hub-ho');
      assert.deepEqual(equivLagos.sort(), ['hub-cs', 'hub-ho'].sort());

      const equivAbuja = await getEquivalentHubIds('hub-abj');
      assert.deepEqual(equivAbuja, ['hub-abj']);
    });
  });

  describe('getSelectableHubsForUser', () => {
    test('admin / super_admin can select any active hub', async () => {
      (supabase.from as any) = (table: string) => {
        if (table === 'hubs') {
          return {
            select: () => ({
              eq: (field: string, val: any) => ({
                order: () => Promise.resolve({ data: mockHubs, error: null }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      };

      const adminHubs = await getSelectableHubsForUser({ role: 'admin', hub_id: 'hub-abj' });
      assert.equal(adminHubs.length, 4);

      const superHubs = await getSelectableHubsForUser({ role: 'super_admin', hub_id: 'hub-ho' });
      assert.equal(superHubs.length, 4);
    });

    test('accountant can select own hub and sibling hubs in same state, but not out-of-state', async () => {
      (supabase.from as any) = (table: string) => {
        if (table === 'hubs') {
          return {
            select: () => ({
              order: () => Promise.resolve({ data: mockHubs, error: null }),
              eq: (field: string, val: any) => ({
                order: () => Promise.resolve({ data: mockHubs, error: null }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      };

      const accountantHubs = await getSelectableHubsForUser({
        role: 'accountant',
        hub_id: 'hub-ho',
        hub: 'EHI Head Office Lagos',
      });
      const ids = accountantHubs.map((h) => h.id).sort();
      assert.deepEqual(ids, ['hub-cs', 'hub-ho'].sort());
      assert.ok(!ids.includes('hub-abj'));
      assert.ok(!ids.includes('hub-ph'));
    });

    test('other roles cannot select any hubs for rate writes', async () => {
      const agentHubs = await getSelectableHubsForUser({
        role: 'cargo_agent',
        hub_id: 'hub-ho',
      });
      assert.deepEqual(agentHubs, []);
    });
  });

  describe('syncLagosRates', () => {
    test('uses sourceHubId as master when source is a Lagos hub', async () => {
      const upsertCalls: { table: string; row: any }[] = [];

      (supabase.from as any) = (table: string) => {
        if (table === 'hubs') {
          return {
            select: () => ({
              order: () => Promise.resolve({ data: mockHubs, error: null }),
            }),
          };
        }
        if (table === 'hub_airline_route_rates') {
          return {
            select: () => ({
              eq: (field: string, val: any) => {
                assert.equal(field, 'hub_id');
                assert.equal(val, 'hub-ho'); // Head office is master because it was sourceHubId!
                return Promise.resolve({
                  data: [{ hub_id: 'hub-ho', airline: 'Air Peace', route_name: 'LOS-ABV', rate_per_kg: 500 }],
                  error: null,
                });
              },
            }),
            upsert: (row: any) => {
              upsertCalls.push({ table, row });
              return Promise.resolve({ error: null });
            },
          };
        }
        // Return empty for other tables
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
          upsert: (row: any) => {
            upsertCalls.push({ table, row });
            return Promise.resolve({ error: null });
          },
        };
      };

      (supabase.rpc as any) = () => Promise.resolve({ error: null });

      const res = await syncLagosRates('hub-ho');
      assert.equal(res.success, true);
      assert.equal(res.failed, 0);
      assert.equal(res.count, 1);
      assert.equal(upsertCalls.length, 1);
      assert.equal(upsertCalls[0].row.hub_id, 'hub-cs'); // copied to sibling Lagos hub!
      assert.equal(upsertCalls[0].row.rate_per_kg, 500);
    });

    test('falls back to cargo station master when sourceHubId is omitted', async () => {
      let queriedMasterId: string | null = null;

      (supabase.from as any) = (table: string) => {
        if (table === 'hubs') {
          return {
            select: () => ({
              order: () => Promise.resolve({ data: mockHubs, error: null }),
            }),
          };
        }
        return {
          select: () => ({
            eq: (field: string, val: any) => {
              if (field === 'hub_id' && !queriedMasterId) queriedMasterId = val;
              return Promise.resolve({ data: [], error: null });
            },
          }),
          upsert: () => Promise.resolve({ error: null }),
        };
      };

      (supabase.rpc as any) = () => Promise.resolve({ error: null });

      const res = await syncLagosRates();
      assert.equal(res.success, true);
      assert.equal(queriedMasterId, 'hub-cs'); // cargo station fallback
    });

    test('surfaces failures and returns success: false if any upsert fails', async () => {
      (supabase.from as any) = (table: string) => {
        if (table === 'hubs') {
          return {
            select: () => ({
              order: () => Promise.resolve({ data: mockHubs, error: null }),
            }),
          };
        }
        if (table === 'hub_route_rates') {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [{ hub_id: 'hub-ho', route_name: 'LOS-ABV', rate_per_kg: 350 }],
                  error: null,
                }),
            }),
            upsert: () => Promise.resolve({ error: { message: 'permission denied for table hub_route_rates' } }),
          };
        }
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
          upsert: () => Promise.resolve({ error: null }),
        };
      };

      (supabase.rpc as any) = () => Promise.resolve({ error: null });

      const res = await syncLagosRates('hub-ho');
      assert.equal(res.success, false);
      assert.equal(res.failed, 1);
      assert.ok(res.message?.includes('hub_route_rates: permission denied'));
    });
  });

  describe('deleteLagosRateRow', () => {
    test('propagates deletion to sibling Lagos hub', async () => {
      let deletedTable: string | null = null;
      let targetHub: string | null = null;
      let deletedRoute: string | null = null;

      (supabase.from as any) = (table: string) => {
        if (table === 'hubs') {
          return {
            select: () => ({
              order: () => Promise.resolve({ data: mockHubs, error: null }),
            }),
          };
        }
        deletedTable = table;
        return {
          delete: () => ({
            eq: (field: string, val: any) => {
              if (field === 'hub_id') targetHub = val;
              return {
                eq: (k: string, v: any) => {
                  if (k === 'route_name') deletedRoute = v;
                  return Promise.resolve({ error: null, data: [] });
                },
              };
            },
          }),
        };
      };

      const res = await deleteLagosRateRow({
        table: 'hub_route_rates',
        sourceHubId: 'hub-ho',
        keys: { route_name: 'LOS-KAN' },
      });

      assert.equal(res.success, true);
      assert.equal(res.failed, 0);
      assert.equal(deletedTable, 'hub_route_rates');
      assert.equal(targetHub, 'hub-cs');
      assert.equal(deletedRoute, 'LOS-KAN');
    });

    test('does NOT delete anything when sourceHubId is non-Lagos', async () => {
      let deleteCalled = false;

      (supabase.from as any) = (table: string) => {
        if (table === 'hubs') {
          return {
            select: () => ({
              order: () => Promise.resolve({ data: mockHubs, error: null }),
            }),
          };
        }
        deleteCalled = true;
        return {};
      };

      const res = await deleteLagosRateRow({
        table: 'hub_route_rates',
        sourceHubId: 'hub-abj',
        keys: { route_name: 'ABJ-KAN' },
      });

      assert.equal(res.success, true);
      assert.equal(deleteCalled, false);
      assert.ok(res.message?.includes('not a Lagos hub'));
    });

    test('surfaces delete failures if sibling delete fails', async () => {
      (supabase.from as any) = (table: string) => {
        if (table === 'hubs') {
          return {
            select: () => ({
              order: () => Promise.resolve({ data: mockHubs, error: null }),
            }),
          };
        }
        return {
          delete: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: { message: 'Network timeout' } }),
            }),
          }),
        };
      };

      const res = await deleteLagosRateRow({
        table: 'hub_route_rates',
        sourceHubId: 'hub-ho',
        keys: { route_name: 'LOS-KAN' },
      });

      assert.equal(res.success, false);
      assert.equal(res.failed, 1);
      assert.ok(res.message?.includes('Network timeout'));
    });
  });
});
