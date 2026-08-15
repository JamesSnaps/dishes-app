-- Sync foundation: a change log written by database triggers, plus an
-- idempotency ledger for uploaded mutations.
--
-- Why triggers rather than updated_at/deleted_at columns on every table:
--   * Deletes are captured without adopting soft deletes app-wide. Every
--     existing hard delete keeps working, and none can silently break sync.
--   * Anything that writes is captured — server actions, REST routes, a future
--     worker, or a manual psql fix. There is no "I forgot to bump updated_at".
--   * seq is a bigserial, so the sync cursor is a sequence number rather than a
--     timestamp. No clock skew, no overlap window, no duplicate-window fudge.
--
-- Granularity is the aggregate root. Editing an ingredient, step or tag logs a
-- change against its *recipe*, so a client refetches one recipe rather than
-- reassembling it from child-row deltas.

-- ---------------------------------------------------------------------------
-- Change log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync_changes (
  seq          bigserial PRIMARY KEY,
  household_id uuid        NOT NULL,
  entity       varchar(40) NOT NULL,
  entity_id    uuid        NOT NULL,
  op           varchar(10) NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

-- Deliberately no FK to households: a tombstone must outlive the row it
-- describes, and cascade behaviour would be the wrong shape here.

CREATE INDEX IF NOT EXISTS sync_changes_household_seq_idx
  ON sync_changes (household_id, seq);

-- ---------------------------------------------------------------------------
-- Idempotency ledger for POST /api/v1/sync
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync_operations (
  op_id        uuid PRIMARY KEY,
  household_id uuid        NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  result       jsonb
);

CREATE INDEX IF NOT EXISTS sync_operations_household_idx
  ON sync_operations (household_id, applied_at);

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------

-- For tables that carry household_id and are their own aggregate root.
--   TG_ARGV[0] = entity label
CREATE OR REPLACE FUNCTION sync_log_self() RETURNS trigger AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;

  INSERT INTO sync_changes (household_id, entity, entity_id, op)
  VALUES (
    r.household_id,
    TG_ARGV[0],
    r.id,
    CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END
  );

  RETURN NULL; -- AFTER trigger; return value is ignored
END;
$$ LANGUAGE plpgsql;

-- For tables whose household must be resolved through a parent row.
--   TG_ARGV[0] = entity label
--   TG_ARGV[1] = column on this row holding the entity id to report
--   TG_ARGV[2] = column on this row holding the parent id
--   TG_ARGV[3] = parent table name (must have id + household_id)
--
-- When the parent no longer exists the change is NOT logged. That matters:
-- deleting a recipe cascades to its ingredients, and those cascaded child
-- deletes would otherwise log 'upsert' rows for the recipe *after* its own
-- 'delete' row, resurrecting it on the next pull.
CREATE OR REPLACE FUNCTION sync_log_parent() RETURNS trigger AS $$
DECLARE
  r           record;
  v_entity_id uuid;
  v_parent_id uuid;
  v_household uuid;
  v_op        text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;

  EXECUTE format('SELECT ($1).%I', TG_ARGV[1]) INTO v_entity_id USING r;
  EXECUTE format('SELECT ($1).%I', TG_ARGV[2]) INTO v_parent_id USING r;

  EXECUTE format('SELECT household_id FROM %I WHERE id = $1', TG_ARGV[3])
    INTO v_household USING v_parent_id;

  IF v_household IS NULL THEN
    RETURN NULL; -- parent gone: this is cascade fallout, not a real change
  END IF;

  -- A child row reporting its parent's id (recipe ingredients, steps, tags) is
  -- always an edit of the parent, never a deletion of it.
  IF TG_OP = 'DELETE' AND TG_ARGV[1] = 'id' THEN
    v_op := 'delete';
  ELSE
    v_op := 'upsert';
  END IF;

  INSERT INTO sync_changes (household_id, entity, entity_id, op)
  VALUES (v_household, TG_ARGV[0], v_entity_id, v_op);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS sync_recipes ON recipes;
CREATE TRIGGER sync_recipes AFTER INSERT OR UPDATE OR DELETE ON recipes
  FOR EACH ROW EXECUTE FUNCTION sync_log_self('recipe');

DROP TRIGGER IF EXISTS sync_recipe_ingredients ON recipe_ingredients;
CREATE TRIGGER sync_recipe_ingredients AFTER INSERT OR UPDATE OR DELETE ON recipe_ingredients
  FOR EACH ROW EXECUTE FUNCTION sync_log_parent('recipe', 'recipe_id', 'recipe_id', 'recipes');

DROP TRIGGER IF EXISTS sync_recipe_steps ON recipe_steps;
CREATE TRIGGER sync_recipe_steps AFTER INSERT OR UPDATE OR DELETE ON recipe_steps
  FOR EACH ROW EXECUTE FUNCTION sync_log_parent('recipe', 'recipe_id', 'recipe_id', 'recipes');

DROP TRIGGER IF EXISTS sync_recipe_tags ON recipe_tags;
CREATE TRIGGER sync_recipe_tags AFTER INSERT OR UPDATE OR DELETE ON recipe_tags
  FOR EACH ROW EXECUTE FUNCTION sync_log_parent('recipe', 'recipe_id', 'recipe_id', 'recipes');

DROP TRIGGER IF EXISTS sync_shopping_lists ON shopping_lists;
CREATE TRIGGER sync_shopping_lists AFTER INSERT OR UPDATE OR DELETE ON shopping_lists
  FOR EACH ROW EXECUTE FUNCTION sync_log_self('shopping_list');

DROP TRIGGER IF EXISTS sync_shopping_list_items ON shopping_list_items;
CREATE TRIGGER sync_shopping_list_items AFTER INSERT OR UPDATE OR DELETE ON shopping_list_items
  FOR EACH ROW EXECUTE FUNCTION sync_log_parent('shopping_item', 'id', 'list_id', 'shopping_lists');

DROP TRIGGER IF EXISTS sync_meal_plans ON meal_plans;
CREATE TRIGGER sync_meal_plans AFTER INSERT OR UPDATE OR DELETE ON meal_plans
  FOR EACH ROW EXECUTE FUNCTION sync_log_self('meal_plan');

DROP TRIGGER IF EXISTS sync_meal_plan_entries ON meal_plan_entries;
CREATE TRIGGER sync_meal_plan_entries AFTER INSERT OR UPDATE OR DELETE ON meal_plan_entries
  FOR EACH ROW EXECUTE FUNCTION sync_log_parent('meal_plan_entry', 'id', 'meal_plan_id', 'meal_plans');

DROP TRIGGER IF EXISTS sync_cook_history ON cook_history;
CREATE TRIGGER sync_cook_history AFTER INSERT OR UPDATE OR DELETE ON cook_history
  FOR EACH ROW EXECUTE FUNCTION sync_log_self('cook_history');
