-- Non-KYC USDT BEP-20 withdrawal requests
CREATE TABLE IF NOT EXISTS usdt_withdrawals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       BIGINT       NOT NULL,
  to_address    VARCHAR(42)  NOT NULL,
  amount        NUMERIC(36, 18) NOT NULL,
  gas_fee       NUMERIC(36, 18),
  tx_hash       VARCHAR(66),
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending',   -- pending | processing | completed | failed
  error_message TEXT,
  webhook_status VARCHAR(20) NOT NULL DEFAULT 'pending',   -- pending | delivered
  webhook_error  TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_user_id        ON usdt_withdrawals (user_id);
CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_status         ON usdt_withdrawals (status);
CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_webhook_status ON usdt_withdrawals (webhook_status);
