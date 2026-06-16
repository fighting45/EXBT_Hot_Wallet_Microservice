-- ─────────────────────────────────────────────────────────────────────────────
-- 005_trading.sql  —  EXBT/USDT trading pair (LBank brokerage connector)
-- Additive only. Does not touch any existing table.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tradable pair config. `symbol` is the external KuCoin-style symbol shown to
-- Laravel; `lbank_symbol` is what the LBank API expects.
CREATE TABLE IF NOT EXISTS exbt_trading_pairs (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol           varchar(20)  NOT NULL,
  lbank_symbol     varchar(20)  NOT NULL,
  base_asset       varchar(12)  NOT NULL,
  quote_asset      varchar(12)  NOT NULL,
  price_precision  integer      NOT NULL DEFAULT 8,
  amount_precision integer      NOT NULL DEFAULT 8,
  min_amount       numeric(36,18) NOT NULL DEFAULT 0,
  min_funds        numeric(36,18) NOT NULL DEFAULT 0,
  enabled          boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT exbt_trading_pairs_symbol_unique UNIQUE (symbol)
);

-- Seed the EXBT/USDT pair (idempotent).
INSERT INTO exbt_trading_pairs (symbol, lbank_symbol, base_asset, quote_asset, price_precision, amount_precision, min_amount, min_funds)
VALUES ('EXBT-USDT', 'exbt_usdt', 'EXBT', 'USDT', 8, 2, 1, 1)
ON CONFLICT (symbol) DO NOTHING;

-- User orders, mirrored to the LBank master account.
CREATE TABLE IF NOT EXISTS exbt_orders (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       bigint         NOT NULL,
  symbol        varchar(20)    NOT NULL,
  side          varchar(4)     NOT NULL,
  type          varchar(8)     NOT NULL,
  price         numeric(36,18),
  amount        numeric(36,18) NOT NULL,
  filled_amount numeric(36,18) NOT NULL DEFAULT 0,
  avg_price     numeric(36,18),
  locked_amount numeric(36,18) NOT NULL DEFAULT 0,
  fee           numeric(36,18) NOT NULL DEFAULT 0,
  fee_asset     varchar(12),
  status        varchar(20)    NOT NULL DEFAULT 'pending',
  lbank_order_id varchar(80),
  error_message text,
  webhook_status varchar(20)   NOT NULL DEFAULT 'pending',
  webhook_error  text,
  created_at    timestamptz    NOT NULL DEFAULT now(),
  updated_at    timestamptz    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exbt_orders_user_id_idx ON exbt_orders (user_id);
CREATE INDEX IF NOT EXISTS exbt_orders_status_idx  ON exbt_orders (status);
CREATE INDEX IF NOT EXISTS exbt_orders_lbank_order_id_idx ON exbt_orders (lbank_order_id);

-- Individual fills attributed to a user. `lbank_trade_id` unique → no double-settle.
CREATE TABLE IF NOT EXISTS exbt_fills (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid           NOT NULL,
  user_id       bigint         NOT NULL,
  lbank_trade_id varchar(80)   NOT NULL,
  price         numeric(36,18) NOT NULL,
  amount        numeric(36,18) NOT NULL,
  fee           numeric(36,18) NOT NULL DEFAULT 0,
  fee_asset     varchar(12),
  traded_at     timestamptz,
  created_at    timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT exbt_fills_lbank_trade_id_unique UNIQUE (lbank_trade_id)
);
CREATE INDEX IF NOT EXISTS exbt_fills_order_id_idx ON exbt_fills (order_id);

-- Per-user tradable sub-balance per asset, on top of the pooled master account.
CREATE TABLE IF NOT EXISTS exbt_trade_balances (
  id         uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    bigint         NOT NULL,
  asset      varchar(12)    NOT NULL,
  available  numeric(36,18) NOT NULL DEFAULT 0,
  locked     numeric(36,18) NOT NULL DEFAULT 0,
  version    integer        NOT NULL DEFAULT 1,
  updated_at timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT exbt_trade_balances_user_asset_unique UNIQUE (user_id, asset)
);
CREATE INDEX IF NOT EXISTS exbt_trade_balances_user_id_idx ON exbt_trade_balances (user_id);
