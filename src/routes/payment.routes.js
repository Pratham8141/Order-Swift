/**
 * src/routes/payment.routes.js
 * Webhook uses raw body parser for signature verification.
 * Payment creation has extra rate limiting.
 */
const router = require('express').Router();
const ctrl = require('../controllers/payment.controller');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../validations');
const { paymentLimiter } = require('../middleware/rateLimiter');

// Webhook: raw body BEFORE express.json() so we can verify Razorpay signature
router.post('/webhook',
  require('express').raw({ type: 'application/json' }),
  ctrl.handleWebhook
);

// Authenticated payment routes
router.use(protect);

router.post('/create-order', paymentLimiter, ctrl.createOrder);
router.post('/verify',       validate(schemas.verifyPayment), ctrl.verifyPayment);

module.exports = router;
