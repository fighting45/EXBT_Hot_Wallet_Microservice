const router            = require('express').Router();
const { ethers }        = require('ethers');
const db                = require('../config/db');
const walletService     = require('../services/WalletService');
const depositIdentifier = require('../services/DepositIdentifier');
const ledgerService     = require('../services/LedgerService');
const redisPublisher    = require('../services/RedisPublisher');

// GET /deposit/address/:user_id
// Returns hot wallet address + memo instructions for unique-amount fingerprinting
router.get('/deposit/address/:user_id', (req, res) => {
  const userId = parseInt(req.params.user_id, 10);
  if (!Number.isInteger(userId) || userId <= 0 || userId > 999999) {
    return res.status(400).json({ error: 'user_id must be 1–999999' });
  }

  const memo    = depositIdentifier.formatMemo(userId);
  const address = walletService.address;

  res.json({
    address,
    memo,
    instructions: [
      `Send any amount of EXBT to ${address}.`,
      `Append your 6-digit memo (${memo}) as decimal dust to your amount.`,
      `Example: to deposit 100 EXBT, send exactly 100.${memo} EXBT.`,
      'The dust (0.' + memo + ' EXBT) is absorbed as a processing fee.',
      'Your credited amount = sent amount minus dust.',
    ].join(' '),
    example: {
      deposit_100_exbt: `100.${memo}`,
      deposit_50_exbt:  `50.${memo}`,
    },
  });
});

// POST /deposit/verify  — manual fallback: re-process a specific tx_hash
router.post('/deposit/verify', async (req, res, next) => {
  try {
    const { tx_hash } = req.body;
    if (!tx_hash || !/^0x[0-9a-fA-F]{64}$/.test(tx_hash)) {
      return res.status(400).json({ error: 'Invalid tx_hash' });
    }

    // Check already processed
    const { rows: existing } = await db.query(
      'SELECT * FROM exbt_deposits WHERE tx_hash = $1',
      [tx_hash]
    );
    if (existing.length > 0) {
      return res.json({ status: 'already_processed', deposit: existing[0] });
    }

    // Fetch tx from chain
    const tx = await walletService.provider.getTransaction(tx_hash);
    if (!tx) return res.status(404).json({ error: 'Transaction not found on chain' });

    const hotWallet = walletService.address.toLowerCase();
    if (!tx.to || tx.to.toLowerCase() !== hotWallet) {
      return res.status(422).json({ error: 'Transaction is not addressed to hot wallet' });
    }

    if (!tx.blockNumber) {
      return res.status(422).json({ error: 'Transaction not yet confirmed' });
    }

    const weiAmount  = BigInt(tx.value.toString());
    const identified = depositIdentifier.identify(weiAmount);

    if (!identified) {
      // Store as unidentified
      const grossEth = ethers.formatEther(weiAmount);
      const { dustWei } = depositIdentifier.extractDust(weiAmount);
      await db.query(
        `INSERT INTO unidentified_deposits
           (tx_hash, amount, dust, from_address, block_number)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tx_hash) DO NOTHING`,
        [tx_hash, grossEth, ethers.formatEther(dustWei), tx.from?.toLowerCase(), tx.blockNumber]
      );
      return res.json({ status: 'unidentified', tx_hash });
    }

    const { userId, dustAmountEth, netCreditedEth, grossAmountEth } = identified;
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `INSERT INTO exbt_deposits
           (user_id, tx_hash, gross_amount, dust_amount, net_credited, block_number)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tx_hash) DO NOTHING
         RETURNING id`,
        [userId, tx_hash, grossAmountEth, dustAmountEth, netCreditedEth, tx.blockNumber]
      );

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.json({ status: 'already_processed' });
      }

      const depositId    = rows[0].id;
      const balanceAfter = await ledgerService.credit(client, {
        userId,
        amount:        netCreditedEth,
        referenceId:   depositId,
        referenceType: 'deposit',
      });

      await client.query('COMMIT');

      await redisPublisher.depositConfirmed({
        userId, amount: netCreditedEth, txHash: tx_hash, balanceAfter,
      });

      res.json({ status: 'credited', user_id: userId, credited: netCreditedEth });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
