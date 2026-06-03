jest.mock('../src/config/db');

const db            = require('../src/config/db');
const ledgerService = require('../src/services/LedgerService');

function makeClient(rows = {}) {
  const client = {
    _queries: [],
    query: jest.fn(async (sql, params) => {
      client._queries.push({ sql, params });
      // Return specific rows keyed by simple SQL fragment match
      for (const [fragment, result] of Object.entries(rows)) {
        if (sql.includes(fragment)) return { rows: result };
      }
      return { rows: [] };
    }),
  };
  return client;
}

describe('LedgerService', () => {
  describe('credit', () => {
    it('upserts balance and inserts ledger entry', async () => {
      const client = makeClient({
        'SELECT balance': [{ balance: '150.0' }],
      });

      const result = await ledgerService.credit(client, {
        userId:        42,
        amount:        '50.0',
        referenceId:   'dep-uuid',
        referenceType: 'deposit',
      });

      expect(result).toBe('150.0');

      const calls = client.query.mock.calls.map(([sql]) => sql.trim().split('\n')[0].trim());
      expect(calls.some(s => s.includes('INSERT INTO exbt_balances'))).toBe(true);
      expect(calls.some(s => s.includes('INSERT INTO exbt_ledger'))).toBe(true);
    });
  });

  describe('debit', () => {
    it('deducts balance and inserts debit ledger entry', async () => {
      const client = makeClient({
        'SELECT balance FROM exbt_balances WHERE user_id = $1 FOR UPDATE': [
          { balance: '200.0' },
        ],
        'SELECT balance FROM exbt_balances WHERE user_id = $1': [
          { balance: '150.0' },
        ],
      });

      const result = await ledgerService.debit(client, {
        userId:        42,
        amount:        '50.0',
        referenceId:   'wd-uuid',
        referenceType: 'withdrawal',
      });

      expect(result).toBe('150.0');
      const sqls = client.query.mock.calls.map(([sql]) => sql);
      expect(sqls.some(s => s.includes('UPDATE exbt_balances'))).toBe(true);
    });

    it('throws INSUFFICIENT_BALANCE when balance too low', async () => {
      const client = makeClient({
        'SELECT balance FROM exbt_balances WHERE user_id = $1 FOR UPDATE': [
          { balance: '10.0' },
        ],
      });

      await expect(
        ledgerService.debit(client, {
          userId: 42, amount: '100.0', referenceId: null, referenceType: 'withdrawal',
        })
      ).rejects.toThrow('INSUFFICIENT_BALANCE');
    });

    it('throws when no balance row exists', async () => {
      const client = makeClient({});

      await expect(
        ledgerService.debit(client, {
          userId: 99, amount: '1.0', referenceId: null, referenceType: 'withdrawal',
        })
      ).rejects.toThrow(/No balance record/);
    });
  });

  describe('getBalance', () => {
    it('returns zero for unknown user', async () => {
      db.query = jest.fn().mockResolvedValue({ rows: [] });
      const bal = await ledgerService.getBalance(9999);
      expect(bal).toEqual({ balance: '0', lockedBalance: '0' });
    });

    it('returns existing balance', async () => {
      db.query = jest.fn().mockResolvedValue({
        rows: [{ balance: '500.0', locked_balance: '0' }],
      });
      const bal = await ledgerService.getBalance(1);
      expect(bal.balance).toBe('500.0');
    });
  });
});
