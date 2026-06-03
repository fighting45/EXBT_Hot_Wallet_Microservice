-- ─────────────────────────────────────────────────────────────────────────────
-- 001_initial_schema.sql
-- EXBT wallet service tables.  Shared Postgres instance with Laravel — we only
-- touch the exbt_* and unidentified_deposits namespaces.
-- ─────────────────────────────────────────────────────────────────────────────

-- Track migration state
CREATE TABLE IF NOT EXISTS exbt_migrations (
  id          serial PRIMARY KEY,
  filename    varchar(255) UNIQUE NOT NULL,
  applied_at  timestamptz  NOT NULL DEFAULT now()
);

-- User balances
CREATE TABLE IF NOT EXISTS exbt_balances (
  user_id        bigint          PRIMARY KEY,
  balance        numeric(36,18)  NOT NULL DEFAULT 0,
  locked_balance numeric(36,18)  NOT NULL DEFAULT 0,
  updated_at     timestamptz     NOT NULL DEFAULT now()
);

-- Confirmed deposits
CREATE TABLE IF NOT EXISTS exbt_deposits (
  id            uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       bigint          NOT NULL,
  tx_hash       varchar(66)     NOT NULL,
  gross_amount  numeric(36,18)  NOT NULL,
  dust_amount   numeric(36,18)  NOT NULL,
  net_credited  numeric(36,18)  NOT NULL,
  block_number  bigint          NOT NULL,
  status        varchar(20)     NOT NULL DEFAULT 'confirmed',
  created_at    timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT exbt_deposits_tx_hash_unique UNIQUE (tx_hash)
);
CREATE INDEX IF NOT EXISTS exbt_deposits_user_id_idx ON exbt_deposits (user_id);
CREATE INDEX IF NOT EXISTS exbt_deposits_block_number_idx ON exbt_deposits (block_number);

-- Withdrawals
CREATE TABLE IF NOT EXISTS exbt_withdrawals (
  id            uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       bigint          NOT NULL,
  to_address    varchar(42)     NOT NULL,
  amount        numeric(36,18)  NOT NULL,
  gas_fee       numeric(36,18),
  tx_hash       varchar(66),
  status        varchar(20)     NOT NULL DEFAULT 'pending',
  error_message text,
  created_at    timestamptz     NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS exbt_withdrawals_user_id_idx   ON exbt_withdrawals (user_id);
CREATE INDEX IF NOT EXISTS exbt_withdrawals_status_idx    ON exbt_withdrawals (status);

-- Double-entry ledger
CREATE TABLE IF NOT EXISTS exbt_ledger (
  id             uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        bigint          NOT NULL,
  type           varchar(10)     NOT NULL CHECK (type IN ('credit','debit')),
  amount         numeric(36,18)  NOT NULL,
  balance_after  numeric(36,18)  NOT NULL,
  reference_id   uuid,
  reference_type varchar(20)     CHECK (reference_type IN ('deposit','withdrawal','trade')),
  created_at     timestamptz     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exbt_ledger_user_id_idx ON exbt_ledger (user_id);
CREATE INDEX IF NOT EXISTS exbt_ledger_ref_idx     ON exbt_ledger (reference_id);

-- Txs that could not be matched to any user
CREATE TABLE IF NOT EXISTS unidentified_deposits (
  id           uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash      varchar(66)     NOT NULL,
  amount       numeric(36,18)  NOT NULL,
  dust         numeric(36,18)  NOT NULL,
  from_address varchar(42),
  block_number bigint          NOT NULL,
  created_at   timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT unidentified_deposits_tx_hash_unique UNIQUE (tx_hash)
);

-- Scanner resume cursor (single row, id always = 1)
CREATE TABLE IF NOT EXISTS scan_cursor (
  id                  int         PRIMARY KEY DEFAULT 1,
  last_scanned_block  bigint      NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scan_cursor_single_row CHECK (id = 1)
);

INSERT INTO scan_cursor (id, last_scanned_block)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;
