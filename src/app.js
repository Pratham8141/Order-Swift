/**
 * src/app.js
 * Express application setup — middleware stack, routes, error handling.
 *
 * CHANGE: Added `/api/v1/owner` route for restaurant_owner role.
 */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const { globalLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();

// ─── Security Headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS — strict allowlist from env ────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Render / proxy trust (required for rate limiting on Render) ──────────────
app.set('trust proxy', 1);

// ─── Body Parsing — limit prevents large payload attacks ─────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(compression());

// ─── HTTP Request Logging ─────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip: (req) => req.path === '/health',
}));

// ─── Global Rate Limit ────────────────────────────────────────────────────────
app.use(globalLimiter);

// ─── Health Check (before auth middleware) ────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: process.env.NODE_ENV,
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
const API = '/api/v1';
app.use(`${API}/auth`,        require('./routes/auth.routes'));
app.use(`${API}/user`,        require('./routes/user.routes'));
app.use(`${API}/restaurants`, require('./routes/restaurant.routes'));
app.use(`${API}/cart`,        require('./routes/cart.routes'));
app.use(`${API}/orders`,      require('./routes/order.routes'));
app.use(`${API}/payments`,    require('./routes/payment.routes'));
app.use(`${API}/reviews`,     require('./routes/review.routes'));
app.use(`${API}/admin`,       require('./routes/admin.routes'));

// ─── Restaurant Owner Routes (NEW) ────────────────────────────────────────────
app.use(`${API}/owner`,       require('./routes/restaurantOwner.routes'));

// ─── 404 + Central Error Handler ─────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
