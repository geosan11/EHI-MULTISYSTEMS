-- =============================================================
-- Retrieval approval (post-hoc review stamp) + can_approve_retrievals permission
-- (Real authoring date: 2026-07-23. Filename prefixed 2026090x per
-- docs/MIGRATION_POLICY.md so it sorts after every migration already
-- applied to the live database.)
-- =============================================================
-- Retrieval itself stays exactly as-is (instant, any staff, wallet
-- refund/debt reduction applied immediately -- see the explicit design
-- comment on unretrieve_cargo_entry in 20260902_multi_department_
-- retrieval_and_wallet_cashout.sql). This migration adds a SEPARATE,
-- purely additive review step: authorized staff can mark an already-
-- processed retrieval as "approved" in the ledger, for oversight/audit
-- purposes. Approving never re-triggers any wallet or debt movement.
-- =============================================================

-- ─── 1. NEW GRANULAR PERMISSION ────────────────────────────────────────
-- Mirrors can_print_ledger/can_edit_remarks (super_admin grants this per
-- user via Staff Management). super_admin always implicitly has it,
-- matching how can_print_ledger's own gate works client-side.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS can_approve_retrievals boolean NOT NULL DEFAULT false;

-- ─── 2. APPROVAL-STAMP COLUMNS ON ALL 4 RETRIEVAL-TRACKING TABLES ──────
ALTER TABLE public.cargo_entries
  ADD COLUMN IF NOT EXISTS retrieval_approved     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retrieval_approved_by  text,
  ADD COLUMN IF NOT EXISTS retrieval_approved_at  timestamptz;

ALTER TABLE public.package_entries
  ADD COLUMN IF NOT EXISTS retrieval_approved     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retrieval_approved_by  text,
  ADD COLUMN IF NOT EXISTS retrieval_approved_at  timestamptz;

ALTER TABLE public.manifests
  ADD COLUMN IF NOT EXISTS retrieval_approved     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retrieval_approved_by  text,
  ADD COLUMN IF NOT EXISTS retrieval_approved_at  timestamptz;

ALTER TABLE public.marketing_entries
  ADD COLUMN IF NOT EXISTS retrieval_approved     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retrieval_approved_by  text,
  ADD COLUMN IF NOT EXISTS retrieval_approved_at  timestamptz;

-- ─── 3. SERVER-SIDE PERMISSION CHECK ───────────────────────────────────
-- Mirrors current_user_role()/is_hub_unrestricted()'s exact shape
-- (20260708_hub_isolation_rls.sql) -- SECURITY DEFINER so it can read
-- user_profiles without recursing into its own RLS. First SQL helper in
-- this codebase gating on a custom per-user boolean column rather than
-- role alone -- deliberate: the client-side toggle in Staff Management is
-- not sufficient on its own for an approval-authority permission (see the
-- wallet cash-payout role-check gap fixed alongside this in
-- 20260907_wallet_rpc_security_hardening.sql -- same lesson).
CREATE OR REPLACE FUNCTION public.current_user_can_approve_retrievals()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(role = 'super_admin' OR can_approve_retrievals, false)
  FROM public.user_profiles WHERE id = auth.uid();
$$;

