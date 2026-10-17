-- Saved meals sync to offline clients (see 0025_sync_change_log.sql).
--
-- A saved meal is one aggregate: editing a slot or an option logs a change
-- against its *meal*, so a client refetches the whole meal document rather
-- than reassembling it from child-row deltas — the same shape as recipes.

DROP TRIGGER IF EXISTS sync_meals ON meals;
CREATE TRIGGER sync_meals AFTER INSERT OR UPDATE OR DELETE ON meals
  FOR EACH ROW EXECUTE FUNCTION sync_log_self('meal');

DROP TRIGGER IF EXISTS sync_meal_slots ON meal_slots;
CREATE TRIGGER sync_meal_slots AFTER INSERT OR UPDATE OR DELETE ON meal_slots
  FOR EACH ROW EXECUTE FUNCTION sync_log_parent('meal', 'meal_id', 'meal_id', 'meals');

-- Options sit two levels below the meal (option -> slot -> meal), which
-- sync_log_parent can't reach, so they get their own function. Same rule:
-- when the slot or meal is already gone this is cascade fallout from deleting
-- it, and logging an upsert would resurrect a deleted meal on the next pull.
CREATE OR REPLACE FUNCTION sync_log_meal_slot_option() RETURNS trigger AS $$
DECLARE
  r           record;
  v_meal_id   uuid;
  v_household uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;

  SELECT m.id, m.household_id INTO v_meal_id, v_household
  FROM meal_slots s
  JOIN meals m ON m.id = s.meal_id
  WHERE s.id = r.slot_id;

  IF v_household IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO sync_changes (household_id, entity, entity_id, op)
  VALUES (v_household, 'meal', v_meal_id, 'upsert');

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_meal_slot_options ON meal_slot_options;
CREATE TRIGGER sync_meal_slot_options AFTER INSERT OR UPDATE OR DELETE ON meal_slot_options
  FOR EACH ROW EXECUTE FUNCTION sync_log_meal_slot_option();

-- meal_components was folded into meal_slots by 0036 and dropped. Guarded in
-- case a database still has it, so its rows roll up to the meal too.
DO $$
BEGIN
  IF to_regclass('public.meal_components') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS sync_meal_components ON meal_components;
    CREATE TRIGGER sync_meal_components AFTER INSERT OR UPDATE OR DELETE ON meal_components
      FOR EACH ROW EXECUTE FUNCTION sync_log_parent('meal', 'meal_id', 'meal_id', 'meals');
  END IF;
END $$;

-- Existing saved meals were written before these triggers, so a client
-- pulling deltas would never hear about them. Log each once so they arrive on
-- the next pull. Guarded so a re-run doesn't log them again.
INSERT INTO sync_changes (household_id, entity, entity_id, op)
SELECT m.household_id, 'meal', m.id, 'upsert'
FROM meals m
WHERE NOT EXISTS (
  SELECT 1 FROM sync_changes c WHERE c.entity = 'meal' AND c.entity_id = m.id
);
