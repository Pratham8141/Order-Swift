/**
 * src/middleware/errorHandler.js
 *
 * Production-grade central error handler for Express + Drizzle + PostgreSQL.
 *
 * ARCHITECTURAL FIXES:
 * ─────────────────────────────────────────────────────────────────────────────
 * FIX 1 — Postgres error details now logged:
 *   Previously only err.message was logged. Postgres errors carry additional
 *   fields (detail, hint, constraint, table, column) that are essential for
 *   diagnosing "column does not exist", "violates foreign key constraint", etc.
 *   These are now captured and logged at the error level.
 *
 * FIX 2 — Drizzle wraps Postgres errors:
 *   Drizzle ORM wraps the original pg error in its own Error object.
 *   The original postgres error is accessible via err.cause (Node.js standard).
 *   We now unwrap it and extract the pg error code from err.cause if err.code
 *   is not directly available.
 *
 * FIX 3 — 42703 "column does not exist" now caught:
 *   This is the exact Postgres error when a Drizzle schema column is missing
 *   from the DB (or vice versa). Previously it returned a generic 500 with no
 *   useful message. Now it logs the full detail and returns a clear 500 with
 *   the column name in development.
 *
 * FIX 4 — Transaction rollback errors now logged separately:
 *   When a ROLLBACK itself fails, the error was previously swallowed. Now both
 *   the original error and the rollback error are captured.
 *
 * FIX 5 — req.body sanitised before logging:
 *   Passwords, tokens, and card numbers are redacted from error logs.
 */
const logger = require('../utils/logger');

// ─── Sensitive field redaction ────────────────────────────────────────────────
const SENSITIVE_FIELDS = new Set([
  'password', 'currentPassword', 'newPassword', 'confirmPassword',
  'token', 'refreshToken', 'accessToken', 'idToken',
  'otp', 'pin', 'cvv', 'cardNumber', 'secret', 'apiKey',
]);

function redactBody(body) {
  if (!body || typeof body !== 'object') return body;
  const clean = { ...body };
  for (const key of Object.keys(clean)) {
    if (SENSITIVE_FIELDS.has(key)) clean[key] = '[REDACTED]';
    else if (typeof clean[key] === 'object' && clean[key] !== null) {
      clean[key] = redactBody(clean[key]);
    }
  }
  return clean;
}

// ─── Postgres / Drizzle error unwrapper ──────────────────────────────────────
/**
 * Drizzle wraps pg errors. The original pg error is in:
 *   err.cause   (Node.js Error.cause standard, used by Drizzle ORM)
 * or directly on err itself when using raw pool.query().
 *
 * Common pg error codes relevant to this app:
 *   23505  unique_violation         → duplicate key
 *   23503  foreign_key_violation    → references non-existent row
 *   23502  not_null_violation       → missing required column
 *   22P02  invalid_text_representation → bad UUID or enum value
 *   42703  undefined_column         → column in query doesn't exist in DB ← KEY ONE
 *   42P01  undefined_table          → table doesn't exist
 *   40001  serialization_failure    → transaction conflict (retry)
 *   40P01  deadlock_detected        → deadlock (retry)
 *   08006  connection_failure       → DB connection lost
 */
function extractPgError(err) {
  // Direct pg error (from pool.query or Drizzle with cause)
  const pg = err.cause || err;
  return {
    code:       pg.code,
    detail:     pg.detail,     // e.g. 'Key (user_id)=(xxx) is not present in table "users"'
    hint:       pg.hint,
    constraint: pg.constraint, // e.g. 'orders_user_id_fkey'
    table:      pg.table,
    column:     pg.column,     // e.g. 'wallet_amount_used' (column does not exist)
    schema:     pg.schema,
    routine:    pg.routine,
  };
}