-- ─── 4. APPROVE_*_RETRIEVAL RPCs, ONE PER DEPARTMENT ───────────────────
-- Same per-type family shape as process_*_retrieval/unretrieve_*_entry.
-- Hub check uses the same looser sibling_hub_ids()/is_hub_unrestricted()
-- model as the retrieval RPCs themselves (this reviews an already-
-- executed, already-visible action, not a new money movement) -- the
-- NEW restriction this adds is the role/permission check, which those
-- RPCs deliberately don't have (any staff can retrieve; only authorized
-- staff can approve).
CREATE OR REPLACE FUNCTION public.approve_cargo_retrieval(
  p_entry_ref   text,
  p_approved_by text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  IF public.current_user_role() <> 'super_admin' AND NOT public.current_user_can_approve_retrievals() THEN
    RAISE EXCEPTION 'Not authorized to approve retrievals';
  END IF;

  SELECT hub_id, retrieved_amount, retrieval_approved
  INTO v_entry
  FROM public.cargo_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cargo entry % not found', p_entry_ref;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to approve a retrieval for this entry''s hub';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Entry % has no retrieval to approve', p_entry_ref;
  END IF;

  IF v_entry.retrieval_approved THEN
    RAISE EXCEPTION 'Entry % retrieval is already approved', p_entry_ref;
  END IF;

  UPDATE public.cargo_entries SET
    retrieval_approved    = true,
    retrieval_approved_by = p_approved_by,
    retrieval_approved_at = now()
  WHERE entry_ref = p_entry_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_cargo_retrieval(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_package_retrieval(
  p_entry_ref   text,
  p_approved_by text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  IF public.current_user_role() <> 'super_admin' AND NOT public.current_user_can_approve_retrievals() THEN
    RAISE EXCEPTION 'Not authorized to approve retrievals';
  END IF;

  SELECT hub_id, retrieved_amount, retrieval_approved
  INTO v_entry
  FROM public.package_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package entry % not found', p_entry_ref;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to approve a retrieval for this entry''s hub';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Entry % has no retrieval to approve', p_entry_ref;
  END IF;

  IF v_entry.retrieval_approved THEN
    RAISE EXCEPTION 'Entry % retrieval is already approved', p_entry_ref;
  END IF;

  UPDATE public.package_entries SET
    retrieval_approved    = true,
    retrieval_approved_by = p_approved_by,
    retrieval_approved_at = now()
  WHERE entry_ref = p_entry_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_package_retrieval(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_baggage_retrieval(
  p_transaction_id text,
  p_approved_by    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  IF public.current_user_role() <> 'super_admin' AND NOT public.current_user_can_approve_retrievals() THEN
    RAISE EXCEPTION 'Not authorized to approve retrievals';
  END IF;

  SELECT hub_id, retrieved_amount, retrieval_approved
  INTO v_entry
  FROM public.manifests
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Baggage manifest % not found', p_transaction_id;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to approve a retrieval for this entry''s hub';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Entry % has no retrieval to approve', p_transaction_id;
  END IF;

  IF v_entry.retrieval_approved THEN
    RAISE EXCEPTION 'Entry % retrieval is already approved', p_transaction_id;
  END IF;

  UPDATE public.manifests SET
    retrieval_approved    = true,
    retrieval_approved_by = p_approved_by,
    retrieval_approved_at = now()
  WHERE transaction_id = p_transaction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_baggage_retrieval(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_marketing_retrieval(
  p_entry_ref   text,
  p_approved_by text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  IF public.current_user_role() <> 'super_admin' AND NOT public.current_user_can_approve_retrievals() THEN
    RAISE EXCEPTION 'Not authorized to approve retrievals';
  END IF;

  SELECT hub_id, retrieved_amount, retrieval_approved
  INTO v_entry
  FROM public.marketing_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Marketing entry % not found', p_entry_ref;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to approve a retrieval for this entry''s hub';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Entry % has no retrieval to approve', p_entry_ref;
  END IF;

  IF v_entry.retrieval_approved THEN
    RAISE EXCEPTION 'Entry % retrieval is already approved', p_entry_ref;
  END IF;

  UPDATE public.marketing_entries SET
    retrieval_approved    = true,
    retrieval_approved_by = p_approved_by,
    retrieval_approved_at = now()
  WHERE entry_ref = p_entry_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_marketing_retrieval(text, text) TO authenticated;

-- ─── 5. UNRETRIEVE: ALSO RESET THE APPROVAL STAMP ──────────────────────
-- An approval refers to a specific retrieval; once that retrieval is
-- undone, a stale "approved" stamp would misrepresent an entry that's
-- back at zero retrieved_amount as reviewed-and-approved. Same signature
-- as 20260902's originals -- safe CREATE OR REPLACE, no DROP needed.
CREATE OR REPLACE FUNCTION public.unretrieve_cargo_entry(
  p_entry_ref text,
  p_logged_by text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  SELECT id, hub_id, retrieved_amount, retrieved_pieces, retrieved_kg
  INTO v_entry
  FROM public.cargo_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cargo entry % not found', p_entry_ref;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to reverse a retrieval for this entry''s hub';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Entry % has no retrieval to reverse', p_entry_ref;
  END IF;

  UPDATE public.cargo_entries SET
    retrieved_pieces      = 0,
    retrieved_kg          = 0,
    retrieved_amount      = 0,
    retrieved             = false,
    status                = 'Intake',
    retrieval_approved    = false,
    retrieval_approved_by = NULL,
    retrieval_approved_at = NULL,
    retrieval_note        = COALESCE(retrieval_note || E'\n', '') ||
                        format('Retrieval reversed by %s (was %s pcs / %s kg / %s) -- any wallet credit from it is NOT auto-reversed, correct separately if needed',
                          p_logged_by, v_entry.retrieved_pieces, v_entry.retrieved_kg, v_entry.retrieved_amount)
  WHERE entry_ref = p_entry_ref;

  RETURN v_entry.retrieved_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unretrieve_cargo_entry(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unretrieve_package_entry(
  p_entry_ref text,
  p_logged_by text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  SELECT id, hub_id, retrieved_amount, retrieved_pieces, retrieved_kg
  INTO v_entry
  FROM public.package_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package entry % not found', p_entry_ref;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to reverse a retrieval for this entry''s hub';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Entry % has no retrieval to reverse', p_entry_ref;
  END IF;

  UPDATE public.package_entries SET
    retrieved_pieces      = 0,
    retrieved_kg          = 0,
    retrieved_amount      = 0,
    retrieved             = false,
    status                = 'Intake',
    retrieval_approved    = false,
    retrieval_approved_by = NULL,
    retrieval_approved_at = NULL,
    retrieval_note        = COALESCE(retrieval_note || E'\n', '') ||
                        format('Retrieval reversed by %s (was %s pcs / %s kg / %s) -- any wallet credit from it is NOT auto-reversed, correct separately if needed',
                          p_logged_by, v_entry.retrieved_pieces, v_entry.retrieved_kg, v_entry.retrieved_amount)
  WHERE entry_ref = p_entry_ref;

  RETURN v_entry.retrieved_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unretrieve_package_entry(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unretrieve_baggage_entry(
  p_transaction_id text,
  p_logged_by text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  SELECT id, hub_id, retrieved_amount, retrieved_pieces, retrieved_kg
  INTO v_entry
  FROM public.manifests
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Baggage manifest % not found', p_transaction_id;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to reverse a retrieval for this entry''s hub';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Entry % has no retrieval to reverse', p_transaction_id;
  END IF;

  UPDATE public.manifests SET
    retrieved_pieces      = 0,
    retrieved_kg          = 0,
    retrieved_amount      = 0,
    retrieved             = false,
    status                = 'Intake',
    retrieval_approved    = false,
    retrieval_approved_by = NULL,
    retrieval_approved_at = NULL,
    retrieval_note        = COALESCE(retrieval_note || E'\n', '') ||
                        format('Retrieval reversed by %s (was %s pcs / %s kg / %s) -- any wallet credit from it is NOT auto-reversed, correct separately if needed',
                          p_logged_by, v_entry.retrieved_pieces, v_entry.retrieved_kg, v_entry.retrieved_amount)
  WHERE transaction_id = p_transaction_id;

  RETURN v_entry.retrieved_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unretrieve_baggage_entry(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unretrieve_marketing_entry(
  p_entry_ref text,
  p_logged_by text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  SELECT id, hub_id, retrieved_amount, retrieved_pieces, retrieved_kg
  INTO v_entry
  FROM public.marketing_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Marketing entry % not found', p_entry_ref;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to reverse a retrieval for this entry''s hub';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Entry % has no retrieval to reverse', p_entry_ref;
  END IF;

  UPDATE public.marketing_entries SET
    retrieved_pieces      = 0,
    retrieved_kg          = 0,
    retrieved_amount      = 0,
    retrieved             = false,
    status                = 'Intake',
    retrieval_approved    = false,
    retrieval_approved_by = NULL,
    retrieval_approved_at = NULL,
    retrieval_note        = COALESCE(retrieval_note || E'\n', '') ||
                        format('Retrieval reversed by %s (was %s / %s) -- any wallet credit from it is NOT auto-reversed, correct separately if needed',
                          p_logged_by, v_entry.retrieved_pieces, v_entry.retrieved_amount)
  WHERE entry_ref = p_entry_ref;

  RETURN v_entry.retrieved_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unretrieve_marketing_entry(text, text) TO authenticated;

INSERT INTO public.schema_migrations (filename) VALUES ('20260906_retrieval_approval_and_permission.sql')
ON CONFLICT (filename) DO NOTHING;
