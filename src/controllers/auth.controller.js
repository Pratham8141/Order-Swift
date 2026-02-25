/**
 * src/controllers/auth.controller.js
 *
 * Issue #4: Added checkPhone controller.
 * The frontend calls POST /auth/check-phone BEFORE sending OTP.
 * Response: { exists: boolean }
 *   true  → user exists → login flow → send OTP → OTP screen
 *   false → new user → navigate to Register screen
 */
const authService = require('../services/auth.service');
const { sendSuccess, asyncHandler } = require('../utils/response');

/**
 * POST /api/v1/auth/check-phone
 * Body: { phone: string }
 * Response: { exists: boolean }
 *
 * Pure check — no OTP sent, no records created.
 * Used by login screen to decide: login flow vs register flow.
 */
const checkPhone = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  const result = await authService.checkPhoneExists(phone);
  sendSuccess(res, result, 'Phone check complete');
});

/**
 * POST /api/v1/auth/send-otp
 * Body: { phone, role? }
 */
const sendOtp = asyncHandler(async (req, res) => {
  const { phone, role } = req.body;
  const result = await authService.sendOtp(phone, role);
  sendSuccess(res, result, 'OTP sent successfully');
});

/**
 * POST /api/v1/auth/verify-otp
 * Body: { phone, otp, role? }
 *
 * role: only applied for NEW account creation.
 * Existing accounts always use stored role.
 * "admin" is always rejected.
 */
const verifyOtp = asyncHandler(async (req, res) => {
  const { phone, otp, role } = req.body;
  const result = await authService.verifyOtp(phone, otp, role);
  sendSuccess(res, result, 'Login successful');
});

const googleLogin = asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  const result = await authService.googleLogin(idToken);
  sendSuccess(res, result, 'Google login successful');
});

const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.refreshAccessToken(refreshToken);
  sendSuccess(res, result, 'Token refreshed');
});

const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken);
  sendSuccess(res, {}, 'Logged out successfully');
});

module.exports = { checkPhone, sendOtp, verifyOtp, googleLogin, refreshToken, logout };
