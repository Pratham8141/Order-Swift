/**
 * src/controllers/order.controller.js
 */
const orderService = require('../services/order.service');
const { sendSuccess, asyncHandler } = require('../utils/response');

const createOrder  = asyncHandler(async (req, res) => {
  const idempotencyKey = req.headers['x-idempotency-key'] || null;
  const { notes, pickupName, useWallet, couponCode } = req.body;
  const body = { notes, pickupName, idempotencyKey, useWallet: !!useWallet, couponCode };
  sendSuccess(res, await orderService.createOrder(req.user.id, body), 'Order created', 201);
});

const getOrders = asyncHandler(async (req, res) =>
  sendSuccess(res, await orderService.getOrders(req.user.id, req.query.page, req.query.limit))
);

const getOrderById = asyncHandler(async (req, res) =>
  sendSuccess(res, await orderService.getOrderById(req.params.id, req.user.id))
);

const cancelOrder = asyncHandler(async (req, res) =>
  sendSuccess(res, await orderService.cancelOrder(req.params.id, req.user.id), 'Order cancelled')
);

const reorder = asyncHandler(async (req, res) => {
  const result = await orderService.reorderFromPastOrder(req.params.id, req.user.id);
  sendSuccess(res, result, result.message);
});

// Admin
const adminGetOrders = asyncHandler(async (req, res) =>
  sendSuccess(res, await orderService.getAllOrders(req.query))
);

const _adminUpdateStatus = (orderId, status, estimatedTime) =>
  orderService.updateOrderStatus(orderId, status, estimatedTime);

module.exports = { createOrder, getOrders, getOrderById, cancelOrder, reorder, adminGetOrders, _adminUpdateStatus };
