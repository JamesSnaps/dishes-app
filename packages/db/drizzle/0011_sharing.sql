CREATE TABLE IF NOT EXISTS share_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_by_id uuid REFERENCES household_members(id) ON DELETE SET NULL,
  token varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS smtp_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL UNIQUE REFERENCES households(id) ON DELETE CASCADE,
  host varchar(255) NOT NULL,
  port integer NOT NULL DEFAULT 587,
  username varchar(255) NOT NULL,
  encrypted_password text NOT NULL,
  from_address varchar(255) NOT NULL,
  from_name varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
