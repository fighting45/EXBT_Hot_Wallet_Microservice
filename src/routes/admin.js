const router    = require('express').Router();
const db        = require('../config/db');
const { adminAuth } = require('../middleware/auth');

// All admin routes require X-Admin-Token
router.use(adminAuth);

// GET /admin/unidentified
router.get('/unidentified', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    const { rows } = await db.query(
      `SELECT id, tx_hash, amount, dust, from_address, block_number, created_at
       FROM unidentified_deposits
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const { rows: count } = await db.query(
      'SELECT COUNT(*) AS total FROM unidentified_deposits'
    );

    res.json({ page, limit, total: parseInt(count[0].total, 10), items: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
