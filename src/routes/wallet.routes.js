/**
 * src/routes/wallet.routes.js
 * Wallet endpoints for authenticated users.
 */
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { asyncHandler, sendSuccess, AppError } = require('../utils/response');
const walletService = require('../services/wallet.service');

router.use(protect);

/** GET /api/v1/wallet — get balance + recent transactions */
router.get('/', asyncHandler(async (req, res) => {
  const wallet = await walletService.getWallet(req.user.id);
  sendSuccess(res, wallet);
}));

/** POST /api/v1/wallet/add — add money to wallet */
router.post('/add', asyncHandler(async (req, res) => {
  const { amount, description } = req.body;
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new AppError('amount must be a positive number', 400);
  }
  const result = await walletService.addMoney(req.user.id, parsedAmount, description);
  sendSuccess(res, result, `₹${parsedAmount.toFixed(2)} added to wallet`);
}));

/** GET /api/v1/wallet/transactions — paginated transaction history */
router.get('/transactions', asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const result = await walletService.getTransactions(req.user.id, page, limit);
  sendSuccess(res, result);
}));

module.exports = router;
