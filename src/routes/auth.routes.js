const router = require('express').Router();
const ctrl = require('../controllers/auth.controller');
const { validate, schemas } = require('../validations');
const { otpLimiter, authLimiter } = require('../middleware/rateLimiter');
const { protect } = require('../middleware/auth');

router.post('/send-otp',    otpLimiter,  validate(schemas.sendOtp),    ctrl.sendOtp);
router.post('/verify-otp',  authLimiter, validate(schemas.verifyOtp),  ctrl.verifyOtp);
router.post('/google',      authLimiter, validate(schemas.googleAuth),  ctrl.googleLogin);
router.post('/refresh',                  validate(schemas.refreshToken), ctrl.refreshToken);
router.post('/logout',       protect,                                   ctrl.logout);

module.exports = router;
