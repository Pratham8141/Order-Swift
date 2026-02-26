/**
 * src/routes/restaurant.routes.js
 * Public routes — no auth required.
 * Search endpoint has its own tighter rate limit.
 */
const router = require('express').Router();
const ctrl = require('../controllers/restaurant.controller');
const reviewCtrl = require('../controllers/review.controller');
const { validateQuery, schemas } = require('../validations');
const { searchLimiter } = require('../middleware/rateLimiter');

router.get('/',
  searchLimiter,
  validateQuery(schemas.restaurantQuery),
  ctrl.getRestaurants
);

const { db } = require('../db');
const { menuItems } = require('../db/schema');
const { eq, and, notInArray } = require('drizzle-orm');
const { asyncHandler: ah, sendSuccess: ss } = require('../utils/response');

router.get('/:id',           ctrl.getRestaurantById);
router.get('/:id/menu',      ctrl.getMenu);
router.get('/:id/reviews',   reviewCtrl.getReviews);

/**
 * GET /api/v1/restaurants/:id/recommendations
 * Used by "Complete Your Meal" cart widget.
 */
router.get('/:id/recommendations', ah(async (req, res) => {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 10, 20);
  const excludeIds = req.query.excludeIds
    ? req.query.excludeIds.split(',').filter(Boolean)
    : [];

  const conditions = [
    eq(menuItems.restaurantId, id),
    eq(menuItems.isAvailable, true),
  ];
  if (excludeIds.length > 0) {
    conditions.push(notInArray(menuItems.id, excludeIds));
  }

  const items = await db
    .select()
    .from(menuItems)
    .where(and(...conditions))
    .limit(limit);

  ss(res, items);
}));

module.exports = router;
