const userService = require('../services/user.service');
const { sendSuccess, asyncHandler } = require('../utils/response');

const getProfile  = asyncHandler(async (req, res) => sendSuccess(res, await userService.getProfile(req.user.id)));
const updateProfile = asyncHandler(async (req, res) => sendSuccess(res, await userService.updateProfile(req.user.id, req.body), 'Profile updated'));
const getAddresses  = asyncHandler(async (req, res) => sendSuccess(res, await userService.getAddresses(req.user.id)));
const addAddress    = asyncHandler(async (req, res) => sendSuccess(res, await userService.addAddress(req.user.id, req.body), 'Address added', 201));
const updateAddress = asyncHandler(async (req, res) => sendSuccess(res, await userService.updateAddress(req.user.id, req.params.id, req.body), 'Address updated'));
const deleteAddress = asyncHandler(async (req, res) => {
  await userService.deleteAddress(req.user.id, req.params.id);
  sendSuccess(res, {}, 'Address deleted');
});

module.exports = { getProfile, updateProfile, getAddresses, addAddress, updateAddress, deleteAddress };
