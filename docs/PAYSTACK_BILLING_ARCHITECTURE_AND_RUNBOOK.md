# EHI Multisystems — Paystack Automatic Billing Architecture & Owner Runbook

This document details the complete production architecture, security specifications, database contracts, and owner deployment runbook for the automated Paystack payment gateway integration and singleton cloud entitlement unlocking system.

---

## 1. Architectural Overview

### A. Lifecycle & Entitlement Flow
1. **Scheduled Activation Gate**:
   - Activation epoch: `2026-11-09T07:58:00+01:00` (UTC `2026-11-09T06:58:00.000Z`, epoch `1794207480000`).
   - Prior to this timestamp, the operational platform is 100% usable with zero gates.
   - At or past activation, the `CloudPausedGate` mounts if no authoritative valid entitlement is active.
   - Public tracking (`/track` and `/track/:waybillId`) and billing callback (`/billing/callback`) are explicitly exempt from the gate.
   - Background operational engines (Dexie IndexedDB, offline queue, authentication listeners) remain mounted and running.

2. **Durable Server Checkout Initiation**:
   - Authorized staff member initiates checkout via `POST /api/billing/initialize` with their chosen plan ID (`november-bridge`, `monthly-licence`, or `system-handover`).
   - Server validates staff caller session in Supabase Auth and verifies the profile in `user_profiles`.
   - Bridge plan initiation is gated: rejected if current time $\ge$ `2026-12-01T00:00:00+01:00` (epoch `1796079600000`).
   - Server binds expected plan prices in NGN kobo (`6300000`, `18000000`, `70000000`), generates a cryptographically random reference (`ehi_<plan>_<timestamp>_<randomHex>`), and durably records the transaction in `billing_transactions` before communicating with Paystack.
   - Server calls Paystack API `POST https://api.paystack.co/transaction/initialize`.
   - The returned `authorization_url` is validated against allowlisted Paystack hosts (`checkout.paystack.com`, `standard.paystack.co`) before returning to the frontend.

3. **Authoritative Server Verification & Atomic Entitlement Grant**:
   - User completes payment on Paystack checkout and is redirected to `/billing/callback?reference=...`.
   - Simultaneously, Paystack delivers an asynchronous webhook event to `/api/paystack-webhook`.
   - Both pathways invoke the same authoritative server verification and atomic database RPC `apply_billing_grant_atomic`.
   - Row-level locking (`SELECT ... FOR UPDATE`) guarantees complete idempotency: whichever pathway commits first grants entitlement, and subsequent attempts return the confirmed status with zero double-granting.
   - Frontend querystrings, local storage flags, or client devtools manipulation **never** grant access without server confirmation.

4. **Offline Resilience & Cache Policy**:
   - Last-confirmed valid entitlement is cached locally in `localStorage` under account-safe key `ehi_entitlement_v1_EHI` with a cryptographic signature.
   - When offline, devices with active coverage remain unlocked through their confirmed `paid_until` date (eliminating flash locks).
   - Authoritative online server status overrides cache immediately.
   - If server confirms status is inactive or expired, the local cache is immediately cleared.
   - If status is unknown after activation schedule, the gate locks (no indefinite failopen).
   - While locked or pending, the frontend polls `/api/billing/entitlement` every 10 seconds and re-verifies immediately on window `focus`, network `online`, or document visibility change.

---

## 2. Plan Catalog, Precedence & Expiry Mathematics

| Plan | Price (NGN) | Expected Kobo | Validity / Coverage | Renewal & Precedence Rules |
| :--- | :--- | :--- | :--- | :--- |
| **November Cloud Bridge** | ₦63,000 | `6300000` | Fixed through `2026-11-30T23:59:59+01:00` | Non-renewable. Initiation cutoff: `2026-12-01T00:00:00+01:00`. Late bridge payments confirmed after Nov 30 cutoff record as `expired_bridge_resolution_required` needing manual billing resolution (no automatic refund). Never shortens longer existing coverage or permanent handover. |
| **Monthly System Licence** | ₦180,000 | `18000000` | 30 days coverage | Exactly `max(existing_paid_until, now) + 30 days` minimum. Never shortens existing longer coverage. No stacking; early checkout is discouraged in UI unless nearing expiration. |
| **Full System Handover** | ₦700,000 | `70000000` | Permanent (`paid_until = NULL`, `is_permanent = true`) | Permanent buyout. Takes highest precedence. Subsequent monthly or bridge purchases can never downgrade or overwrite permanent status. |

