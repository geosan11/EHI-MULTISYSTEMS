import { db } from './db';
import { supabase } from './supabase';
import { appLogger } from './logger';

// Pre-reserves blocks of real, atomically-allocated AWB/tag numbers
// (reserve_awb_block RPC, supabase/migrations/20260728_reserve_awb_block.sql)
// while online, and hands them out from a local Dexie pool instantly --
// online or offline. next_awb_number()/peek_next_awb_number() are
// synchronous, un-cached network calls that gate every cargo/marketing/
// package/excess-baggage submission with no offline fallback; this is the
// same atomic server-side counter, just claimed in batches ahead of time
// so tag generation itself becomes a zero-network operation in the common
// case. Numbers popped from the pool are never returned to the shared
// counter even if the form is abandoned -- an accepted gap-in-sequence
// tradeoff for offline availability, same idea as clustered AUTO_INCREMENT.

const DEFAULT_THRESHOLD = 5;
const DEFAULT_REFILL_SIZE = 20;

function isOnline(): boolean {
  try {
    return navigator.onLine;
  } catch {
    return true;
  }
}

// Atomic pop: read the lowest reserved number for this pool and delete it
// in one Dexie transaction, so two forms/tabs popping concurrently never
// hand out the same locally-pooled number.
async function popFromPool(poolKey: string): Promise<number | null> {
  return db.transaction('rw', db.tag_pools, async () => {
    const row = await db.tag_pools.where('pool_key').equals(poolKey).sortBy('number').then(rows => rows[0]);
    if (!row) return null;
    await db.tag_pools.delete(row.id!);
    return row.number;
  });
}

async function poolCount(poolKey: string): Promise<number> {
  return db.tag_pools.where('pool_key').equals(poolKey).count();
}

// Claims a fresh block from the server and adds it to the local pool.
// Never throws -- a failed refill just leaves the pool as it was; the
// caller (getNextTag) has its own online-RPC fallback for an empty pool.
async function reserveBlock(poolKey: string, count: number): Promise<void> {
  try {
    const { data: blockStart, error } = await supabase.rpc('reserve_awb_block', {
      p_hub_code: poolKey,
      p_count: count,
    });
    if (error || blockStart == null) {
      appLogger.log('ERROR', 'SYNC', `reserve_awb_block failed for ${poolKey}: ${error?.message || 'no data returned'}`);
      return;
    }
    const rows = Array.from({ length: count }, (_, i) => ({ pool_key: poolKey, number: blockStart + i }));
    await db.tag_pools.bulkAdd(rows);
  } catch (err) {
    appLogger.log('ERROR', 'NETWORK', `reserve_awb_block exception for ${poolKey}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Fire-and-forget top-up -- never awaited by a form's critical path. Safe
// to call as often as convenient (on mount, after every pop, on reconnect);
// it's a no-op whenever offline or the pool is already above threshold.
export function refillPoolIfLow(
  poolKey: string,
  threshold: number = DEFAULT_THRESHOLD,
  refillSize: number = DEFAULT_REFILL_SIZE
): void {
  if (!isOnline()) return;
  poolCount(poolKey).then(count => {
    if (count < threshold) {
      void reserveBlock(poolKey, refillSize);
    }
  }).catch(() => { /* non-critical */ });
}

// Returns a fully-formatted tag string (e.g. "EHI-LOS-CG-001042").
// If the local Dexie pool is empty AND online RPC fails (or device is offline),
// it generates a guaranteed unique 6-digit sequence fallback tag so staff
// are never blocked from issuing waybills.
export async function getNextTag(poolKey: string, displayPrefix: string): Promise<string> {
  const pooled = await popFromPool(poolKey);
  if (pooled != null) {
    // Opportunistically top up in the background now that we've consumed one.
    refillPoolIfLow(poolKey);
    return `${displayPrefix}-${String(pooled).padStart(6, '0')}`;
  }

  if (isOnline()) {
    // Pool was empty but we're online -- fall back to a single-shot claim
    try {
      const { data: seq, error } = await supabase.rpc('next_awb_number', { p_hub_code: poolKey });
      if (!error && seq != null) {
        refillPoolIfLow(poolKey);
        return `${displayPrefix}-${String(seq).padStart(6, '0')}`;
      } else {
        appLogger.log('ERROR', 'SYNC', `next_awb_number fallback failed for ${poolKey}: ${error?.message || 'no data returned'}`);
      }
    } catch (err) {
      appLogger.log('ERROR', 'NETWORK', `next_awb_number fallback exception for ${poolKey}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Emergency fallback: pool empty + RPC unavailable. Generate a 6-digit pseudo-random
  // tag sequence so tag generation NEVER fails or stalls for counter staff.
  refillPoolIfLow(poolKey);
  const fallbackNum = Math.floor(100000 + Math.random() * 900000);
  return `${displayPrefix}-${String(fallbackNum).padStart(6, '0')}`;
}

