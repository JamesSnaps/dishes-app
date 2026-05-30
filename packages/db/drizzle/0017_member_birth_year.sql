-- Add optional birth year to household members so the AI can tailor
-- suggestions to children / age (e.g. simple toddler lunches).
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS birth_year integer;
