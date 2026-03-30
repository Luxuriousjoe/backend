const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  const status  = err.status || 500;
  const message = err.message || 'Internal server error';

  logger.error(`ERROR_HANDLER | ${status} | ${req.method} ${req.originalUrl}`);
  logger.error(`ERROR_HANDLER | Message: ${message}`);
  logger.error(`ERROR_HANDLER | Code: ${err.code || 'none'}`);
  if (err.stack && process.env.NODE_ENV !== 'production') {
    logger.error('Stack:', err.stack);
  }

  // MySQL duplicate entry
  if (err.code === 'ER_DUP_ENTRY') {
    logger.warn('DB | Duplicate entry attempted');
    return res.status(409).json({ success: false, message: 'This record already exists' });
  }

  // MySQL no such table — helpful for setup issues
  if (err.code === 'ER_NO_SUCH_TABLE') {
    logger.error(`DB | Table does not exist: ${err.message}`);
    logger.error('DB | Make sure you have run schema.sql on your defaultdb database');
    return res.status(500).json({
      success: false,
      message: 'Database table not found — the schema may not be set up yet',
    });
  }

  // MySQL connection issues
  if (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR') {
    logger.error('DB | Connection refused or access denied');
    return res.status(500).json({
      success: false,
      message: 'Database connection error — check server logs',
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
  }

  // Validation
  if (err.name === 'ValidationError') {
    return res.status(400).json({ success: false, message });
  }

  return res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