---

## 3. Webhook Signature Verification Specification

Paystack delivers webhooks with cryptographic signatures. Our implementation in `server/billing/paystackService.ts` supports both current Paystack signature schemes:

### A. Modern Timestamped Scheme (`Paystack-Signature`)
- **Header**: `Paystack-Signature: t=<unix_timestamp>,v1=<key_id>:<hex_signature>`
- **Signing Secret**: Dedicated Webhook Secret starting with `whsec_` (configured via `PAYSTACK_WEBHOOK_SECRET`).
- **Algorithm**: `HMAC-SHA512`
- **String to Sign**: `${t}.${rawBodyBytes}`
- **Tolerance**: 300 seconds (5 minutes) anti-replay protection.
- **Key Rotation**: Multiple `v1=` tokens are supported.

### B. Legacy Scheme (`x-paystack-signature`)
- **Header**: `x-paystack-signature: <hex_signature>`
- **Signing Secret**: Paystack API Secret Key starting with `sk_` (configured via `PAYSTACK_SECRET_KEY`).
- **Algorithm**: `HMAC-SHA512`
- **String to Sign**: `${rawBodyBytes}`

### C. Signature Mode Configuration & No Downgrade Fallback
- `PAYSTACK_SIGNATURE_MODE`: `'modern' | 'legacy' | 'auto'`
- **Strict Security Policy**: When configured in `'modern'` mode, legacy header fallback is **strictly disabled**. Requests lacking valid modern signatures are immediately rejected with HTTP 400.
- **Raw Bytes Verification**: Express middleware registers `express.raw({ type: '*/*', limit: '1mb' })` on `/api/paystack-webhook` and preserves exact raw request buffers before any JSON parsing occurs, ensuring cryptographic HMAC validity under all Vercel/Node runtime environments.

---

## 4. Server Environment Variables

> **CRITICAL SECURITY NOTE**: Never prefix payment gateway secrets with `VITE_` or `NEXT_PUBLIC_`. Payment secrets must exist strictly server-side in Vercel environment settings.

| Environment Variable | Required | Allowed Values | Description |
| :--- | :--- | :--- | :--- |
| `PAYSTACK_SECRET_KEY` | **Yes** | `sk_test_...` or `sk_live_...` | Paystack secret API key. Used for backend transaction initialization, verification API calls, and legacy webhook signing. |
| `PAYSTACK_PUBLIC_KEY` | Optional | `pk_test_...` or `pk_live_...` | Paystack public key for client reference. |
| `PAYSTACK_WEBHOOK_SECRET` | **Yes** (for modern) | `whsec_test_...` or `whsec_live_...` | Dedicated webhook signing secret generated in Paystack Dashboard under Developers > API Configuration. |
| `PAYSTACK_SIGNATURE_MODE` | Optional | `modern` (default if whsec set), `legacy`, `auto` | Enforces webhook verification scheme. Choose `modern` in production to prevent downgrade attacks. |
| `PAYSTACK_MODE` | Optional | `test` or `live` | Environment mode. Inferred from `PAYSTACK_SECRET_KEY` prefix (`sk_live_` $\rightarrow$ live, `sk_test_` $\rightarrow$ test) if omitted. Prevents test events from unlocking live environments. |
| `APP_URL` | **Yes** | Fully qualified URL | Base application URL used for callback redirection (e.g. `https://ehi-multisystems-fl85.vercel.app` or `https://YOUR_APP_DOMAIN`). |

---

## 5. Webhook & Callback URLs

- **Known Live Application Domain**: `https://ehi-multisystems-fl85.vercel.app`
- **Webhook Endpoint URL**: `https://ehi-multisystems-fl85.vercel.app/api/paystack-webhook` (alias: `/api/paystack/webhook`)
- **Callback Endpoint URL**: `https://ehi-multisystems-fl85.vercel.app/billing/callback`
- **Generic Placeholder Format**:
  - `https://YOUR_APP_DOMAIN/api/paystack-webhook`
  - `https://YOUR_APP_DOMAIN/billing/callback`

---

## 6. Owner Deployment Runbook (Manual Setup Steps)

