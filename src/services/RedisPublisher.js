const Redis = require('ioredis');
const config = require('../config');

class RedisPublisher {
  constructor() {
    this._client = null;
  }

  _getClient() {
    if (!this._client) {
      this._client = new Redis(config.redis.url, {
        lazyConnect: true,
        enableReadyCheck: false,
        maxRetriesPerRequest: 3,
      });
      this._client.on('error', err =>
        console.error('[Redis] pub/sub error:', err.message)
      );
    }
    return this._client;
  }

  async publish(channel, payload) {
    try {
      await this._getClient().publish(channel, JSON.stringify(payload));
    } catch (err) {
      // Non-fatal — log and continue; Laravel will reconcile via DB polling
      console.error(`[Redis] failed to publish ${channel}:`, err.message);
    }
  }

  async depositConfirmed({ userId, amount, txHash, balanceAfter }) {
    await this.publish('exbt.deposit.confirmed', {
      user_id:       userId,
      amount,
      tx_hash:       txHash,
      balance_after: balanceAfter,
    });
  }

  async withdrawalCompleted({ userId, amount, txHash }) {
    await this.publish('exbt.withdrawal.completed', {
      user_id: userId,
      amount,
      tx_hash: txHash,
    });
  }

  async withdrawalFailed({ userId, amount, withdrawalId }) {
    await this.publish('exbt.withdrawal.failed', {
      user_id:       userId,
      amount,
      withdrawal_id: withdrawalId,
    });
  }

  async disconnect() {
    if (this._client) {
      await this._client.quit();
      this._client = null;
    }
  }
}

module.exports = new RedisPublisher();
