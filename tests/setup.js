// Stub required env vars so config/index.js doesn't throw during tests.
// Services that touch real infra (DB, Redis, chain) are mocked per-test-file.
process.env.EXBT_RPC_URL          = 'http://localhost:8545';
process.env.EXBT_CHAIN_ID         = '11211';
process.env.EXBT_HOT_WALLET_KEY   = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
process.env.DB_HOST               = 'localhost';
process.env.DB_NAME               = 'exbotix_test';
process.env.DB_USER               = 'exbotix';
process.env.DB_PASSWORD           = 'secret';
process.env.REDIS_URL             = 'redis://localhost:6379';
process.env.SERVICE_TOKEN_SECRET  = 'test-secret';
process.env.ADMIN_TOKEN           = 'test-admin-token';
process.env.EXBT_MIN_WITHDRAWAL   = '1.0';
