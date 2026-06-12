CREATE TABLE IF NOT EXISTS exbt_scanned_blocks (
  block_number  bigint      PRIMARY KEY,
  tx_count      integer     NOT NULL DEFAULT 0,
  deposit_count integer     NOT NULL DEFAULT 0,
  scanned_at    timestamptz NOT NULL DEFAULT now()
);
