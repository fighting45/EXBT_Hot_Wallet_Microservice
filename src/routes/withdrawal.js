const router             = require('express').Router();
const withdrawalService  = require('../services/WithdrawalService');
const { withdrawalLimiter } = require('../middleware/rateLimit');
const { adminAuth }      = require('../middleware/auth');

// POST /withdrawal/request
router.post('/withdrawal/request', withdrawalLimiter, async (req, res, next) => {
  try {
    const { user_id, to_address, amount } = req.body;

    if (!user_id || !to_address || !amount) {
      return res.status(400).json({ error: 'user_id, to_address, and amount are required' });
    }

    const userId = parseInt(user_id, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const result = await withdrawalService.request({
      userId,
      toAddress: to_address,
      amount:    amount.toString(),
    });

    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /withdrawal/:id/status
router.get('/:id/status', async (req, res, next) => {
  try {
    const w = await withdrawalService.getStatus(req.params.id);
    if (!w) return res.status(404).json({ error: 'Withdrawal not found' });
    res.json(w);
  } catch (err) {
    next(err);
  }
});

// POST /withdrawal/:id/retry  — admin only
router.post('/:id/retry', adminAuth, async (req, res, next) => {
  try {
    const result = await withdrawalService.retry(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
