-- An integration token can act as one household member, so a write that
-- belongs to someone (logging a meal eaten out, with their rating) is theirs.
-- Removing the member leaves the token household-only.

ALTER TABLE "integration_tokens" ADD COLUMN IF NOT EXISTS "member_id" uuid REFERENCES "household_members"("id") ON DELETE SET NULL;
