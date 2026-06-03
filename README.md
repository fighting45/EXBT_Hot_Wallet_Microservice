# EXBT Wallet Service

Node.js microservice for EXBT hot wallet management — deposit scanning, internal DB ledger, and withdrawals.

## Architecture overview

```
Laravel ──(HTTP + HMAC)──▶ exbt-wallet-service ──▶ PostgreSQL (shared)
                                    │
                                    ├──▶ Redis pub/sub (events to Laravel)
                                    └──▶ EXBT testnet RPC
```

Single hot wallet address. Users are identified by **unique amount fingerprinting**: each user appends their zero-padded 6-digit `user_id` as decimal dust to any round amount they send.

```
user_id=1234, send 100 EXBT → send exactly 100.001234 EXBT
dust = 0.001234 EXBT → extracted by scanner → maps to user 1234
credited = 100.001234 − 0.001234 = 100.000000 EXBT
```

## Quick start

```bash
cp .env.example .env          # fill in DB creds + EXBT_HOT_WALLET_KEY
docker-compose up -d postgres redis
npm install
npm run migrate
npm start
```

Or run everything in Docker:

```bash
docker-compose up --build
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `EXBT_RPC_URL` | ✓ | Chain RPC (http://testnet_rpc.exbotix.net) |
| `EXBT_CHAIN_ID` | ✓ | 11211 |
| `EXBT_HOT_WALLET_KEY` | ✓ | Private key — **never log or commit** |
| `DB_HOST/PORT/NAME/USER/PASSWORD` | ✓ | Shared PostgreSQL |
| `REDIS_URL` | ✓ | Redis connection |
| `SERVICE_TOKEN_SECRET` | ✓ | Shared HMAC secret with Laravel |
| `ADMIN_TOKEN` | ✓ | Static token for admin endpoints |
| `EXBT_MIN_WITHDRAWAL` | | Minimum withdrawal amount (default: 1.0) |
| `EXBT_WITHDRAWAL_RATE_LIMIT` | | Max withdrawals per user per hour (default: 5) |
| `SCANNER_POLL_INTERVAL_MS` | | Block poll interval (default: 12000) |
| `SCANNER_START_BLOCK` | | Override scanner start block (0 = resume from DB) |

## API

All endpoints (except `/health`) require HMAC authentication:

```
X-Service-Token: <HMAC-SHA256 of "<timestamp>:<raw-body>" keyed on SERVICE_TOKEN_SECRET>
X-Timestamp: <unix-seconds>
```

Admin endpoints also require `X-Admin-Token`.

### Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/hot-wallet/address` | Hot wallet address |
| GET | `/balance/:user_id` | User balance |
| GET | `/deposit/address/:user_id` | Deposit address + memo instructions |
| POST | `/deposit/verify` | Manual tx re-process `{ tx_hash }` |
| POST | `/withdrawal/request` | Request withdrawal `{ user_id, to_address, amount }` |
| GET | `/withdrawal/:id/status` | Withdrawal status |
| POST | `/withdrawal/:id/retry` | Retry failed withdrawal (admin) |
| GET | `/ledger/:user_id` | Ledger entries `?page=1&limit=20` |
| GET | `/admin/unidentified` | Unmatched deposits (admin) |

### Deposit flow

```
GET /deposit/address/1234
→ {
    address: "0x...",
    memo: "001234",
    instructions: "...",
    example: { deposit_100_exbt: "100.001234" }
  }
```

### Withdrawal flow

```
POST /withdrawal/request
{ "user_id": 1234, "to_address": "0x...", "amount": "50" }
→ 202 { "withdrawalId": "uuid", "status": "pending" }
```

Balance is debited immediately. Broadcast happens asynchronously.
If broadcast fails, balance is refunded and `exbt.withdrawal.failed` is emitted.

## Redis events (for Laravel consumers)

| Channel | Payload |
|---|---|
| `exbt.deposit.confirmed` | `{ user_id, amount, tx_hash, balance_after }` |
| `exbt.withdrawal.completed` | `{ user_id, amount, tx_hash }` |
| `exbt.withdrawal.failed` | `{ user_id, amount, withdrawal_id }` |

## Database tables

All tables are prefixed `exbt_` (except `unidentified_deposits` and `scan_cursor`).
Run migrations before first start — they are idempotent and skipped if already applied.

```
exbt_balances       — user balances with optimistic locking
exbt_deposits       — confirmed deposits (UNIQUE tx_hash)
exbt_withdrawals    — withdrawal requests and status
exbt_ledger         — double-entry ledger
unidentified_deposits — txs that could not be matched to a user
scan_cursor         — single-row resume cursor for block scanner
```

## Tests

```bash
npm test
```

23 tests covering:
- `DepositIdentifier`: dust extraction, user mapping, unknown dust
- `LedgerService`: credit, debit, insufficient balance, unknown user
- `WithdrawalService`: double-spend prevention, broadcast failure + refund
- `DepositScanner`: duplicate tx rejection, unidentified deposit handling, credit path

## Security notes

- `EXBT_HOT_WALLET_KEY` is never passed to `config/index.js` — only read directly in `WalletService` via `process.env`.
- HMAC replay window: 60 seconds.
- All balance debits use `SELECT FOR UPDATE` — no double-spend possible.
- Withdrawal gas is auto-estimated with a 20% buffer; gas cost is deducted from the send amount and recorded.
