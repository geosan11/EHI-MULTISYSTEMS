import Dexie, { type Table } from 'dexie';
import type { ProofOfDelivery, TripPing } from './types';

interface LocalShipment {
  id: string;
  data: Record<string, unknown>;
  // 0 = pending sync, 1 = synced, 2 = quarantined (permanent sync error --
  // see PERMANENT_PG_CODES in lib/sync.ts). sync_error holds the code/message
  // for a quarantined record, cleared on requeue.
  synced: 0 | 1 | 2;
  sync_error?: string | null;
  created_at: string;
}

export interface SyncQueueItem {
  id?: number;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE';
  payload: Record<string, unknown>;
  synced: 0 | 1;
  created_at: string;
}

// A locally-held pool of tag/AWB numbers pre-reserved from the atomic
// server-side counter (reserve_awb_block RPC, see lib/tagPool.ts) -- one
// row per unused reserved number. Popping a row here is a pure local
// operation (no network needed), which is what lets tag generation work
// offline while still guaranteeing every number came from the same
// collision-free server sequence next_awb_number() already relies on.
export interface TagPoolItem {
  id?: number;
  pool_key: string;
  number: number;
}

class EHILocalDB extends Dexie {
  shipments!: Table<LocalShipment>;
  manifests!: Table<LocalShipment>;
  marketing_entries!: Table<LocalShipment>;
  cargo_entries!: Table<LocalShipment>;
  package_entries!: Table<LocalShipment>;
  proof_of_delivery!: Table<ProofOfDelivery>;
  trip_pings!: Table<TripPing>;
  sync_queue!: Table<SyncQueueItem>;
  tag_pools!: Table<TagPoolItem>;

  constructor() {
    super('EHILocalDB');
    this.version(1).stores({
      shipments: 'id, synced, created_at',
      manifests: 'id, synced, created_at',
      marketing_entries: 'id, synced, created_at',
      air_consignments: 'id, synced, created_at',
      sync_queue: '++id, table_name, synced, created_at',
    });
    this.version(2).stores({
      shipments: 'id, synced, created_at',
      manifests: 'id, synced, created_at',
      marketing_entries: 'id, synced, created_at',
      air_consignments: null,
      cargo_entries: 'id, synced, created_at',
      sync_queue: '++id, table_name, synced, created_at',
    });
    this.version(3).stores({
      cargo_entries: 'id, synced, created_at',
      manifests: 'id, synced, created_at',
      marketing_entries: 'id, synced, created_at',
      proof_of_delivery: 'id, awbNumber, synced, deliveredAt',
      sync_queue: '++id, table_name, synced, created_at',
    });
    this.version(4).stores({
      cargo_entries: 'id, synced, created_at',
      manifests: 'id, synced, created_at',
      marketing_entries: 'id, synced, created_at',
      proof_of_delivery: 'id, awbNumber, synced, deliveredAt',
      trip_pings: '++id, tripId, timestamp, synced',
      sync_queue: '++id, table_name, synced, created_at',
    });
    this.version(5).stores({
      cargo_entries: 'id, synced, created_at',
      manifests: 'id, synced, created_at',
      marketing_entries: 'id, synced, created_at',
      proof_of_delivery: 'id, awbNumber, synced, deliveredAt',
      trip_pings: '++id, tripId, timestamp, synced',
      sync_queue: '++id, table_name, record_id, synced, created_at',
    });
    this.version(6).stores({
      cargo_entries: 'id, synced, created_at',
      manifests: 'id, synced, created_at',
      marketing_entries: 'id, synced, created_at',
      package_entries: 'id, synced, created_at',
      proof_of_delivery: 'id, awbNumber, synced, deliveredAt',
      trip_pings: '++id, tripId, timestamp, synced',
      sync_queue: '++id, table_name, record_id, synced, created_at',
    });
    this.version(7).stores({
      cargo_entries: 'id, synced, created_at',
      manifests: 'id, synced, created_at',
      marketing_entries: 'id, synced, created_at',
      package_entries: 'id, synced, created_at',
      proof_of_delivery: 'id, awbNumber, synced, deliveredAt',
      trip_pings: '++id, tripId, timestamp, synced',
      sync_queue: '++id, table_name, record_id, synced, created_at',
      tag_pools: '++id, pool_key, number',
    });
  }
}

export const db = new EHILocalDB();
