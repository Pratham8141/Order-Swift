const reviewService = require('../services/review.service');
const { sendSuccess, asyncHandler } = require('../utils/response');

const addReview = asyncHandler(async (req, res) =>
  sendSuccess(res, await reviewService.addReview(req.user.id, req.body), 'Review added', 201));

const getReviews = asyncHandler(async (req, res) =>
  sendSuccess(res, await reviewService.getRestaurantReviews(req.params.id, req.query.page, req.query.limit)));

module.exports = { addReview, getReviews };
