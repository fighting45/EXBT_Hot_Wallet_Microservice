ALTER TABLE exbt_withdrawals
  ADD COLUMN IF NOT EXISTS webhook_status varchar(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS webhook_error  text;

CREATE INDEX IF NOT EXISTS exbt_withdrawals_webhook_status_idx
  ON exbt_withdrawals (webhook_status);

-- Mark all existing completed/failed withdrawals as delivered
-- so the retry loop doesn't spam old webhooks on first startup
UPDATE exbt_withdrawals
SET webhook_status = 'delivered'
WHERE status IN ('completed', 'failed');
