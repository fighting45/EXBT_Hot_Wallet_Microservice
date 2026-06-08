function errorHandler(err, req, res, next) {
  // Map known error codes to HTTP statuses
  const statusMap = {
    INSUFFICIENT_BALANCE:     422,
    HOT_WALLET_INSUFFICIENT:  503,
    INVALID_ADDRESS:          400,
    BELOW_MIN:                400,
    NOT_FOUND:                404,
    INVALID_STATE:            409,
  };

  // LedgerService throws plain Error with message as code — normalize it
  if (!err.code && err.message === 'INSUFFICIENT_BALANCE') {
    err.code = 'INSUFFICIENT_BALANCE';
  }

  const status  = statusMap[err.code] || 500;
  const message = status < 500 ? err.message : 'Internal server error';

  if (status >= 500) {
    console.error('[Error]', req.method, req.path, err.message, err.stack);
  }

  res.status(status).json({ error: message });
}

module.exports = errorHandler;
