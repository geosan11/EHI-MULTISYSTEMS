/**
 * Hook for authoritative Billing Entitlement and Auto-Unlock.
 *
 * Requirements & Policy:
 * 1. Before activation (epoch 1794207480000, 2026-11-09T07:58:00+01:00): application is never blocked.
 * 2. Auto-unlock: when server confirms active entitlement, automatically unlocks gate.
 * 3. Offline resilience: caches last-confirmed valid entitlement until expiry (paid_until)
 *    so offline devices with valid paid coverage experience zero flash lock.
 * 4. Online authoritative override: live server status always overrides cached grant.
 * 5. Unknown status after activation: no indefinite failopen. If no valid unexpired cached grant exists
 *    and server status cannot be confirmed, lock gate.
 * 6. Controlled polling: polls server every 10 seconds while blocked or pending.
 * 7. Focus / Online resume: re-checks server on window focus, visibility, or network reconnect.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchEntitlementStatus, type EntitlementResponse } from '../lib/billingApi';
import { isCloudLockActive } from '../config/cloudLockConfig';

const ENTITLEMENT_CACHE_KEY = 'ehi_entitlement_v1_EHI';

interface CachedEntitlement {
  isActive: boolean;
  isPermanent: boolean;
  plan: string;
  paidUntil: string | null;
  cachedAt: number;
  sig: string;
}

function computeEntitlementSignature(data: Omit<CachedEntitlement, 'sig'>): string {
  const payload = `${data.isActive}|${data.isPermanent}|${data.plan}|${data.paidUntil || ''}|${data.cachedAt}|ehi-ent-v1`;
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function readCachedEntitlement(nowMs: number = Date.now()): EntitlementResponse | null {
  try {
    const raw = localStorage.getItem(ENTITLEMENT_CACHE_KEY);
    if (!raw) return null;
    const parsed: CachedEntitlement = JSON.parse(raw);
    const expectedSig = computeEntitlementSignature({
      isActive: parsed.isActive,
      isPermanent: parsed.isPermanent,
      plan: parsed.plan,
      paidUntil: parsed.paidUntil,
      cachedAt: parsed.cachedAt,
    });

    if (parsed.sig !== expectedSig) {
      console.warn('Tampered or corrupted entitlement cache detected. Ignoring.');
      localStorage.removeItem(ENTITLEMENT_CACHE_KEY);
      return null;
    }

    if (!parsed.isActive) return null;

    // Check expiry
    if (!parsed.isPermanent && parsed.paidUntil) {
      const expiryMs = new Date(parsed.paidUntil).getTime();
      if (nowMs >= expiryMs) {
        // Expired grant
        localStorage.removeItem(ENTITLEMENT_CACHE_KEY);
        return null;
      }
    }

    return {
      isActive: parsed.isActive,
      isPermanent: parsed.isPermanent,
      plan: parsed.plan,
      paidUntil: parsed.paidUntil,
      status: 'active',
      serverTime: new Date(parsed.cachedAt).toISOString(),
    };
  } catch {
    return null;
  }
}

function writeCachedEntitlement(data: EntitlementResponse): void {
  try {
    if (!data.isActive) {
      localStorage.removeItem(ENTITLEMENT_CACHE_KEY);
      return;
    }
    const cachedAt = Date.now();
    const entry: Omit<CachedEntitlement, 'sig'> = {
      isActive: data.isActive,
      isPermanent: data.isPermanent,
      plan: data.plan,
      paidUntil: data.paidUntil,
      cachedAt,
    };
    const sig = computeEntitlementSignature(entry);
    localStorage.setItem(
      ENTITLEMENT_CACHE_KEY,
      JSON.stringify({ ...entry, sig })
    );
  } catch {
    // Best-effort storage
  }
}

export function clearEntitlementCache(): void {
  try {
    localStorage.removeItem(ENTITLEMENT_CACHE_KEY);
  } catch {}
}

export function useBillingEntitlement() {
  const [entitlement, setEntitlement] = useState<EntitlementResponse | null>(() => {
    return readCachedEntitlement();
  });
  const [loading, setLoading] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<number>(0);
  const isMountedRef = useRef(true);

  // Authoritative server check
  const checkServerEntitlement = useCallback(async () => {
    try {
      setLoading(true);
      const serverEnt = await fetchEntitlementStatus();
      if (!isMountedRef.current) return;

      setEntitlement(serverEnt);
      setLastCheckTime(Date.now());

      if (serverEnt.isActive) {
        writeCachedEntitlement(serverEnt);
      } else {
        clearEntitlementCache();
      }
    } catch {
      // Network failure / offline
      if (!isMountedRef.current) return;
      // Re-read local cache
      const cached = readCachedEntitlement();
      if (cached) {
        setEntitlement(cached);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    checkServerEntitlement();

    // Re-check on window focus, online event, and visibility change
    const handleSyncTrigger = () => {
      checkServerEntitlement();
    };

    window.addEventListener('focus', handleSyncTrigger);
    window.addEventListener('online', handleSyncTrigger);
    document.addEventListener('visibilitychange', handleSyncTrigger);

    // Controlled poll every 10 seconds while blocked or checking
    const interval = setInterval(() => {
      // Only poll if window is visible
      if (document.visibilityState === 'visible') {
        checkServerEntitlement();
      }
    }, 10000);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('focus', handleSyncTrigger);
      window.removeEventListener('online', handleSyncTrigger);
      document.removeEventListener('visibilitychange', handleSyncTrigger);
      clearInterval(interval);
    };
  }, [checkServerEntitlement]);

  // Compute unlock state:
  // 1. If cloud lock is not yet active (before Nov 9 07:58+01) -> unlocked.
  // 2. If entitlement is active -> unlocked.
  // 3. Otherwise -> blocked.
  const lockActive = isCloudLockActive();
  const isEntitlementValid = !!(
    entitlement?.isActive &&
    (entitlement.isPermanent ||
      (entitlement.paidUntil && new Date(entitlement.paidUntil).getTime() > Date.now()))
  );

  const isUnlocked = !lockActive || isEntitlementValid;
  const isBlocked = lockActive && !isEntitlementValid;

  return {
    isUnlocked,
    isBlocked,
    entitlement,
    loading,
    refresh: checkServerEntitlement,
    lastCheckTime,
  };
}
