const { ethers } = require('ethers');
const db            = require('../config/db');
const config        = require('../config');
const walletService = require('./WalletService');
const ledgerService = require('./LedgerService');
const redisPublisher = require('./RedisPublisher');

class WithdrawalService {
  async request({ userId, toAddress, amount }) {
    if (!ethers.isAddress(toAddress)) {
      throw Object.assign(new Error('Invalid to_address'), { code: 'INVALID_ADDRESS' });
    }

    const minWithdrawal = parseFloat(config.withdrawal.minAmount);
    if (parseFloat(amount) < minWithdrawal) {
      throw Object.assign(
        new Error(`Minimum withdrawal is ${minWithdrawal} EXBT`),
        { code: 'BELOW_MIN' }
      );
    }

    const client = await db.connect();
    let withdrawalId;

    try {
      await client.query('BEGIN');

      // Debit balance with SELECT FOR UPDATE inside debit()
      await ledgerService.debit(client, {
        userId,
        amount,
        referenceId:   null, // will backfill after insert
        referenceType: 'withdrawal',
      });

      // Create withdrawal record as pending
      const { rows } = await client.query(
        `INSERT INTO exbt_withdrawals
           (user_id, to_address, amount, status, created_at)
         VALUES ($1, $2, $3, 'pending', now())
         RETURNING id`,
        [userId, toAddress, amount]
      );
      withdrawalId = rows[0].id;

      // Backfill ledger reference_id
      await client.query(
        `UPDATE exbt_ledger
           SET reference_id = $1
         WHERE user_id = $2
           AND reference_type = 'withdrawal'
           AND reference_id IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [withdrawalId, userId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }

    client.release();

    // Broadcast asynchronously — status updates happen in _broadcast
    this._broadcast(withdrawalId, userId, toAddress, amount).catch(err =>
      console.error(`[Withdrawal] broadcast error for ${withdrawalId}:`, err.message)
    );

    return { withdrawalId, status: 'pending' };
  }

  async _broadcast(withdrawalId, userId, toAddress, amountEth) {
    await db.query(
      `UPDATE exbt_withdrawals SET status = 'processing' WHERE id = $1`,
      [withdrawalId]
    );

    let txHash;
    let gasFeeEth;

    try {
      const amountWei = ethers.parseEther(amountEth.toString());

      const gasEstimate = await walletService.estimateGas({
        to:    toAddress,
        value: amountWei,
        from:  walletService.address,
      });

      const gasPrice   = await walletService.getGasPrice();
      const gasCostWei = gasEstimate * gasPrice;
      gasFeeEth        = ethers.formatEther(gasCostWei);

      const sendWei = amountWei - gasCostWei;
      if (sendWei <= 0n) throw new Error('Amount too small to cover gas');

      const tx = await walletService.sendTransaction({
        to:       toAddress,
        value:    sendWei,
        gasLimit: gasEstimate,
        gasPrice,
      });

      txHash = tx.hash;

      await tx.wait(1);

      await db.query(
        `UPDATE exbt_withdrawals
           SET status       = 'completed',
               tx_hash      = $2,
               gas_fee      = $3,
               completed_at = now()
         WHERE id = $1`,
        [withdrawalId, txHash, gasFeeEth]
      );

      await redisPublisher.withdrawalCompleted({ userId, amount: amountEth, txHash });
    } catch (err) {
      console.error(`[Withdrawal] _broadcast failed for ${withdrawalId}:`, err.message);

      // Refund balance
      const client = await db.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `UPDATE exbt_withdrawals
             SET status        = 'failed',
                 error_message = $2
           WHERE id = $1`,
          [withdrawalId, err.message]
        );

        await ledgerService.credit(client, {
          userId,
          amount:        amountEth,
          referenceId:   withdrawalId,
          referenceType: 'withdrawal',
        });

        await client.query('COMMIT');
      } catch (refundErr) {
        await client.query('ROLLBACK');
        console.error(`[Withdrawal] refund failed for ${withdrawalId}:`, refundErr.message);
      } finally {
        client.release();
      }

      await redisPublisher.withdrawalFailed({ userId, amount: amountEth, withdrawalId });
    }
  }

  async getStatus(withdrawalId) {
    const { rows } = await db.query(
      `SELECT id, user_id, to_address, amount, gas_fee, tx_hash,
              status, error_message, created_at, completed_at
       FROM exbt_withdrawals WHERE id = $1`,
      [withdrawalId]
    );
    return rows[0] || null;
  }

  async retry(withdrawalId) {
    const { rows } = await db.query(
      `SELECT * FROM exbt_withdrawals WHERE id = $1`,
      [withdrawalId]
    );
    if (!rows[0]) throw Object.assign(new Error('Withdrawal not found'), { code: 'NOT_FOUND' });

    const w = rows[0];
    if (w.status !== 'failed') {
      throw Object.assign(
        new Error(`Cannot retry a withdrawal in status: ${w.status}`),
        { code: 'INVALID_STATE' }
      );
    }

    // Re-debit (balance was already refunded on failure)
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await ledgerService.debit(client, {
        userId:        w.user_id,
        amount:        w.amount,
        referenceId:   w.id,
        referenceType: 'withdrawal',
      });
      await client.query(
        `UPDATE exbt_withdrawals SET status = 'pending', error_message = NULL WHERE id = $1`,
        [withdrawalId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
    client.release();

    this._broadcast(withdrawalId, w.user_id, w.to_address, w.amount).catch(err =>
      console.error(`[Withdrawal] retry broadcast error for ${withdrawalId}:`, err.message)
    );

    return { withdrawalId, status: 'pending' };
  }
}

module.exports = new WithdrawalService();
