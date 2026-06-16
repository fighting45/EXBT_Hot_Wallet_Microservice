/**
 * LBank connector smoke test. Run AFTER `npm run build`:
 *
 *   node verify-lbank.js                # market data only (no keys needed)
 *   node verify-lbank.js --private      # also calls signed userInfo (needs LBANK_API_KEY/SECRET)
 *
 * The --private check proves the v2 MD5+HMAC signature is accepted by LBank before any
 * real order is placed. userInfo is read-only and safe to run against the master account.
 */
require('dotenv').config();
const { LbankClient } = require('./dist/modules/trading/lbank/lbank.client');

// Duck-typed ConfigService so we can exercise the real signing code path standalone.
const config = { get: (k, def) => (process.env[k] !== undefined ? process.env[k] : def) };
const client = new LbankClient(config);
const symbol = process.env.LBANK_SYMBOL || 'exbt_usdt';
const wantPrivate = process.argv.includes('--private');

(async () => {
  console.log('=== LBank market data ===');
  const ticker = await client.ticker(symbol);
  console.log('ticker:', JSON.stringify(Array.isArray(ticker) ? ticker[0] : ticker));
  const depth = await client.depth(symbol, 3);
  console.log('depth bids/asks:', depth.bids?.length, '/', depth.asks?.length);

  if (!wantPrivate) {
    console.log('\n(skip private — pass --private with LBANK_API_KEY/SECRET set to test signing)');
    return;
  }

  console.log('\n=== LBank signed userInfo ===');
  if (!client.hasCredentials()) {
    console.error('LBANK_API_KEY / LBANK_API_SECRET are not set in .env');
    process.exit(1);
  }
  const info = await client.userInfo();
  console.log('SIGNATURE ACCEPTED ✓ — master account balances:');
  console.log(JSON.stringify(info));
})().catch(err => {
  console.error('\nFAILED:', err.message);
  console.error('If this is a signature error, the v2 signing in lbank.client.ts needs adjustment.');
  process.exit(1);
});
