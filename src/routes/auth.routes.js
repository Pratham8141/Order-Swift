/**
 * src/routes/auth.routes.js
 *
 * Issue #4: Added POST /check-phone route.
 * The frontend calls this first to determine login vs registration flow.
 */
const router = require('express').Router();
const ctrl = require('../controllers/auth.controller');
const { validate, schemas } = require('../validations');
const { otpLimiter, authLimiter } = require('../middleware/rateLimiter');
const { protect } = require('../middleware/auth');

// Issue #4: Check if phone is registered — pure read, no OTP sent.
// Returns { exists: boolean }
router.post('/check-phone', authLimiter, validate(schemas.checkPhone), ctrl.checkPhone);

router.post('/send-otp',   otpLimiter,  validate(schemas.sendOtp),    ctrl.sendOtp);
router.post('/verify-otp', authLimiter, validate(schemas.verifyOtp),  ctrl.verifyOtp);
router.post('/google',     authLimiter, validate(schemas.googleAuth),  ctrl.googleLogin);
router.post('/refresh',                 validate(schemas.refreshToken), ctrl.refreshToken);
router.post('/logout',     protect,                                    ctrl.logout);

module.exports = router;
