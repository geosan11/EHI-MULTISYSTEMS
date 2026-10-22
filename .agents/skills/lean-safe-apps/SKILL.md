---
name: lean-safe-apps
description: >-
  Use this skill when building, optimizing, auditing, or debugging web apps, PWAs,
  dashboards, or web games to ensure they run fast on low-end devices, never crash
  processes or low-RAM machines (4GB RAM), avoid React infinite loops, and stay
  within the 100% Free Tier limits of Supabase, Firebase, and Vercel.
---

# Lean, Safe & Cost-Effective Apps and Games Skill

Follow this runbook whenever creating, reviewing, or optimizing an application or web game so it remains fast on budget devices, free to host (zero surprise egress/storage bills), and safe on low-memory development machines.

---

## 1. Protect the Host Machine (Low-RAM / 4 GB Guardrails)

1. **Never spawn heavy background processes unnecessarily:** Avoid running concurrent Vite/Next.js dev servers, headless browsers, or full TypeScript project builds (`tsc --noEmit` on huge trees) simultaneously on a 4 GB RAM machine.
2. **Use lightweight verification first:** Run the bundled static auditor [`scripts/audit_app_efficiency.py`](./scripts/audit_app_efficiency.py) (uses <10 MB RAM and finishes in <0.2s) to detect performance, egress, and crash anti-patterns before deploying to cloud CI/CD (Vercel / GitHub Actions).

---

## 2. Zero-Waste Egress & Realtime Sync (Stay on Free Tier Forever)

To keep monthly Database Egress under **15% of the 5 GB Supabase Free Tier** even with dozens of active daily users:

1. **Ban Blind Full-Table Polling (`setInterval` + `select('*')`):**
   - Never poll full tables every 1–5 minutes when Realtime WebSockets (`postgres_changes`) are active.
   - Always pause any periodic timer when the tab is hidden:
     ```ts
     if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
     ```
2. **Patch Every Editable Field In-Place on Realtime `UPDATE` & `DELETE` (~0.5 KB vs ~2.5 MB):**
   - When an edit (`UPDATE`), creation (`INSERT`), or deletion (`DELETE`) occurs, patch **all** editable fields (`amount`, `name`, `detail`, quantities, status, approvals, remarks) directly in memory from `payload.new` / `payload.old` and mirror the change to local IndexedDB.
   - Subscribe to all relevant operational tables (including `expenses` / secondary ledgers) on a continuous session channel rather than tearing down and re-downloading tables on every tab switch.
3. **Use Delta Sync (`fetchDelta`) Instead of Full Re-Downloads on Reconnect/Wakeup:**
   - Track `lastSyncedAtRef.current = new Date().toISOString()`.
   - On periodic self-heal or `visibilitychange` wakeup, query **only rows changed since `lastSyncedAtRef.current`**:
     - Transactions: `.or(\`created_at.gte.${since},last_edited_at.gte.${since}\`)`
     - Wallets/Profiles: `.gt('updated_at', lastWalletSyncIsoRef.current)`
4. **Separate Silent Background Queue Sync from Manual Sync:**
   - Background sync timers (e.g., 60s offline outbox check) must pass `{ silent: true }` and **return immediately when `queueCount === 0`**—never fire recurring "All synced" toasts, never call RPC pool refills every minute, and never trigger a full-table refetch after syncing local items already in state.
5. **Replace Fixed-Clock Polling with a Single `setTimeout`:**
   - For known clock boundaries (e.g., `18:00` shift rollovers, daily resets, game energy/cooldown timers), calculate `msUntilBoundary = boundaryTime - Date.now()` and schedule one `setTimeout` (plus a `visibilitychange` wakeup check) instead of polling every 5 minutes.

---

## 3. Database Storage Conservation (500 MB Free DB Cap Protection)

