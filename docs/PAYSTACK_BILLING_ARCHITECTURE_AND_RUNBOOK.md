# EHI Multisystems — Paystack Automatic Billing Architecture & Owner Runbook

This document details the production architecture, security specifications, database contracts, and owner deployment runbook for the automated Paystack payment gateway integration and singleton cloud entitlement unlocking system.

---

## 1. Architectural Overview & Boundaries

### A. Lifecycle & Entitlement Flow
1. **Scheduled Activation Gate**:
   - Activation epoch: `2026-11-09T07:58:00+01:00` (UTC `2026-11-09T06:58:00.000Z`, epoch `1794207480000`).
   - Prior to this timestamp, the operational platform is 100% usable with zero gates.
   - At or past activation, the `CloudPausedGate` mounts if no authoritative valid entitlement is active.
   - Public tracking (`/track` and `/track/:waybillId`) and billing callback (`/billing/callback`) are explicitly exempt from the gate.
   - Background operational engines (Dexie IndexedDB, offline queue, authentication listeners) remain mounted and running.

2. **Frontend Gate Scope & Cargo API Boundary**:
   - The scheduled cloud lock is enforced at the frontend presentation layer via `CloudPausedGate`.
   - Standard operational backend cargo endpoints (`/api/notify`, `/api/eod`, etc.) do not enforce entitlement checks on individual cargo transactions.
   - Local storage caching allows offline continuity during verified coverage periods; authoritative online verification from the backend always overrides the client on reconnect.

3. **Durable Server Checkout Initiation**:
   - Authorized staff member initiates checkout via `POST /api/billing/initialize` with their chosen plan ID (`november-bridge`, `monthly-licence`, or `system-handover`).
   - Authenticated staff membership is enforced: caller must have a valid session and an active account in `public.user_profiles` (`active = true`). Deactivated staff cannot initialize checkout.
   - Bridge plan initiation is gated: rejected if current time $\ge$ `2026-12-01T00:00:00+01:00` (epoch `1796079600000`).
   - Server checks required secrets upfront (`PAYSTACK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`) before proceeding.
   - Reference format strictly conforms to Paystack's allowed character set (alphanumeric, dash, dot, equals — **no underscores**): `ehi-<plan>-<safeUUID>`.
   - Server binds expected plan prices in NGN kobo (`6300000`, `18000000`, `70000000`) and durably records the transaction in `billing_transactions` before communicating with Paystack.
   - Server calls Paystack API `POST https://api.paystack.co/transaction/initialize`.
   - The returned `authorization_url` is validated against allowlisted Paystack hosts (`checkout.paystack.com`, `standard.paystack.co`) before returning to the frontend.

4. **Authoritative Server Verification & Atomic Entitlement Grant**:
   - User completes payment on Paystack checkout and is redirected to `/billing/callback?reference=...`.
   - Verification endpoint `/api/billing/verify/:reference` enforces authenticated active staff callers and binds verification to the staff member who initiated the transaction (or an admin/super_admin). Arbitrary callers cannot probe or trigger verification.
   - Simultaneously, Paystack delivers an asynchronous webhook event to `/api/paystack-webhook` (or `/api/paystack/webhook`, `/api/billing/webhook`).
   - Both pathways invoke the same authoritative server verification and atomic database function.
   - Row-level locking (`SELECT ... FOR UPDATE`) guarantees complete idempotency: whichever pathway commits first grants entitlement, and subsequent attempts return the confirmed status with zero double-granting.

5. **Webhook Transient Retry Handling**:
   - If verification or database grant fails due to transient network, database lock, or server errors, the webhook handler returns HTTP 500, instructing Paystack to retry according to its exponential backoff schedule.
   - HTTP 200 is returned **only** when the payment has been durably processed (successful grant, idempotent replay, or recorded late bridge needing manual resolution) or when safely ignoring unrelated events.

---

## 2. Plan Catalog, Precedence & Expiry Mathematics

| Plan | Price (NGN) | Expected Kobo | Validity / Coverage | Renewal & Precedence Rules |
| :--- | :--- | :--- | :--- | :--- |
| **November Cloud Bridge** | ₦63,000 | `6300000` | Fixed through `2026-11-30T23:59:59+01:00` | Non-renewable. Initiation cutoff: `2026-12-01T00:00:00+01:00`. Late bridge payments confirmed after Nov 30 cutoff record as `expired_bridge_resolution_required` needing manual billing resolution (no automatic refund). Never shortens longer existing coverage or permanent handover. |
| **Monthly System Licence** | ₦180,000 | `18000000` | 30 days coverage minimum | Calculated as `GREATEST(COALESCE(existing_paid_until, now), now + 30 days)`. Guaranteed 30-day minimum from payment time. **No stacking** onto future dates. Never shortens existing longer coverage, and never downgrades permanent status. |
| **Full System Handover** | ₦700,000 | `70000000` | Permanent (`paid_until = NULL`, `is_permanent = true`) | Permanent buyout. Takes highest precedence. Subsequent monthly or bridge purchases can never downgrade or overwrite permanent status. |

---

## 3. Database Security & Architecture (Supabase Best Practices)

1. **Private Schema & Function Separation**:
   - `private.apply_billing_grant_atomic_definer`: Internal function defined in `private` schema with `SECURITY DEFINER SET search_path = ''`.
   - `public.apply_billing_grant_atomic`: Public entrypoint defined with `SECURITY INVOKER SET search_path = ''`.
   - Both functions have execution rights revoked from `PUBLIC`, `anon`, and `authenticated`.
   - Execution is granted exclusively to `service_role`.

