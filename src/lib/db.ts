import Dexie, { type Table } from 'dexie';

interface LocalShipment {
  id: string;
  data: Record<string, unknown>;
  synced: boolean;
  created_at: string;
}

interface SyncQueueItem {
  id?: number;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE';
  payload: Record<string, unknown>;
  synced: boolean;
  created_at: string;
}

class EHILocalDB extends Dexie {
  shipments!: Table<LocalShipment>;
  manifests!: Table<LocalShipment>;
  marketing_entries!: Table<LocalShipment>;
  air_consignments!: Table<LocalShipment>;
  sync_queue!: Table<SyncQueueItem>;

  constructor() {
    super('EHILocalDB');
    this.version(1).stores({
      shipments: 'id, synced, created_at',
      manifests: 'id, synced, created_at',
      marketing_entries: 'id, synced, created_at',
      air_consignments: 'id, synced, created_at',
      sync_queue: '++id, table_name, synced, created_at',
    });
  }
}

export const db = new EHILocalDB();
