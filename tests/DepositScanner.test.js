jest.mock('../src/config/db');
jest.mock('../src/services/WalletService');
jest.mock('../src/services/LedgerService');
jest.mock('../src/services/RedisPublisher');

const { ethers }        = require('ethers');
const db                = require('../src/config/db');
const walletService     = require('../src/services/WalletService');
const ledgerService     = require('../src/services/LedgerService');
const redisPublisher    = require('../src/services/RedisPublisher');
const scanner           = require('../src/services/DepositScanner');

const HOT_WALLET = '0xaabbccdd00000000000000000000000000000001';

// memo "034" → dust = 34 * 10^15 = 0.034 EXBT
const VALID_AMOUNT = ethers.parseEther('100.034');
const VALID_MEMO   = '034';

function makeTx(overrides = {}) {
  return {
    hash:  '0x' + 'a'.repeat(64),
    to:    HOT_WALLET,
    from:  '0x' + 'b'.repeat(40),
    value: VALID_AMOUNT,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  walletService.address                 = HOT_WALLET;
  walletService.getLatestBlockNumber    = jest.fn().mockResolvedValue(100);
  walletService.getBlock                = jest.fn().mockResolvedValue({ number: 100, transactions: [] });
  walletService.getTransaction          = jest.fn().mockResolvedValue(makeTx());

  // Default: tx not seen before, memo found in deposit_references
  db.query = jest.fn()
    .mockResolvedValueOnce({ rows: [] })                        // exbt_deposits duplicate check
    .mockResolvedValueOnce({ rows: [] })                        // unidentified_deposits duplicate check
    .mockResolvedValueOnce({ rows: [{ user_id: 42 }] });        // deposit_references lookup

  db.connect = jest.fn().mockResolvedValue({
    query:   jest.fn().mockResolvedValue({ rows: [{ id: 'dep-uuid' }] }),
    release: jest.fn(),
  });

  ledgerService.credit            = jest.fn().mockResolvedValue('100.0');
  redisPublisher.depositConfirmed = jest.fn().mockResolvedValue();
});

describe('DepositScanner._processTx', () => {
  it('skips already-processed tx_hash', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // tx found in exbt_deposits

    await scanner._processTx(makeTx(), 100);

    expect(ledgerService.credit).not.toHaveBeenCalled();
  });

  it('stores unidentified when dust is zero (round amount)', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    const tx = makeTx({ value: ethers.parseEther('100.000') });
    await scanner._processTx(tx, 100);

    const insertCall = db.query.mock.calls.find(
      ([sql]) => sql && sql.includes('INSERT INTO unidentified_deposits')
    );
    expect(insertCall).toBeDefined();
    expect(ledgerService.credit).not.toHaveBeenCalled();
  });

  it('stores unidentified when memo not found in deposit_references', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })   // exbt_deposits check
      .mockResolvedValueOnce({ rows: [] })   // unidentified check
      .mockResolvedValueOnce({ rows: [] });  // deposit_references → no match

    await scanner._processTx(makeTx(), 100);

    const insertCall = db.query.mock.calls.find(
      ([sql]) => sql && sql.includes('INSERT INTO unidentified_deposits')
    );
    expect(insertCall).toBeDefined();
    expect(ledgerService.credit).not.toHaveBeenCalled();
  });

  it('credits correct user when memo matches deposit_references', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })                    // exbt_deposits check
      .mockResolvedValueOnce({ rows: [] })                    // unidentified check
      .mockResolvedValueOnce({ rows: [{ user_id: 42 }] });   // deposit_references match

    const client = {
      query:   jest.fn().mockResolvedValue({ rows: [{ id: 'dep-uuid' }] }),
      release: jest.fn(),
    };
    db.connect = jest.fn().mockResolvedValue(client);

    await scanner._processTx(makeTx(), 100);

    expect(ledgerService.credit).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ userId: 42 })
    );
    expect(redisPublisher.depositConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, txHash: makeTx().hash })
    );
  });

  it('does not double-credit when ON CONFLICT returns no rows', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })                    // exbt_deposits check
      .mockResolvedValueOnce({ rows: [] })                    // unidentified check
      .mockResolvedValueOnce({ rows: [{ user_id: 42 }] });   // deposit_references match

    const client = {
      query:   jest.fn().mockResolvedValue({ rows: [] }), // INSERT ON CONFLICT → no rows
      release: jest.fn(),
    };
    db.connect = jest.fn().mockResolvedValue(client);

    await scanner._processTx(makeTx(), 100);

    expect(ledgerService.credit).not.toHaveBeenCalled();
  });

  it('deletes memo from deposit_references after successful credit', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: 42 }] });

    const clientQuery = jest.fn().mockResolvedValue({ rows: [{ id: 'dep-uuid' }] });
    db.connect = jest.fn().mockResolvedValue({ query: clientQuery, release: jest.fn() });

    await scanner._processTx(makeTx(), 100);

    const deleteCall = clientQuery.mock.calls.find(
      ([sql]) => sql && sql.includes('DELETE FROM exbt_deposit_references')
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall[1]).toContain(VALID_MEMO);
  });
});
