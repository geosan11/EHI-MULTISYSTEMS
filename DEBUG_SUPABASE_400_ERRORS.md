# Supabase 400 Error Debugging Report

**Date:** 2026-07-13  
**Status:** Root cause identified, migrations staged  
**Severity:** High - Blocks "All Entries" page load

---

## Executive Summary

The app's main data-loading page (EHIApp.tsx initialization) makes 4 parallel queries to fetch transactions. All 4 are failing with 400 errors due to **missing database columns** that haven't been migrated yet.

**Root Cause:** Migration files exist but haven't been applied to the Supabase database.

---

## Error Manifest

### Network Errors Observed

```
manifests?select=transaction_id,passenger_name,...,payment_history,airline — 400
marketing_entries?select=entry_ref,...,debt_amount_paid,payment_history — 400
package_entries?select=entry_ref,...,contents,status,debt_paid,debt_paid_at — 400
cargo_entries?on_conflict=entry_ref — 400
```

---

## Root Cause Analysis

### **1. MANIFESTS Table** ❌
**Query Line:** `src/components/EHIApp.tsx:213`

```javascript
supabase.from('manifests')
  .select('transaction_id,passenger_name,flight_no,destination,excess_kg,amount,payment_mode,created_at,bank,hub_id,total_kg,pnr,passenger_phone,total_pcs,amount_paid,payment_history,airline')
```

**Missing Columns:**
- `payment_history` → Defined in `20260710_debt_payment_columns.sql`
- `airline` → Defined in `20260723_excess_baggage_airlines.sql`

**Impact:** Entire baggage manifest ledger fails to load

---

### **2. MARKETING_ENTRIES Table** ❌
**Query Line:** `src/components/EHIApp.tsx:214`

```javascript
supabase.from('marketing_entries')
  .select('entry_ref,awb_tag_number,customer_name,route,qty_big_bag,qty_med_bag,qty_small_bag,bb_kg,mb_kg,sb_kg,amount_paid,payment_mode,created_at,hub_id,bank,entered_by,user_profiles(name),debt_amount_paid,payment_history')
```

**Missing Columns:**
- `debt_amount_paid` → Defined in `20260710_debt_payment_columns.sql` (special column for marketing)
- `payment_history` → Defined in `20260710_debt_payment_columns.sql`

**Impact:** Marketing bag ledger fails to load; debt tracking broken

---

### **3. PACKAGE_ENTRIES Table** ❌
**Query Line:** `src/components/EHIApp.tsx:215`

```javascript
supabase.from('package_entries')
  .select('entry_ref,customer_name,destination,content_type,total_pcs,total_kg,contents,status,amount,payment_mode,bank,payment_narration,debt_paid,debt_paid_at,created_at,hub_id')
```

**Missing Columns** (from handleUpdateTx requirements):
- `amount_paid` → Defined in `20260719_package_payment_columns.sql`
- `payment_history` → Defined in `20260719_package_payment_columns.sql`
- `payment_confirmed` → Defined in `20260719_package_payment_columns.sql`
- `pos_approval_code` → Defined in `20260719_package_payment_columns.sql`
- `confirmed_by` → Defined in `20260719_package_payment_columns.sql`
- `confirmed_at` → Defined in `20260719_package_payment_columns.sql`

**Impact:** Package desk completely broken; payment updates fail silently

---

### **4. CARGO_ENTRIES Table** ❌
**Query Line:** `src/components/EHIApp.tsx:212`

```javascript
supabase.from('cargo_entries')
  .select(`entry_ref,consignee_name,airline,commission_rate,awb_tag_number,total_pcs,total_kg,route,content_type,amount,receipt_mode,created_at,status,bank,hub_id,amount_paid,payment_history`)
```

**Missing Columns:**
- `amount_paid` → Defined in `20260710_debt_payment_columns.sql`
- `payment_history` → Defined in `20260710_debt_payment_columns.sql`

**Impact:** Cargo ledger fails to load

---

## Migration Files Ready to Apply

All 3 migrations already exist in the repository:

| File | Purpose | Status |
|------|---------|--------|
| `supabase/migrations/20260710_debt_payment_columns.sql` | Adds payment tracking to cargo, manifests, marketing | ✅ Ready |
| `supabase/migrations/20260719_package_payment_columns.sql` | Adds payment tracking to packages | ✅ Ready |
| `supabase/migrations/20260723_excess_baggage_airlines.sql` | Creates airline registry table + adds airline column to manifests | ✅ Ready |

---

## Application Steps

### Manual (via Supabase UI)

1. Go to https://app.supabase.com → Project wzvqdscrtetlodavddbx → SQL Editor
2. Run each migration in order:
   - `20260710_debt_payment_columns.sql`
   - `20260719_package_payment_columns.sql`
   - `20260723_excess_baggage_airlines.sql`

### Via Supabase CLI (Recommended)

```bash
cd supabase
supabase push --project-ref wzvqdscrtetlodavddbx
```

---

## Verification

After applying migrations, run:

```sql
-- All 4 tables should have their required columns
SELECT column_name FROM information_schema.columns 
WHERE table_name IN ('cargo_entries', 'manifests', 'marketing_entries', 'package_entries')
ORDER BY table_name, column_name;
```

---

## Post-Fix Checklist

- [ ] All 3 migrations applied to Supabase
- [ ] Verification query shows all columns present
- [ ] Browser console shows no 400 errors
- [ ] "All Entries" page loads successfully
- [ ] Transaction editing works (Payment Validation modal)
- [ ] Debt payment recording works (CreditDebit tab)

---

## Related Code

- **Query Location:** `src/components/EHIApp.tsx` lines 212-215 (`fetchInitial()`)
- **Update Handler:** `src/components/EHIApp.tsx` (`handleUpdateTx()`) - writes to all 4 tables
- **Type Definition:** `src/lib/types.ts` (`Transaction` interface)

---

## Timeline

- **2026-07-06:** Initial schema created (20260706_full_schema.sql)
- **2026-07-10:** Debt payment columns added (20260710_debt_payment_columns.sql)
- **2026-07-19:** Package payment columns added (20260719_package_payment_columns.sql)
- **2026-07-23:** Excess baggage airlines generalized (20260723_excess_baggage_airlines.sql)
- **2026-07-13:** 🔴 Error discovered — migrations not applied to live DB

---

## Notes

- Migrations use `IF NOT EXISTS` — safe to re-run multiple times
- No data migration required — all columns have sensible defaults
- RLS policies already in place and compatible with new columns
- Changes are backward-compatible with existing code

---

**Next Step:** Apply migrations to Supabase database.