1. **Compress Camera Photos & Signatures on `<canvas>` Before Saving (~92% Reduction):**
   - Never store raw camera frames (`1920x1080`, `toDataURL('image/jpeg')` default `0.92` quality = 150–400 KB) in database columns.
   - Always cap the longest image edge at `640px` and encode at `0.55` JPEG/WebP quality (~12–18 KB):
     ```ts
     const MAX_DIM = 640;
     const scale = Math.min(1, MAX_DIM / Math.max(rawW || 640, rawH || 480));
     canvas.width = Math.max(1, Math.round((rawW || 640) * scale));
     canvas.height = Math.max(1, Math.round((rawH || 480) * scale));
     ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
     const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
     ```
   - Downscale high-DPI signature canvases to `400px` max width (~2 KB).
2. **Exclude Base64 Blobs from List Queries:**
   - Never `select('*')` on tables containing `signature_data` or `photo_data`. Select only metadata columns for list views and fetch media on demand for the single record opened by the user.

---

## 4. Instant Login, Transitions & 60 FPS on Low-End Devices

1. **Lazy-Load the Main App/Game Shell & Preload on Login Screen:**
   - Wrap the heavy authenticated app or game canvas in `React.lazy()` so the initial `/login` or title screen loads in <1s.
   - Trigger `setTimeout(() => import('./MainApp'), 300)` inside the login screen's `useEffect` so the bundle downloads while the user types their credentials.
2. **Eliminate Root-Route Double Renders:**
   - Resolve the user's saved/default tab synchronously inside `useMemo` / `useState` when `location.pathname === '/'` instead of rendering a fallback tab first and redirecting inside `useEffect`.
3. **Stagger Non-Critical Startup Queries by 3 Seconds:**
   - Delay background syncs, tag-pool refills, and secondary caches by `3000ms` on mount so the primary screen fetch gets 100% of network bandwidth and CPU right after login. Also gate admin-only rate/config syncs by role and a 24h `localStorage` TTL.
4. **Ban Animated CSS `filter: blur()` & Full-Viewport SVG `<feTurbulence>` Overlays:**
   - Never animate `filter: blur()` in page transitions or apply `position: fixed; inset: 0` SVG `<feTurbulence>` noise overlays (`body::before`). Use fast `0.15s` `opacity` + `transform: translateY(6px)` transitions with `animation-fill-mode: backwards` (so `position: fixed` modals inside tabs are never broken by a lingering transform containing block).
5. **Keep Analytics Simple, Plain-English & Single-Pass `O(N)`:**
   - Prefer 4 clear headline cards (*Money Collected*, *Total Sales*, *Unpaid Credit*, *Net After Expenses*), department/payment progress bars, and on-demand shift history over heavy chart libraries (`recharts`) and statistical jargon.

---

## 5. Crash & Infinite-Loop Prevention (`React Error #185` Guardrails)

1. **`O(N)` Map Deduplication & Fast ISO Sorting:**
   - Never deduplicate large arrays with `arr.filter((v, i, a) => a.findIndex(...) === i)` (`O(N²)` = 25M operations on 5,000 rows). Always use an `O(N)` `Map` (`dedupById`).
   - Sort ISO-8601 timestamps with string comparison (`b < a ? -1 : b > a ? 1 : 0`) instead of allocating `new Date()` inside `.sort()`.
2. **Bail Out with the Existing State Reference (`rowsEqualById`):**
   - In periodic or delta state updates, compare by ID/content and return `prev` when nothing changed so downstream `useMemo` hooks and row virtualizers don't enter infinite re-render loops.
3. **Stable Callback Identities & Primitive Effect Dependencies:**
   - Read `window.location.pathname` inside navigation callbacks instead of depending on `location.pathname`, and depend on primitive user fields (`user.id`, `user.role`, `user.hub_id`) rather than object references so `useEffect` timers and WebSockets never tear down on tab clicks.
4. **Offline-Safe Cache Seeding (`hasRealFetchResolvedRef`):**
   - When pre-seeding state from `localStorage` (capped to 200 items inside `try/catch` to avoid `QuotaExceededError`), track whether a real network fetch has completed via `hasRealFetchResolvedRef`—never gate offline IndexedDB fallback on `transactions.length === 0`.

---

## 6. Automated Verification Step

Run the efficiency & safety audit script against any `src/` directory:

```bash
python3 ~/.gemini/config/skills/lean-safe-apps/scripts/audit_app_efficiency.py /path/to/project/src
```
