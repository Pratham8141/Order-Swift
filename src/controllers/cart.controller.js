const cartService = require('../services/cart.service');
const { sendSuccess, asyncHandler } = require('../utils/response');

const getCart     = asyncHandler(async (req, res) => sendSuccess(res, await cartService.getCart(req.user.id)));
const addToCart   = asyncHandler(async (req, res) => sendSuccess(res, await cartService.addToCart(req.user.id, req.body), 'Item added to cart', 201));
const updateCart  = asyncHandler(async (req, res) => sendSuccess(res, await cartService.updateCartItem(req.user.id, req.body), 'Cart updated'));
const removeItem  = asyncHandler(async (req, res) => sendSuccess(res, await cartService.removeCartItem(req.user.id, req.body.cartItemId), 'Item removed'));
const clearCart   = asyncHandler(async (req, res) => {
  await cartService.clearCart(req.user.id);
  sendSuccess(res, {}, 'Cart cleared');
});

module.exports = { getCart, addToCart, updateCart, removeItem, clearCart };
