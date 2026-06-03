const crypto = require('crypto');
const config = require('../config');

// HMAC-SHA256 of the raw request body, keyed on SERVICE_TOKEN_SECRET.
// Laravel sets: X-Service-Token: <hex-hmac>
// Laravel also sets: X-Timestamp: <unix-seconds>  (replay window: 60s)
function serviceAuth(req, res, next) {
  const token     = req.headers['x-service-token'];
  const timestamp = req.headers['x-timestamp'];

  if (!token || !timestamp) {
    return res.status(401).json({ error: 'Missing service auth headers' });
  }

  // Replay protection — 60-second window
  const now  = Math.floor(Date.now() / 1000);
  const ts   = parseInt(timestamp, 10);
  if (Math.abs(now - ts) > 60) {
    return res.status(401).json({ error: 'Request timestamp out of range' });
  }

  // HMAC over "<timestamp>:<raw-body>"
  const rawBody = req.rawBody || '';
  const expected = crypto
    .createHmac('sha256', config.auth.serviceTokenSecret)
    .update(`${timestamp}:${rawBody}`)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid service token' });
  }

  next();
}

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Missing admin token' });

  if (!crypto.timingSafeEqual(
    Buffer.from(token),
    Buffer.from(config.auth.adminToken)
  )) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  next();
}

module.exports = { serviceAuth, adminAuth };
