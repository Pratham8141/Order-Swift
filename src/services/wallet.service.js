/**
 * src/services/wallet.service.js
 * Wallet: get balance, add money, debit on order, refund on cancel.
 * All balance mutations use FOR UPDATE row-level locking for safety.
 */
const { db, pool } = require('../db');
const { wallets, walletTransactions } = require('../db/schema');
const { eq, desc } = require('drizzle-orm');
const { AppError } = require('../utils/response');
const logger = require('../utils/logger');

// ─── Get or create wallet ─────────────────────────────────────────────────────
const getOrCreateWallet = async (userId) => {
  const [existing] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(wallets)
    .values({ userId, balance: '0.00' })
    .returning();
  return created;
};

// ─── Get wallet + recent transactions ────────────────────────────────────────
const getWallet = async (userId) => {
  const wallet = await getOrCreateWallet(userId);

  const transactions = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(30);

  return { ...wallet, transactions };
};

// ─── Add money (credit) ───────────────────────────────────────────────────────
const addMoney = async (userId, amount, description = 'Added to wallet') => {
  const amtNum = parseFloat(amount);
  if (isNaN(amtNum) || amtNum <= 0) throw new AppError('Amount must be a positive number', 400);
  if (amtNum > 50000) throw new AppError('Cannot add more than ₹50,000 at once', 400);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the wallet row
    await client.query(`
      INSERT INTO wallets (user_id, balance) VALUES ($1, 0)
      ON CONFLICT (user_id) DO NOTHING
    `, [userId]);

    const { rows: [wallet] } = await client.query(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2 RETURNING *`,
      [amtNum.toFixed(2), userId]
    );

    await client.query(
      `INSERT INTO wallet_transactions (user_id, type, amount, description, balance_after)
       VALUES ($1, 'credit', $2, $3, $4)`,
      [userId, amtNum.toFixed(2), description, wallet.balance]
    );

    await client.query('COMMIT');
    logger.info('Wallet credit', { userId, amount: amtNum, newBalance: wallet.balance });
    return { balance: parseFloat(wallet.balance), added: amtNum };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Debit wallet (called during order placement) ─────────────────────────────
const debitWallet = async (userId, amount, orderId, description = 'Order payment') => {
  const amtNum = parseFloat(amount);
  if (isNaN(amtNum) || amtNum <= 0) throw new AppError('Invalid debit amount', 400);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [wallet] } = await client.query(
      `SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );

    if (!wallet) throw new AppError('Wallet not found', 404);

    const currentBalance = parseFloat(wallet.balance);
    if (currentBalance < amtNum) {
      throw new AppError(
        `Insufficient wallet balance. Available: ₹${currentBalance.toFixed(2)}`,
        400
      );
    }

    const { rows: [updated] } = await client.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2 RETURNING *`,
      [amtNum.toFixed(2), userId]
    );

    await client.query(
      `INSERT INTO wallet_transactions
         (user_id, type, amount, description, reference_id, balance_after)
       VALUES ($1, 'debit', $2, $3, $4, $5)`,
      [userId, amtNum.toFixed(2), description, orderId, updated.balance]
    );

    await client.query('COMMIT');
    logger.info('Wallet debit', { userId, amount: amtNum, orderId, newBalance: updated.balance });
    return { balance: parseFloat(updated.balance), debited: amtNum };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Refund to wallet (called on order cancel) ────────────────────────────────
const refundToWallet = async (userId, amount, orderId, description = 'Order refund') => {
  return addMoney(userId, amount, description);
};

// ─── Get transaction history ──────────────────────────────────────────────────
const getTransactions = async (userId, page = 1, limit = 20) => {
  const safeLimit = Math.min(parseInt(limit) || 20, 50);
  const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

  const transactions = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(safeLimit)
    .offset(offset);

  return { transactions, page, limit: safeLimit };
};

module.exports = {
  getWallet,
  addMoney,
  debitWallet,
  refundToWallet,
  getTransactions,
  getOrCreateWallet,
};
