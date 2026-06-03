const db = require('../config/db');

class LedgerService {
  /**
   * Credit a user's balance.
   * Must be called inside an existing transaction (client param).
   * Returns the new balance as a string.
   */
  async credit(client, { userId, amount, referenceId, referenceType }) {
    // Upsert balance row
    await client.query(
      `INSERT INTO exbt_balances (user_id, balance, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE
         SET balance    = exbt_balances.balance + $2,
             updated_at = now()`,
      [userId, amount]
    );

    const { rows } = await client.query(
      'SELECT balance FROM exbt_balances WHERE user_id = $1',
      [userId]
    );
    const balanceAfter = rows[0].balance;

    await client.query(
      `INSERT INTO exbt_ledger
         (user_id, type, amount, balance_after, reference_id, reference_type)
       VALUES ($1, 'credit', $2, $3, $4, $5)`,
      [userId, amount, balanceAfter, referenceId, referenceType]
    );

    return balanceAfter;
  }

  /**
   * Debit a user's balance.
   * Uses SELECT FOR UPDATE — must be called with its own client from the pool
   * (the caller must BEGIN/COMMIT/ROLLBACK around this).
   * Throws if balance is insufficient.
   */
  async debit(client, { userId, amount, referenceId, referenceType }) {
    const { rows } = await client.query(
      'SELECT balance FROM exbt_balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (rows.length === 0) {
      throw new Error(`No balance record for user_id ${userId}`);
    }

    const current = BigInt(Math.round(parseFloat(rows[0].balance) * 1e18));
    const deductWei = BigInt(Math.round(parseFloat(amount) * 1e18));

    if (current < deductWei) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    await client.query(
      `UPDATE exbt_balances
         SET balance    = balance - $2,
             updated_at = now()
       WHERE user_id = $1`,
      [userId, amount]
    );

    const { rows: after } = await client.query(
      'SELECT balance FROM exbt_balances WHERE user_id = $1',
      [userId]
    );
    const balanceAfter = after[0].balance;

    await client.query(
      `INSERT INTO exbt_ledger
         (user_id, type, amount, balance_after, reference_id, reference_type)
       VALUES ($1, 'debit', $2, $3, $4, $5)`,
      [userId, amount, balanceAfter, referenceId, referenceType]
    );

    return balanceAfter;
  }

  async getBalance(userId) {
    const { rows } = await db.query(
      'SELECT balance, locked_balance FROM exbt_balances WHERE user_id = $1',
      [userId]
    );
    if (rows.length === 0) return { balance: '0', lockedBalance: '0' };
    return { balance: rows[0].balance, lockedBalance: rows[0].locked_balance };
  }

  async getLedger(userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const { rows } = await db.query(
      `SELECT id, type, amount, balance_after, reference_id, reference_type, created_at
       FROM exbt_ledger
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    const { rows: count } = await db.query(
      'SELECT COUNT(*) AS total FROM exbt_ledger WHERE user_id = $1',
      [userId]
    );
    return { entries: rows, total: parseInt(count[0].total, 10) };
  }
}

module.exports = new LedgerService();
