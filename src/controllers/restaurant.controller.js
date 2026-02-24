/**
 * src/controllers/restaurant.controller.js
 * Exports both route handlers and internal service wrappers used by admin routes.
 */
const restaurantService = require('../services/restaurant.service');
const { sendSuccess, asyncHandler } = require('../utils/response');

// ─── Public route handlers ────────────────────────────────────────────────────
const getRestaurants = asyncHandler(async (req, res) =>
  sendSuccess(res, await restaurantService.getRestaurants(req.query))
);

const getRestaurantById = asyncHandler(async (req, res) =>
  sendSuccess(res, await restaurantService.getRestaurantById(req.params.id))
);

const getMenu = asyncHandler(async (req, res) =>
  sendSuccess(res, await restaurantService.getMenu(req.params.id))
);

// ─── Internal wrappers (used by admin.routes.js) ──────────────────────────────
const _createRestaurant = (data) => restaurantService.createRestaurant(data);
const _updateRestaurant = (id, data) => restaurantService.updateRestaurant(id, data);
const _deleteRestaurant = (id) => restaurantService.deleteRestaurant(id);

module.exports = {
  getRestaurants,
  getRestaurantById,
  getMenu,
  _createRestaurant,
  _updateRestaurant,
  _deleteRestaurant,
};
