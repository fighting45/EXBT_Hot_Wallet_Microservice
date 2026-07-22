-- ─────────────────────────────────────────────────────────────────────────────
-- 005_trading_signals.sql — Signal scanner history + webhook delivery tracking
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trading_signals (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which pair and timeframe fired
  symbol           varchar(20)    NOT NULL,
  timeframe        varchar(10)    NOT NULL,

  -- Direction
  signal           varchar(10)    NOT NULL,  -- LONG | SHORT

  -- The closed bar this signal fired on
  bar_timestamp    bigint         NOT NULL,  -- ms unix timestamp
  bar_datetime     timestamptz    NOT NULL,

  -- Price levels (all pre-calculated, ready to show users)
  entry            numeric(30,8)  NOT NULL,
  stop_loss        numeric(30,8)  NOT NULL,
  take_profit_1    numeric(30,8)  NOT NULL,
  take_profit_2    numeric(30,8)  NOT NULL,
  take_profit_3    numeric(30,8)  NOT NULL,
  take_profit_4    numeric(30,8)  NOT NULL,
  take_profit_5    numeric(30,8)  NOT NULL,

  -- Confluence
  confluence_score smallint       NOT NULL,  -- 0-7
  confluence_pct   numeric(5,2)   NOT NULL,  -- percentage e.g. 85.71

  -- Market bias
  bias_label       varchar(20)    NOT NULL,  -- STRONG BULL | MILD BULL | NEUTRAL | MILD BEAR | STRONG BEAR
  bias_bull        numeric(5,2)   NOT NULL,
  bias_bear        numeric(5,2)   NOT NULL,

  -- Webhook delivery tracking
  webhook_status   varchar(20)    NOT NULL DEFAULT 'pending',  -- pending | delivered
  webhook_error    text,

  created_at       timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trading_signals_symbol_idx        ON trading_signals (symbol);
CREATE INDEX IF NOT EXISTS trading_signals_webhook_status_idx ON trading_signals (webhook_status);
CREATE INDEX IF NOT EXISTS trading_signals_created_at_idx    ON trading_signals (created_at DESC);
