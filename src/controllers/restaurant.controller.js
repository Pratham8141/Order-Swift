/**
 * src/controllers/restaurant.controller.js
 *
 * #1 — Public getRestaurants always forces isActive=true so customers only
 *      ever see open restaurants. Admin bypasses this by calling the service
 *      directly with its own filter.
 */
const restaurantService = require('../services/restaurant.service');
const { sendSuccess, asyncHandler } = require('../utils/response');

// ─── Public ───────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/restaurants
 * Public — no auth needed.
 * Always injects isActive=true so the listing is never empty due to a missing
 * query param (the Zod schema previously coerced undefined → false).
 */
const getRestaurants = asyncHandler(async (req, res) => {
  // Force isActive=true for the public listing regardless of any query param.
  // Admin routes call restaurantService.getRestaurants directly with their own filter.
  const params = { ...req.query, isActive: true };
  sendSuccess(res, await restaurantService.getRestaurants(params));
});

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
