const userService = require('../services/user.service');
const { sendSuccess, asyncHandler, AppError } = require('../utils/response');

// Profile
const getProfile  = asyncHandler(async (req, res) => sendSuccess(res, await userService.getProfile(req.user.id)));
const updateProfile = asyncHandler(async (req, res) => sendSuccess(res, await userService.updateProfile(req.user.id, req.body), 'Profile updated'));
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await userService.changePassword(req.user.id, currentPassword, newPassword);
  sendSuccess(res, {}, 'Password changed successfully');
});
const savePushToken = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) throw new AppError('token is required', 400);
  await userService.savePushToken(req.user.id, token);
  sendSuccess(res, {}, 'Push token saved');
});

// Addresses
const getAddresses  = asyncHandler(async (req, res) => sendSuccess(res, await userService.getAddresses(req.user.id)));
const addAddress    = asyncHandler(async (req, res) => sendSuccess(res, await userService.addAddress(req.user.id, req.body), 'Address added', 201));
const updateAddress = asyncHandler(async (req, res) => sendSuccess(res, await userService.updateAddress(req.user.id, req.params.id, req.body), 'Address updated'));
const deleteAddress = asyncHandler(async (req, res) => {
  await userService.deleteAddress(req.user.id, req.params.id);
  sendSuccess(res, {}, 'Address deleted');
});

// Favorites
const getFavorites  = asyncHandler(async (req, res) => sendSuccess(res, await userService.getFavorites(req.user.id)));
const getFavoriteIds = asyncHandler(async (req, res) => sendSuccess(res, await userService.getFavoriteIds(req.user.id)));
const toggleFavorite = asyncHandler(async (req, res) => {
  const { restaurantId } = req.body;
  if (!restaurantId) throw new AppError('restaurantId is required', 400);
  sendSuccess(res, await userService.toggleFavorite(req.user.id, restaurantId));
});

// Notifications
const getNotifications = asyncHandler(async (req, res) => sendSuccess(res, await userService.getNotifications(req.user.id)));
const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await userService.markAllNotificationsRead(req.user.id);
  sendSuccess(res, {}, 'All notifications marked as read');
});
const markNotificationRead = asyncHandler(async (req, res) => {
  sendSuccess(res, await userService.markNotificationRead(req.user.id, req.params.id), 'Notification marked as read');
});

module.exports = {
  getProfile, updateProfile, changePassword, savePushToken,
  getAddresses, addAddress, updateAddress, deleteAddress,
  getFavorites, getFavoriteIds, toggleFavorite,
  getNotifications, markAllNotificationsRead, markNotificationRead,
};
