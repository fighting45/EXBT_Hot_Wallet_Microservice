jest.mock('../src/config/db');
jest.mock('../src/services/WalletService');
jest.mock('../src/services/LedgerService');
jest.mock('../src/services/RedisPublisher');

const { ethers }        = require('ethers');
const db                = require('../src/config/db');
const walletService     = require('../src/services/WalletService');
const ledgerService     = require('../src/services/LedgerService');
const redisPublisher    = require('../src/services/RedisPublisher');

// Import the scanner — it's a singleton, so we use its private method directly
const scanner = require('../src/services/DepositScanner');

const HOT_WALLET = '0xaabbccdd00000000000000000000000000000001';

function makeTx(overrides = {}) {
  return {
    hash:   '0x' + 'a'.repeat(64),
    to:     HOT_WALLET,
    from:   '0x' + 'b'.repeat(40),
    value:  ethers.parseEther('100.001234'), // user_id=1234
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  walletService.address = HOT_WALLET;
  walletService.getLatestBlockNumber = jest.fn().mockResolvedValue(100);
  walletService.getBlock = jest.fn().mockResolvedValue({
    number:       100,
    transactions: [],
  });

  db.query   = jest.fn().mockResolvedValue({ rows: [] });
  db.connect = jest.fn().mockResolvedValue({
    query:   jest.fn().mockResolvedValue({ rows: [{ id: 'dep-uuid', balance: '100.0' }] }),
    release: jest.fn(),
  });

  ledgerService.credit             = jest.fn().mockResolvedValue('100.0');
  redisPublisher.depositConfirmed  = jest.fn().mockResolvedValue();
});

describe('DepositScanner._processTx', () => {
  it('skips already-processed tx_hash', async () => {
    // Simulate that tx_hash already exists in exbt_deposits
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // SELECT 1 FROM exbt_deposits

    await scanner._processTx(makeTx(), 100);

    expect(ledgerService.credit).not.toHaveBeenCalled();
  });

  it('stores unidentified deposit when dust is zero', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] }); // not already processed

    const tx = makeTx({ value: ethers.parseEther('100.000000') }); // no dust
    await scanner._processTx(tx, 100);

    const insertCall = db.query.mock.calls.find(
      ([sql]) => sql && sql.includes('INSERT INTO unidentified_deposits')
    );
    expect(insertCall).toBeDefined();
    expect(ledgerService.credit).not.toHaveBeenCalled();
  });

  it('credits correct user and amount for valid dust', async () => {
    // First two db.query calls (duplicate checks) return empty → not seen before
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    const client = {
      query:   jest.fn().mockResolvedValue({ rows: [{ id: 'dep-uuid' }] }),
      release: jest.fn(),
    };
    db.connect = jest.fn().mockResolvedValue(client);

    const tx = makeTx({ value: ethers.parseEther('100.001234') }); // user_id=1234
    await scanner._processTx(tx, 100);

    expect(ledgerService.credit).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ userId: 1234 })
    );
    expect(redisPublisher.depositConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1234, txHash: tx.hash })
    );
  });

  it('does not double-credit the same tx_hash (ON CONFLICT returns no rows)', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    const client = {
      // INSERT ... ON CONFLICT returns empty rows (already exists)
      query:   jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    db.connect = jest.fn().mockResolvedValue(client);

    const tx = makeTx();
    await scanner._processTx(tx, 100);

    expect(ledgerService.credit).not.toHaveBeenCalled();
  });
});
