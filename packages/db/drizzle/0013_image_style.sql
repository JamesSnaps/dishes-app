ALTER TABLE ai_configurations
  ADD COLUMN IF NOT EXISTS image_style varchar(50) NOT NULL DEFAULT 'studio';
