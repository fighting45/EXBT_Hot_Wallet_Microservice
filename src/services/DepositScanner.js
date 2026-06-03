const { ethers }        = require('ethers');
const db                = require('../config/db');
const config            = require('../config');
const walletService     = require('./WalletService');
const depositIdentifier = require('./DepositIdentifier');
const ledgerService     = require('./LedgerService');
const redisPublisher    = require('./RedisPublisher');

const HOT_WALLET = () => walletService.address.toLowerCase();

async function withRetry(fn, label, retries = 3) {
  let delay = 1000;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`[Scanner] ${label} attempt ${attempt} failed: ${err.message} — retry in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

class DepositScanner {
  constructor() {
    this._running = false;
    this._timer   = null;
  }

  async start() {
    if (this._running) return;
    this._running = true;
    console.log('[Scanner] starting deposit scanner');
    await this._tick();
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    console.log('[Scanner] stopped');
  }

  async _tick() {
    try {
      await this._scanNext();
    } catch (err) {
      console.error('[Scanner] tick error:', err.message);
    } finally {
      if (this._running) {
        this._timer = setTimeout(
          () => this._tick(),
          config.scanner.pollIntervalMs
        );
      }
    }
  }

  async _scanNext() {
    const cursor = await this._getCursor();
    const latest = await withRetry(
      () => walletService.getLatestBlockNumber(),
      'getLatestBlockNumber'
    );

    if (cursor >= latest) return; // nothing new

    const from = cursor + 1;
    const to   = latest;

    for (let blockNum = from; blockNum <= to; blockNum++) {
      let block;
      try {
        block = await withRetry(
          () => walletService.getBlock(blockNum),
          `getBlock(${blockNum})`
        );
      } catch (err) {
        console.error(`[Scanner] skipping block ${blockNum} after retries: ${err.message}`);
        await this._updateCursor(blockNum);
        continue;
      }

      if (!block || !block.transactions || block.transactions.length === 0) {
        await this._updateCursor(blockNum);
        continue;
      }

      await this._processBlock(block);
      await this._updateCursor(blockNum);
    }
  }

  async _processBlock(block) {
    const hot = HOT_WALLET();

    for (const tx of block.transactions) {
      if (!tx.to || tx.to.toLowerCase() !== hot) continue;
      if (!tx.value || tx.value === 0n) continue;

      await this._processTx(tx, block.number).catch(err =>
        console.error(`[Scanner] error processing tx ${tx.hash}:`, err.message)
      );
    }
  }

  async _processTx(tx, blockNumber) {
    // Idempotency: skip already-processed tx_hashes
    const { rows: existing } = await db.query(
      'SELECT 1 FROM exbt_deposits WHERE tx_hash = $1',
      [tx.hash]
    );
    if (existing.length > 0) return;

    // Also check unidentified table
    const { rows: existingUnid } = await db.query(
      'SELECT 1 FROM unidentified_deposits WHERE tx_hash = $1',
      [tx.hash]
    );
    if (existingUnid.length > 0) return;

    const weiAmount  = BigInt(tx.value.toString());
    const identified = depositIdentifier.identify(weiAmount);

    if (!identified) {
      await this._storeUnidentified(tx, blockNumber, weiAmount);
      return;
    }

    const { userId, dustAmountEth, netCreditedEth, grossAmountEth } = identified;

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `INSERT INTO exbt_deposits
           (user_id, tx_hash, gross_amount, dust_amount, net_credited, block_number, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')
         ON CONFLICT (tx_hash) DO NOTHING
         RETURNING id`,
        [userId, tx.hash, grossAmountEth, dustAmountEth, netCreditedEth, blockNumber]
      );

      if (rows.length === 0) {
        // Another process beat us (race on ON CONFLICT)
        await client.query('ROLLBACK');
        return;
      }

      const depositId = rows[0].id;

      const balanceAfter = await ledgerService.credit(client, {
        userId,
        amount:        netCreditedEth,
        referenceId:   depositId,
        referenceType: 'deposit',
      });

      await client.query('COMMIT');

      console.log(`[Scanner] credited ${netCreditedEth} EXBT to user ${userId} — tx ${tx.hash}`);

      await redisPublisher.depositConfirmed({
        userId,
        amount:       netCreditedEth,
        txHash:       tx.hash,
        balanceAfter: balanceAfter.toString(),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async _storeUnidentified(tx, blockNumber, weiAmount) {
    const grossEth = ethers.formatEther(weiAmount);
    const { dustWei } = depositIdentifier.extractDust(weiAmount);
    const dustEth     = ethers.formatEther(dustWei);

    await db.query(
      `INSERT INTO unidentified_deposits
         (tx_hash, amount, dust, from_address, block_number)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tx_hash) DO NOTHING`,
      [tx.hash, grossEth, dustEth, tx.from?.toLowerCase(), blockNumber]
    );

    console.warn(`[Scanner] unidentified deposit tx ${tx.hash} amount=${grossEth}`);
  }

  async _getCursor() {
    if (config.scanner.startBlock > 0) return config.scanner.startBlock - 1;

    const { rows } = await db.query(
      'SELECT last_scanned_block FROM scan_cursor WHERE id = 1'
    );
    return rows.length > 0 ? Number(rows[0].last_scanned_block) : 0;
  }

  async _updateCursor(blockNumber) {
    await db.query(
      `UPDATE scan_cursor
         SET last_scanned_block = $1, updated_at = now()
       WHERE id = 1`,
      [blockNumber]
    );
  }
}

module.exports = new DepositScanner();
