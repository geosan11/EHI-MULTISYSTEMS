-- ============================================================
-- GAT TERMINAL: tag Lagos entries by terminal + batch-print stamps
-- ============================================================
-- GAT (General Aviation Terminal / MM1, Ikeja) is NOT a new hub -- it's a
-- second physical counter for the existing LOS hub, sharing the same AWB
-- series, rates, and EOD. `terminal` is just a tag on which physical desk
-- logged the entry, defaulting to 'MMA2' (the existing station) so every
-- pre-existing row is correctly classified with zero backfill needed.
--
-- tag_printed_at/receipt_printed_at exist so GAT Print Queue (MMA2 batch-
-- prints for GAT, which has no printers) can tell which entries still need
-- printing without a separate tracking table.
ALTER TABLE public.cargo_entries
  ADD COLUMN IF NOT EXISTS terminal text NOT NULL DEFAULT 'MMA2'
    CHECK (terminal IN ('MMA2','GAT')),
  ADD COLUMN IF NOT EXISTS tag_printed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_printed_at timestamptz;

ALTER TABLE public.package_entries
  ADD COLUMN IF NOT EXISTS terminal text NOT NULL DEFAULT 'MMA2'
    CHECK (terminal IN ('MMA2','GAT')),
  ADD COLUMN IF NOT EXISTS tag_printed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_printed_at timestamptz;

CREATE INDEX IF NOT EXISTS cargo_entries_terminal_idx
  ON public.cargo_entries (terminal) WHERE terminal = 'GAT';
CREATE INDEX IF NOT EXISTS package_entries_terminal_idx
  ON public.package_entries (terminal) WHERE terminal = 'GAT';

-- NOTE: this CHECK is safe (unlike the drifted status one, see
-- 20260830_drop_cargo_status_check_drift.sql) because it is IN the
-- migration history, and the app only ever writes the two allowed values
-- from a segmented control -- not free text.
