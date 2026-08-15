-- Retention for the sync change log.
--
-- `sync_changes` is append-only and grows forever: every recipe edit, shopping
-- tick and meal-plan change adds a row, and nothing has ever removed one. Same
-- for `sync_operations`, the idempotency ledger.
--
-- Pruning on its own would be silently wrong. A client whose cursor sits below
-- the pruned range asks for "everything after seq N", gets only the rows that
-- survived, and never learns that the rows between N and the cutoff existed —
-- it would look up to date while missing changes permanently.
--
-- So the prune records how far it got, per household, and `pull()` refuses a
-- cursor that predates that watermark with SyncCursorError. That surfaces as
-- `invalid_request`, which the sync engine already handles by clearing the
-- local store and taking a fresh snapshot (see sync-engine.ts). A client that
-- has been offline longer than the retention window therefore resyncs from
-- scratch instead of silently diverging.

CREATE TABLE IF NOT EXISTS sync_prune_state (
  household_id   uuid PRIMARY KEY,
  -- Highest seq that has been deleted for this household. A cursor at or above
  -- this is still safe to serve deltas for; anything below has holes.
  pruned_through bigint      NOT NULL,
  pruned_at      timestamptz NOT NULL DEFAULT now()
);

-- Deliberately no FK to households, for the same reason sync_changes has none:
-- this outlives the rows it describes.
