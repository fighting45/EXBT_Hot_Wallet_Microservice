CREATE TABLE IF NOT EXISTS exbt_deposit_references (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    bigint      NOT NULL,
  memo_dust  varchar(6)  NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exbt_deposit_references_memo_unique UNIQUE (memo_dust)
);

CREATE INDEX IF NOT EXISTS exbt_deposit_references_user_id_idx ON exbt_deposit_references (user_id);
