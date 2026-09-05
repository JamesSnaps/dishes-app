-- Null until the member finishes (or skips) the welcome wizard.
ALTER TABLE household_members
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp;

-- Existing members have already found their way around; don't greet them.
UPDATE household_members
  SET onboarding_completed_at = now()
  WHERE onboarding_completed_at IS NULL;