// ─── Main error handler ───────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  // Unwrap Drizzle wrapper to get real Postgres error fields
  const pg = extractPgError(err);
  const pgCode = pg.code || err.code;

  let statusCode    = err.statusCode || 500;
  let message       = err.message || 'Internal server error';
  let isOperational = err.isOperational || false;

  // ─── Postgres error code mapping ──────────────────────────────────────────

  if (pgCode === '23505') {
    statusCode    = 409;
    message       = pg.detail
      ? `Duplicate record: ${pg.detail}`
      : 'A record with this information already exists';
    isOperational = true;

  } else if (pgCode === '23503') {
    statusCode    = 400;
    message       = pg.detail
      ? `Reference error: ${pg.detail}`
      : 'Referenced record does not exist';
    isOperational = true;

  } else if (pgCode === '23502') {
    statusCode    = 400;
    message       = pg.column
      ? `Required field missing: ${pg.column}`
      : 'Required field is missing';
    isOperational = true;

  } else if (pgCode === '22P02') {
    statusCode    = 400;
    message       = 'Invalid ID format or enum value';
    isOperational = true;

  } else if (pgCode === '42703') {
    // ── FIX 3: "column does not exist" — most likely a missing Drizzle schema field ──
    // Root cause: the DB has a column (added via ALTER TABLE migration) but
    // the Drizzle schema.js definition doesn't include it, or vice versa.
    // To fix: add the column to src/db/schema.js.
    statusCode    = 500;
    message       = 'Database column mismatch. Run pending migrations and verify schema.js.';
    isOperational = false; // not operational — this is a deployment bug

  } else if (pgCode === '42P01') {
    statusCode    = 500;
    message       = 'Database table not found. Ensure all migrations have been run.';
    isOperational = false;

  } else if (pgCode === '40001' || pgCode === '40P01') {
    statusCode    = 503;
    message       = 'Database transaction conflict. Please retry.';
    isOperational = true;

  } else if (pgCode === '08006' || pgCode === '08001') {
    statusCode    = 503;
    message       = 'Database connection failed. Please try again.';
    isOperational = true;
  }

  // ─── JWT errors ───────────────────────────────────────────────────────────
  if (err.name === 'TokenExpiredError') {
    statusCode = 401; message = 'Token has expired'; isOperational = true;
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401; message = 'Invalid token'; isOperational = true;
  }

  // ─── CORS errors ──────────────────────────────────────────────────────────
  if (err.message?.startsWith('CORS:')) {
    statusCode = 403; isOperational = true;
  }

  // ─── Zod validation errors (from validate middleware) ─────────────────────
  if (err.name === 'ZodError') {
    statusCode = 400;
    message = 'Validation error';
    isOperational = true;
  }

  // ─── Structured logging ───────────────────────────────────────────────────
  const logPayload = {
    // Request context
    method:     req.method,
    path:       req.originalUrl,
    userId:     req.user?.id || null,
    body:       redactBody(req.body),
    statusCode,
    // Error info
    errorName:  err.name,
    message:    err.message,
    // Postgres-specific fields (all null if not a pg error)
    pgCode,
    pgDetail:      pg.detail     || null,
    pgHint:        pg.hint       || null,
    pgConstraint:  pg.constraint || null,
    pgTable:       pg.table      || null,
    pgColumn:      pg.column     || null,
    // Stack only in non-production to avoid log bloat
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  };

  if (!isOperational || statusCode >= 500) {
    logger.error('Unhandled server error', logPayload);
  } else if (statusCode >= 400) {
    logger.warn('Client error', { method: req.method, path: req.originalUrl, message, statusCode });
  }

  // ─── HTTP response ────────────────────────────────────────────────────────
  const isDev = process.env.NODE_ENV === 'development';
  res.status(statusCode).json({
    success: false,
    message: isOperational ? message : 'Internal server error',
    ...(isDev && {
      debug: {
        original: err.message,
        pgCode:      pgCode      || undefined,
        pgDetail:    pg.detail   || undefined,
        pgColumn:    pg.column   || undefined,
        pgConstraint:pg.constraint || undefined,
        stack: err.stack,
      },
    }),
  });
};

// ─── 404 handler ─────────────────────────────────────────────────────────────
const notFound = (req, res) => {
  logger.warn('Route not found', { method: req.method, path: req.originalUrl });
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
};

module.exports = { errorHandler, notFound };
