/**
 * src/middleware/rateLimiter.js
 * Rate limiters for different endpoint sensitivity levels.
 * All use IP + phone (where available) as key.
 */
const rateLimit = require('express-rate-limit');

const rateLimitResponse = (message) => ({
  success: false,
  message,
  retryAfter: 'See Retry-After header',
});

// ─── Global limiter — all routes ──────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000, // 10 min
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many requests. Please slow down.'),
});

// ─── OTP — 3 per 10 minutes per phone number ─────────────────────────────────
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: parseInt(process.env.OTP_RATE_LIMIT_MAX) || 3,
  // Key by phone number so IP changes don't bypass the limit
  keyGenerator: (req) => `otp_${req.body?.phone || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many OTP requests. Try again after 10 minutes.'),
});

// ─── Auth — 20 attempts per 15 minutes ───────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `auth_${req.body?.phone || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many authentication attempts. Try again in 15 minutes.'),
});

// ─── Search — 60 per minute ───────────────────────────────────────────────────
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Search rate limit exceeded. Slow down.'),
});

// ─── Payment — 10 per hour (prevent order spam) ───────────────────────────────
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `pay_${req.user?.id || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many payment attempts. Try again later.'),
});

module.exports = { globalLimiter, otpLimiter, authLimiter, searchLimiter, paymentLimiter };
