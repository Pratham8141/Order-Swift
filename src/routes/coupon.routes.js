/**
 * src/routes/coupon.routes.js
 */
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { asyncHandler, sendSuccess } = require('../utils/response');
const couponService = require('../services/coupon.service');

router.use(protect);

/**
 * POST /api/v1/coupons/validate
 * Body: { code, subtotal }
 * Returns: { coupon, discountAmount }
 */
router.post('/validate', asyncHandler(async (req, res) => {
  const { code, subtotal } = req.body;
  const parsedSubtotal = parseFloat(subtotal);
  const result = await couponService.validateCoupon(code, req.user.id, parsedSubtotal);
  sendSuccess(res, result, 'Coupon is valid');
}));

module.exports = router;
