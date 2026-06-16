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

## EXBT/USDT Trading (LBank brokerage connector)

EXBT is listed on **LBank** (`EXBT/USDT`) but not on KuCoin. This module lets the Exbotix
Laravel backend offer the `EXBT-USDT` spot pair, sourced from LBank and exposed in
**KuCoin-compatible JSON** so the frontend treats it like any other pair.

**Model:** pass-through brokerage. Exbotix holds ONE master LBank account; each user order is
mirrored 1:1 to LBank. Funds live on the master account; this service keeps a per-user
sub-ledger (`exbt_trade_balances`) and reconciles fills back to each user.

```
Laravel ──HTTP(HMAC)──▶ /api/trading ──▶ LBank master account (REST + WS)
                            │                    │
                            ▼                    ▼ fills
                     exbt_orders / fills / balances ──▶ webhook /api/v1/trading/webhook
```

### Endpoints

Market data is public; trading/account routes require the `X-Service-Token` HMAC
(`hex(HMAC-SHA256("<timestamp>:<raw-body>", SERVICE_TOKEN_SECRET))` + `X-Timestamp`, 60s window).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/trading/symbols` | — | Tradable pairs (KuCoin symbol shape) |
| GET | `/api/trading/ticker?symbol=EXBT-USDT` | — | 24h stats + best bid/ask |
| GET | `/api/trading/orderbook?symbol=&depth=` | — | Level2 book (live via WS when available) |
| GET | `/api/trading/klines?symbol=&type=1min&size=&startAt=` | — | Candles, newest-first |
| GET | `/api/trading/trades?symbol=&size=` | — | Recent trades |
| POST | `/api/trading/orders` | ✓ | `{user_id, symbol, side, type, price?, size}` |
| POST | `/api/trading/orders/:id/cancel` | ✓ | `{user_id}` |
| GET | `/api/trading/orders/:id` | ✓ | Order detail |
| GET | `/api/trading/orders?user_id=&status=open\|done` | ✓ | List user orders |
| GET | `/api/trading/accounts/:user_id` | ✓ | EXBT + USDT available/locked |
| POST | `/api/trading/accounts/credit` | ✓ | Fund a user's tradable balance |
| POST | `/api/trading/accounts/debit` | ✓ | Defund a user's tradable balance |

### Order flow

```
POST /api/trading/orders { user_id, symbol:"EXBT-USDT", side:"buy", type:"limit", price:"0.58", size:"100" }
→ lock 100*0.58*(1+fee buffer) USDT → mirror to LBank → 200 { orderId, status:"open" }
```

Reconciliation (`TRADE_RECONCILE_INTERVAL_MS`, plus WS trade nudges) settles fills into the
user ledger and POSTs `order.filled` / `order.partially_filled` / `order.canceled` /
`order.failed` to Laravel, retrying failed webhooks just like deposits/withdrawals.

### Config

See `.env.example` — `LBANK_API_KEY/SECRET`, `LBANK_SIGN_METHOD`, `LBANK_SYMBOL`,
`TRADING_ENABLED`, `TRADE_RECONCILE_INTERVAL_MS`, `TRADE_FEE_BUFFER`, `SERVICE_TOKEN_SECRET`.

### Verify

```bash
npm run build
npm run migrate                 # creates 4 exbt_trading_* tables, seeds EXBT-USDT
node verify-lbank.js            # market data (public, no keys)
node verify-lbank.js --private  # signed userInfo — proves signing before real orders
```

> Trading is fully isolated in `src/modules/trading/`. With `TRADING_ENABLED=false` (or no
> LBank keys) the deposit/withdrawal service runs exactly as before; market data still serves.

## Security notes

- `EXBT_HOT_WALLET_KEY` is never passed to `config/index.js` — only read directly in `WalletService` via `process.env`.
- HMAC replay window: 60 seconds.
- All balance debits use `SELECT FOR UPDATE` — no double-spend possible.
- Withdrawal gas is auto-estimated with a 20% buffer; gas cost is deducted from the send amount and recorded.
