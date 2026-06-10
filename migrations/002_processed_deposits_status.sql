ALTER TABLE exbt_processed_deposits
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'processed',
  ADD COLUMN IF NOT EXISTS raw_payload text;

CREATE INDEX IF NOT EXISTS exbt_processed_deposits_status_idx
  ON exbt_processed_deposits (status);
