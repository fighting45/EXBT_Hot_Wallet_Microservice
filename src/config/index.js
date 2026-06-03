require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

module.exports = {
  port: parseInt(process.env.PORT || '3500', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  chain: {
    rpcUrl: required('EXBT_RPC_URL'),
    chainId: parseInt(required('EXBT_CHAIN_ID'), 10),
    // hotWalletKey accessed only in WalletService — never spread into logs
  },

  db: {
    host: required('DB_HOST'),
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    max: parseInt(process.env.DB_MAX_POOL || '10', 10),
  },

  redis: {
    url: required('REDIS_URL'),
  },

  auth: {
    serviceTokenSecret: required('SERVICE_TOKEN_SECRET'),
    adminToken: required('ADMIN_TOKEN'),
  },

  withdrawal: {
    minAmount: process.env.EXBT_MIN_WITHDRAWAL || '1.0',
    rateLimit: parseInt(process.env.EXBT_WITHDRAWAL_RATE_LIMIT || '5', 10),
  },

  scanner: {
    pollIntervalMs: parseInt(process.env.SCANNER_POLL_INTERVAL_MS || '12000', 10),
    startBlock: parseInt(process.env.SCANNER_START_BLOCK || '0', 10),
  },
};
