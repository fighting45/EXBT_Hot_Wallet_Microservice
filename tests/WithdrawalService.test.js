jest.mock('../src/config/db');
jest.mock('../src/services/WalletService');
jest.mock('../src/services/LedgerService');
jest.mock('../src/services/RedisPublisher');

const { ethers }        = require('ethers');
const db                = require('../src/config/db');
const walletService     = require('../src/services/WalletService');
const ledgerService     = require('../src/services/LedgerService');
const redisPublisher    = require('../src/services/RedisPublisher');
const withdrawalService = require('../src/services/WithdrawalService');

// Shared mock client used across tests
let mockClient;

beforeEach(() => {
  jest.clearAllMocks();

  mockClient = {
    query:   jest.fn().mockResolvedValue({ rows: [{ id: 'wd-uuid-1' }] }),
    release: jest.fn(),
  };
  db.connect = jest.fn().mockResolvedValue(mockClient);
  db.query   = jest.fn().mockResolvedValue({ rows: [] });

  ledgerService.debit  = jest.fn().mockResolvedValue('900.0');
  ledgerService.credit = jest.fn().mockResolvedValue('1000.0');

  redisPublisher.withdrawalCompleted = jest.fn().mockResolvedValue();
  redisPublisher.withdrawalFailed    = jest.fn().mockResolvedValue();
});

describe('WithdrawalService', () => {
  describe('request — double-spend prevention', () => {
    it('rejects invalid to_address', async () => {
      await expect(
        withdrawalService.request({
          userId:    1,
          toAddress: 'not-an-address',
          amount:    '10',
        })
      ).rejects.toMatchObject({ code: 'INVALID_ADDRESS' });
    });

    it('rejects amount below minimum', async () => {
      // All-lowercase address is always valid in ethers v6
      await expect(
        withdrawalService.request({
          userId:    1,
          toAddress: '0x742d35cc6634c0532925a3b8d4c9a5da0e0b8b9f',
          amount:    '0.001',
        })
      ).rejects.toMatchObject({ code: 'BELOW_MIN' });
    });

    it('rolls back and throws when debit throws INSUFFICIENT_BALANCE', async () => {
      ledgerService.debit = jest.fn().mockRejectedValue(
        Object.assign(new Error('INSUFFICIENT_BALANCE'), { code: 'INSUFFICIENT_BALANCE' })
      );

      await expect(
        withdrawalService.request({
          userId:    1,
          toAddress: '0x742d35cc6634c0532925a3b8d4c9a5da0e0b8b9f',
          amount:    '50',
        })
      ).rejects.toThrow('INSUFFICIENT_BALANCE');

      // ROLLBACK must have been called
      const rollbackCall = mockClient.query.mock.calls.find(
        ([sql]) => sql === 'ROLLBACK'
      );
      expect(rollbackCall).toBeDefined();
    });
  });

  describe('_broadcast — refund on failed broadcast', () => {
    it('refunds balance and emits withdrawalFailed when broadcast throws', async () => {
      walletService.estimateGas  = jest.fn().mockResolvedValue(21000n);
      walletService.getGasPrice  = jest.fn().mockResolvedValue(1_000_000_000n);
      walletService.address      = '0xHotWallet';
      walletService.provider     = { getBalance: jest.fn().mockResolvedValue(ethers.parseEther('100')) };
      walletService.sendTransaction = jest.fn().mockRejectedValue(new Error('nonce too low'));

      // Connect for refund path
      db.connect = jest.fn().mockResolvedValue({
        query:   jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      });

      await withdrawalService._broadcast(
        'wd-uuid-refund',
        42,
        '0x742d35cc6634c0532925a3b8d4c9a5da0e0b8b9f',
        '10'
      );

      expect(ledgerService.credit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: 42, amount: '10' })
      );
      expect(redisPublisher.withdrawalFailed).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 42, withdrawalId: 'wd-uuid-refund' })
      );
    });
  });
});
