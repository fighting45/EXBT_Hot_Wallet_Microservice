-- ─────────────────────────────────────────────────────────────────────────────
-- 001_initial_schema.sql  —  EXBT HD wallet service v2
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS exbt_migrations (
  id         serial      PRIMARY KEY,
  filename   varchar(255) UNIQUE NOT NULL,
  applied_at timestamptz  NOT NULL DEFAULT now()
);

-- Maps each user to their unique HD-derived EVM address
CREATE TABLE IF NOT EXISTS exbt_wallet_addresses (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          bigint      NOT NULL,
  address          varchar(42) NOT NULL,
  derivation_index integer     NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exbt_wallet_addresses_user_id_unique  UNIQUE (user_id),
  CONSTRAINT exbt_wallet_addresses_address_unique  UNIQUE (address)
);
CREATE INDEX IF NOT EXISTS exbt_wallet_addresses_address_lower_idx
  ON exbt_wallet_addresses (LOWER(address));

-- Idempotency guard — prevents double-processing of deposits
CREATE TABLE IF NOT EXISTS exbt_processed_deposits (
  id           uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash      varchar(66)    NOT NULL,
  user_id      bigint         NOT NULL,
  address      varchar(42)    NOT NULL,
  amount       numeric(36,18) NOT NULL,
  block_number bigint         NOT NULL,
  processed_at timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT exbt_processed_deposits_tx_hash_unique UNIQUE (tx_hash)
);
CREATE INDEX IF NOT EXISTS exbt_processed_deposits_user_id_idx
  ON exbt_processed_deposits (user_id);

-- Scanner cursor (single row per network, upserted by listener)
CREATE TABLE IF NOT EXISTS exbt_network_sync_state (
  network              varchar(20) PRIMARY KEY,
  last_processed_block bigint      NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
INSERT INTO exbt_network_sync_state (network, last_processed_block)
VALUES ('exbt', 0) ON CONFLICT (network) DO NOTHING;

-- Sweep history — user address → hot wallet transfers
CREATE TABLE IF NOT EXISTS exbt_sweep_transactions (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash          varchar(66),
  funding_tx_hash  varchar(66),
  from_address     varchar(42)    NOT NULL,
  to_address       varchar(42)    NOT NULL,
  amount           numeric(36,18) NOT NULL,
  gas_fee          numeric(36,18),
  derivation_index integer        NOT NULL,
  status           varchar(20)    NOT NULL DEFAULT 'pending',
  error_message    text,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exbt_sweep_transactions_status_idx
  ON exbt_sweep_transactions (status);

-- Withdrawal requests — hot wallet → user-specified address
CREATE TABLE IF NOT EXISTS exbt_withdrawals (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       bigint         NOT NULL,
  to_address    varchar(42)    NOT NULL,
  amount        numeric(36,18) NOT NULL,
  gas_fee       numeric(36,18),
  tx_hash       varchar(66),
  status        varchar(20)    NOT NULL DEFAULT 'pending',
  error_message text,
  created_at    timestamptz    NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS exbt_withdrawals_user_id_idx ON exbt_withdrawals (user_id);
CREATE INDEX IF NOT EXISTS exbt_withdrawals_status_idx  ON exbt_withdrawals (status);
