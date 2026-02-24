/**
 * src/controllers/payment.controller.js
 */
const paymentService = require('../services/payment.service');
const { sendSuccess, asyncHandler } = require('../utils/response');
const logger = require('../utils/logger');

const createOrder = asyncHandler(async (req, res) => {
  const result = await paymentService.createPaymentOrder(req.user.id, req.body.orderId);
  sendSuccess(res, result, 'Payment order created');
});

const verifyPayment = asyncHandler(async (req, res) => {
  const result = await paymentService.verifyPayment(req.user.id, req.body);
  sendSuccess(res, result, 'Payment verified successfully');
});

// Webhook — no auth middleware, verified by signature
const handleWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  if (!signature) {
    return res.status(400).json({ success: false, message: 'Missing webhook signature' });
  }

  // req.body is raw Buffer (express.raw middleware applied in routes)
  const rawBody = req.body.toString('utf8');
  const result = await paymentService.handleWebhook(rawBody, signature);
  res.status(200).json(result);
});

module.exports = { createOrder, verifyPayment, handleWebhook };