2. **Column Privilege Lockdown**:
   - `public.billing_transactions`: RLS enabled. Direct access revoked for public/anon.
   - Authenticated staff can read non-sensitive transaction columns (`id`, `reference`, `account_id`, `plan`, `amount_kobo`, `currency`, `mode`, `status`, `initiated_at`, `initiated_by`, `verified_at`, `entitlement_granted`).
   - Raw gateway payload (`paystack_data`) and `paystack_id` are excluded from client SELECT grants to protect transaction metadata.
   - `public.ehi_entitlement`: RLS enabled. Authenticated active staff can SELECT status fields only. Direct mutation is restricted to `service_role`.

3. **Mode Mismatch Protection**:
   - Both `getEntitlement()` and `verifyAndApplyGrant()` validate that `ent.mode` and `tx.mode` strictly match the runtime server configuration (`PAYSTACK_MODE`).
   - A `test` mode entitlement in the database will return `status: 'mode_mismatch'` and will **never** unlock a production environment running in `live` mode.

---

## 4. Complete Environment Variables Setup List

The following environment variables are required across frontend and backend services:

| Environment Variable | Target Service | Scope / Visibility | Required | Allowed / Expected Values | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Frontend & Server | Public / Bundled | **Yes** | `https://<PROJECT-REF>.supabase.co` | Supabase API endpoint URL. |
| `VITE_SUPABASE_ANON_KEY` | Frontend & Server | Public / Bundled | **Yes** | `ey...` (Anon public key) | Public Supabase anon key for client authentication. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server Only | **Secret (Server Only)** | **Yes** | `ey...` (Service role key) | High-privilege key used exclusively by backend routes to verify active staff and execute atomic grants. **Never expose to frontend!** |
| `PAYSTACK_SECRET_KEY` | Server Only | **Secret (Server Only)** | **Yes** | `sk_live_...` or `sk_test_...` | Paystack secret API key used for checkout initialization and transaction verification. |
| `PAYSTACK_PUBLIC_KEY` | Server / Client | Public / Reference | Optional | `pk_live_...` or `pk_test_...` | Paystack public key. |
| `PAYSTACK_WEBHOOK_SECRET` | Server Only | **Secret (Server Only)** | **Yes** (for modern) | `whsec_live_...` or `whsec_test_...` | Dedicated webhook signing secret from Paystack Dashboard. |
| `PAYSTACK_SIGNATURE_MODE` | Server Only | Server Config | Optional | `modern`, `legacy`, `auto` | Enforces webhook HMAC scheme. Recommended `modern` in production to prevent signature downgrade attacks. |
| `PAYSTACK_MODE` | Server Only | Server Config | Optional | `live` or `test` | Gateway operating mode. Inferred from `PAYSTACK_SECRET_KEY` prefix if omitted. |
| `APP_URL` | Server Only | Server Config | **Yes** | Fully qualified URL | Base application URL for callback redirection (e.g. `https://ehi-multisystems-fl85.vercel.app`). |

---

## 5. Webhook & Callback Endpoints

- **Live Application Domain**: `https://ehi-multisystems-fl85.vercel.app`
- **Supported Webhook Endpoints**:
  - `https://ehi-multisystems-fl85.vercel.app/api/paystack-webhook`
  - `https://ehi-multisystems-fl85.vercel.app/api/paystack/webhook`
  - `https://ehi-multisystems-fl85.vercel.app/api/billing/webhook`
- **Callback Endpoint**: `https://ehi-multisystems-fl85.vercel.app/billing/callback`

---

## 6. Owner Deployment Runbook (Manual Execution Steps)

### Step 1: Database Migration Application (Supabase Dashboard)
> **Note**: Database migrations have **not** been executed locally because an isolated PostgreSQL instance was unavailable in this development environment. The migration must be executed in the Supabase production project.

1. Open the [Supabase Dashboard](https://supabase.com/dashboard).
2. Select the EHI Multisystems project.
3. Navigate to **SQL Editor** $\rightarrow$ **New Query**.
4. Paste and execute the migration file:
   [`supabase/migrations/20261108141640_auto_billing_paystack_entitlements.sql`](file:///workspace/ehi-scheduled-cloud-lock/supabase/migrations/20261108141640_auto_billing_paystack_entitlements.sql)
5. Verify creation of tables, schemas, and initial singleton:
   ```sql
   SELECT * FROM public.ehi_entitlement;
   ```
   Confirm row exists with `company_id = 'EHI'`, `status = 'expired'`, `is_active = false`.

### Step 2: Configure Environment Variables in Vercel
1. In the Vercel Dashboard, select **ehi-multisystems-fl85** $\rightarrow$ **Settings** $\rightarrow$ **Environment Variables**.
2. Confirm the complete variable list is set for Production and Preview:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PAYSTACK_SECRET_KEY`
   - `PAYSTACK_WEBHOOK_SECRET`
   - `PAYSTACK_SIGNATURE_MODE` = `modern`
   - `PAYSTACK_MODE` = `live`
   - `APP_URL` = `https://ehi-multisystems-fl85.vercel.app`

### Step 3: Configure Webhook in Paystack Dashboard
1. Log in to the [Paystack Dashboard](https://dashboard.paystack.com/).
2. Navigate to **Settings** $\rightarrow$ **Preferences** $\rightarrow$ **API Configuration & Webhooks**.
3. Set **Live Webhook URL** to:
   `https://ehi-multisystems-fl85.vercel.app/api/paystack-webhook`
4. Copy the Webhook Secret and paste it into Vercel as `PAYSTACK_WEBHOOK_SECRET`.

### Step 4: Verification
1. Verify CI build and lint passes on PR #12.
2. Review remaining test and code corrections.
