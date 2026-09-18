// Shared localStorage cache-first helper -- read synchronously for instant
// paint (works offline too), write back after a successful fetch. Matches
// the pattern already proven in hubRoutes.ts's getCachedHubRoutes/
// fetchHubRoutes, generalized so newer reference-data caches don't each
// hand-roll their own try/catch JSON.parse slightly differently.
export function getCached<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setCached<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage unavailable/full -- nothing to persist to, caller
    // already has the live value in memory regardless.
  }
}
