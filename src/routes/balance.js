const router        = require('express').Router();
const ledgerService = require('../services/LedgerService');
const walletService = require('../services/WalletService');

// GET /health
router.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// GET /hot-wallet/address
router.get('/hot-wallet/address', (req, res) => {
  res.json({ address: walletService.address });
});

// GET /balance/:user_id
router.get('/balance/:user_id', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.user_id, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const bal = await ledgerService.getBalance(userId);
    res.json({ user_id: userId, ...bal });
  } catch (err) {
    next(err);
  }
});

// GET /ledger/:user_id
router.get('/ledger/:user_id', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.user_id, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const data  = await ledgerService.getLedger(userId, page, limit);
    res.json({ user_id: userId, page, limit, ...data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
