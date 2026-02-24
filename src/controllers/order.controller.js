/**
 * src/controllers/order.controller.js
 */
const orderService = require('../services/order.service');
const { sendSuccess, asyncHandler } = require('../utils/response');

const createOrder  = asyncHandler(async (req, res) =>
  sendSuccess(res, await orderService.createOrder(req.user.id, req.body), 'Order created', 201)
);

const getOrders = asyncHandler(async (req, res) =>
  sendSuccess(res, await orderService.getOrders(req.user.id, req.query.page, req.query.limit))
);

const getOrderById = asyncHandler(async (req, res) =>
  sendSuccess(res, await orderService.getOrderById(req.params.id, req.user.id))
);

const cancelOrder = asyncHandler(async (req, res) =>
  sendSuccess(res, await orderService.cancelOrder(req.params.id, req.user.id), 'Order cancelled')
);

// Admin
const adminGetOrders = asyncHandler(async (req, res) =>
  sendSuccess(res, await orderService.getAllOrders(req.query))
);

// Internal wrapper used by admin.routes.js (returns data, not response)
const _adminUpdateStatus = (orderId, status, estimatedTime) =>
  orderService.updateOrderStatus(orderId, status, estimatedTime);

module.exports = { createOrder, getOrders, getOrderById, cancelOrder, adminGetOrders, _adminUpdateStatus };
