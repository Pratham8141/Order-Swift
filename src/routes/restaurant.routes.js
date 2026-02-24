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

router.get('/:id',           ctrl.getRestaurantById);
router.get('/:id/menu',      ctrl.getMenu);
router.get('/:id/reviews',   reviewCtrl.getReviews);

module.exports = router;
