const rateLimit = require('express-rate-limit');
const config    = require('../config');

// Per-user withdrawal rate limit — keyed on user_id in the request body.
// Falls back to IP if user_id is absent.
const withdrawalLimiter = rateLimit({
  windowMs:         60 * 60 * 1000, // 1 hour
  max:              config.withdrawal.rateLimit,
  keyGenerator:     (req) => `uid:${req.body?.user_id ?? req.ip}`,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many withdrawal requests — try again later' },
  skipFailedRequests: false,
});

module.exports = { withdrawalLimiter };
