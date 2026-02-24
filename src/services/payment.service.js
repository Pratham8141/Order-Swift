/**
 * src/services/payment.service.js
 * Razorpay integration with:
 * - Double-payment prevention (409 if already paid)
 * - Razorpay order reuse if checkout is reopened
 * - HMAC-SHA256 signature verification
 * - Webhook handler with signature verification
 */
const crypto = require('crypto');
const razorpay = require('../config/razorpay');
const { db } = require('../db');
const { orders } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { AppError } = require('../utils/response');
const logger = require('../utils/logger');

// ─── Create Razorpay payment order ───────────────────────────────────────────
const createPaymentOrder = async (userId, orderId) => {
  const [order] = await db.select().from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) throw new AppError('Order not found', 404);
  if (order.userId !== userId) throw new AppError('Unauthorized', 403);
  if (order.status === 'cancelled') throw new AppError('Cannot pay for a cancelled order', 400);

  // ── Double-payment guard ──────────────────────────────────────────────────
  if (order.paymentStatus === 'paid') {
    throw new AppError('This order has already been paid', 409);
  }

  // ── Idempotency: reuse existing Razorpay order if it's still open ─────────
  if (order.razorpayOrderId) {
    try {
      const existingRzpOrder = await razorpay.orders.fetch(order.razorpayOrderId);
      if (existingRzpOrder.status === 'created') {
        logger.info('Reusing existing Razorpay order', {
          orderId,
          razorpayOrderId: existingRzpOrder.id,
        });
        return {
          razorpayOrderId: existingRzpOrder.id,
          amount: existingRzpOrder.amount,
          currency: existingRzpOrder.currency,
          keyId: process.env.RAZORPAY_KEY_ID,
        };
      }
    } catch (err) {
      // Razorpay order not found or already paid — create a new one
      logger.warn('Could not fetch existing Razorpay order, creating new', {
        razorpayOrderId: order.razorpayOrderId,
        error: err.message,
      });
    }
  }

  // ── Create new Razorpay order ─────────────────────────────────────────────
  // Amount in paise (1 INR = 100 paise)
  const amountInPaise = Math.round(parseFloat(order.totalAmount) * 100);

  const rzpOrder = await razorpay.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt: `rcpt_${orderId.replace(/-/g, '').slice(0, 20)}`,
    notes: {
      orderId,
      userId,
    },
  });

  // Store Razorpay order ID on our order record
  await db.update(orders)
    .set({ razorpayOrderId: rzpOrder.id, updatedAt: new Date() })
    .where(eq(orders.id, orderId));

  logger.info('Razorpay order created', {
    orderId,
    razorpayOrderId: rzpOrder.id,
    amount: rzpOrder.amount,
  });

  return {
    razorpayOrderId: rzpOrder.id,
    amount: rzpOrder.amount,
    currency: rzpOrder.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
  };
};

// ─── Verify payment signature and mark order paid ────────────────────────────
const verifyPayment = async (userId, { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId }) => {
  // 1. Verify HMAC-SHA256 signature (Razorpay spec)
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpaySignature) {
    logger.warn('Payment signature mismatch', { orderId, userId });
    throw new AppError('Payment verification failed: signature mismatch', 400);
  }

  // 2. Load order and run all guards
  const [order] = await db.select().from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) throw new AppError('Order not found', 404);
  if (order.userId !== userId) throw new AppError('Unauthorized', 403);

  // ── Double-payment guard ──────────────────────────────────────────────────
  if (order.paymentStatus === 'paid') {
    throw new AppError('This order has already been paid', 409);
  }

  // ── Razorpay order ID must match what we stored ───────────────────────────
  if (order.razorpayOrderId !== razorpayOrderId) {
    logger.warn('Razorpay order ID mismatch', { orderId, stored: order.razorpayOrderId, received: razorpayOrderId });
    throw new AppError('Payment order ID mismatch', 400);
  }

  // 3. Mark order as paid
  const [updated] = await db.update(orders)
    .set({
      status: 'paid',
      paymentStatus: 'paid',
      razorpayPaymentId,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId))
    .returning();

  logger.info('Payment verified and order marked paid', {
    orderId,
    razorpayPaymentId,
    amount: order.totalAmount,
  });

  return updated;
};

// ─── Razorpay Webhook handler ─────────────────────────────────────────────────
// Mount on POST /api/v1/payments/webhook
// Set raw body parser BEFORE express.json() for this route
const handleWebhook = async (rawBody, signature) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.warn('RAZORPAY_WEBHOOK_SECRET not set — skipping webhook verification');
    return { received: true };
  }

  // Verify webhook signature
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (expectedSignature !== signature) {
    throw new AppError('Webhook signature verification failed', 400);
  }

  const event = JSON.parse(rawBody);
  logger.info('Razorpay webhook received', { event: event.event });

  // Handle payment.failed — mark order payment as failed
  if (event.event === 'payment.failed') {
    const razorpayOrderId = event.payload?.payment?.entity?.order_id;
    if (razorpayOrderId) {
      await db.update(orders)
        .set({ paymentStatus: 'failed', updatedAt: new Date() })
        .where(eq(orders.razorpayOrderId, razorpayOrderId));
      logger.warn('Payment failed via webhook', { razorpayOrderId });
    }
  }

  return { received: true };
};

module.exports = { createPaymentOrder, verifyPayment, handleWebhook };
