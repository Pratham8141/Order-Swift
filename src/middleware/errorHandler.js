/**
 * src/middleware/errorHandler.js
 * Central error handler — every thrown error lands here.
 * Maps known error types to appropriate HTTP responses.
 */
const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let isOperational = err.isOperational || false;

  // ─── Postgres / Drizzle error codes ─────────────────────────────────────────
  if (err.code === '23505') {
    // Unique constraint violation
    statusCode = 409;
    message = 'A record with this information already exists';
    isOperational = true;
  } else if (err.code === '23503') {
    // Foreign key violation
    statusCode = 400;
    message = 'Referenced record does not exist';
    isOperational = true;
  } else if (err.code === '23502') {
    // Not-null violation
    statusCode = 400;
    message = 'Required field is missing';
    isOperational = true;
  } else if (err.code === '22P02') {
    // Invalid UUID / type cast
    statusCode = 400;
    message = 'Invalid ID format';
    isOperational = true;
  }

  // ─── JWT errors ───────────────────────────────────────────────────────────
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token has expired';
    isOperational = true;
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    isOperational = true;
  }

  // ─── CORS errors ─────────────────────────────────────────────────────────
  if (err.message?.startsWith('CORS:')) {
    statusCode = 403;
    isOperational = true;
  }

  // ─── Log non-operational (unexpected) errors ──────────────────────────────
  if (!isOperational || statusCode >= 500) {
    logger.error('Unhandled server error', {
      message: err.message,
      stack: err.stack,
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.id || null,
      body: req.body,
      statusCode,
    });
  }

  // ─── Response ─────────────────────────────────────────────────────────────
  res.status(statusCode).json({
    success: false,
    message: isOperational ? message : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && {
      debug: { stack: err.stack, original: err.message },
    }),
  });
};

const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
};

module.exports = { errorHandler, notFound };
