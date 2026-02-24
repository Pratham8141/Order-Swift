const authService = require('../services/auth.service');
const { sendSuccess, asyncHandler } = require('../utils/response');

/**
 * POST /api/v1/auth/send-otp
 *
 * Body:
 *   { phone: string, role?: "user" | "restaurant_owner" }
 *
 * role is optional. When provided it is used as a hint for new account creation
 * inside verifyOtp. It has no effect on existing accounts.
 */
const sendOtp = asyncHandler(async (req, res) => {
  const { phone, role } = req.body;
  const result = await authService.sendOtp(phone, role);
  sendSuccess(res, result, 'OTP sent successfully');
});

/**
 * POST /api/v1/auth/verify-otp
 *
 * Body:
 *   { phone: string, otp: string, role?: "user" | "restaurant_owner" }
 *
 * role is passed to the service which decides whether to use it:
 *   - New account  → role used to set initial user role (defaults to "user")
 *   - Existing     → role ignored, stored role returned
 *   - "admin"      → rejected with 400 by the service
 *
 * Response shape (unchanged):
 *   { success: true, message: string,
 *     data: { user, accessToken, refreshToken, isNewUser } }
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

module.exports = { sendOtp, verifyOtp, googleLogin, refreshToken, logout };