To promote this implementation to production without breaking existing counters or databases, execute the following steps in sequence:

### Step 1: Database Migration Review & Application
1. Review the generated migration file:
   [`supabase/migrations/20261108141640_auto_billing_paystack_entitlements.sql`](file:///workspace/ehi-scheduled-cloud-lock/supabase/migrations/20261108141640_auto_billing_paystack_entitlements.sql)
2. In the Supabase Dashboard, navigate to **SQL Editor**.
3. Paste and execute the migration script to create:
   - `public.ehi_entitlement` singleton table with RLS.
   - `public.billing_transactions` table with RLS and foreign keys.
   - `public.apply_billing_grant_atomic` security-definer function with pinned `search_path`.
4. Verify table creation:
   ```sql
   SELECT * FROM public.ehi_entitlement;
   ```
   Confirm the default singleton row is initialized (`company_id = 'EHI'`, `status = 'expired'`).

### Step 2: Configure Server Environment Variables in Vercel
1. In the Vercel Dashboard, open project **ehi-multisystems-fl85** $\rightarrow$ **Settings** $\rightarrow$ **Environment Variables**.
2. Add the following variables (for Production and Preview environments):
   - `PAYSTACK_SECRET_KEY` = `sk_live_...` (or `sk_test_...` for staging)
   - `PAYSTACK_WEBHOOK_SECRET` = `whsec_...`
   - `PAYSTACK_SIGNATURE_MODE` = `modern`
   - `PAYSTACK_MODE` = `live` (or `test` for staging)
   - `APP_URL` = `https://ehi-multisystems-fl85.vercel.app`

### Step 3: Configure Webhook in Paystack Dashboard
1. Log in to your [Paystack Dashboard](https://dashboard.paystack.com/).
2. Navigate to **Settings** $\rightarrow$ **Preferences** $\rightarrow$ **API Configuration & Webhooks**.
3. Set **Live Webhook URL** to:
   `https://ehi-multisystems-fl85.vercel.app/api/paystack-webhook`
4. Set **Test Webhook URL** (if using test keys) to your preview or staging domain.
5. Copy the generated Webhook Secret (`whsec_...`) and ensure it matches `PAYSTACK_WEBHOOK_SECRET` in Vercel.

### Step 4: Merge PR #12 & Deploy
1. Review the GitHub Pull Request #12 (`feat/scheduled-cloud-lock`).
2. Verify all CI checks (linting, production build, unit tests) have passed.
3. Merge PR #12 into `main` and allow Vercel to complete deployment.

---

## 7. Operational Limitations & Support Guidelines

1. **Late Bridge Confirmations**:
   - The November Cloud Bridge is non-renewable and valid strictly through `2026-11-30T23:59:59+01:00`.
   - If a bridge transaction is initiated before cutoff but confirmed by Paystack **after** `2026-11-30T23:59:59+01:00`, the server records the transaction as `expired_bridge_resolution_required`.
   - **No automatic refund** is issued by the platform.
   - The user interface directs the payer to contact administrative billing support, where the credit can be manually applied toward a monthly licence or system handover in the database.

2. **Refunds & Chargebacks**:
   - The system does not automate chargeback deductions or refund webhooks.
   - Any financial refunds or chargebacks must be handled manually via the Paystack dashboard and reflected in the database by updating `public.ehi_entitlement` (`status = 'expired'`, `is_active = false`).

3. **Client-Side Clock Tamper Limitation**:
   - While `localStorage` entitlement data is protected with an integrity checksum, client-side clocks are subject to user tampering in developer tools.
   - However, operational server APIs, Supabase RLS, and periodic 10-second server polling ensure that authoritative online state always prevails.

4. **Integration Testing Evidence**:
   - Tested using comprehensive unit, mock, boundary, and scheduler test suites (`npm test`: 75 passing tests across 27 suites).
   - Zero live financial transactions were executed during development.
   - No production SQL modifications were made.

---

## 8. Documentation Sources & Official References

- [Paystack Webhooks Documentation (Retrieved Nov 8, 2026)](https://paystack.com/docs/payments/webhooks/)
- [Paystack Transaction API Reference](https://paystack.com/docs/api/transaction/)
- [Supabase Postgres Row-Level Security Guidelines](https://supabase.com/docs/guides/database/postgres/row-level-security.md)
