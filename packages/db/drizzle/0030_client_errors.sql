-- Browser crash reports, so "Application error: a client-side exception has
-- occurred" can be read back in the app instead of only in `docker logs`.
CREATE TABLE IF NOT EXISTS client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  stack text,
  digest varchar(100),
  url varchar(300),
  source varchar(50),
  user_agent varchar(250),
  app_version varchar(20),
  authelia_user varchar(100),
  household_id uuid,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_errors_created_at_idx ON client_errors (created_at);
