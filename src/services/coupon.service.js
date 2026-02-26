/**
 * src/services/coupon.service.js
 * Validate and apply coupons with per-user usage limits.
 */
const { db } = require('../db');
const { coupons, couponUsage } = require('../db/schema');
const { eq, and, sql } = require('drizzle-orm');
const { AppError } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * validateCoupon(code, userId, subtotal)
 * Returns { coupon, discountAmount } if valid, throws AppError if not.
 */
const validateCoupon = async (code, userId, subtotal) => {
  if (!code?.trim()) throw new AppError('Coupon code is required', 400);

  const [coupon] = await db
    .select()
    .from(coupons)
    .where(eq(coupons.code, code.trim().toUpperCase()))
    .limit(1);

  if (!coupon || !coupon.isActive) {
    throw new AppError('Invalid or expired coupon code', 400);
  }

  // Expiry check
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    throw new AppError('This coupon has expired', 400);
  }

  // Usage limit check
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    throw new AppError('This coupon has reached its usage limit', 400);
  }

  // Minimum order check
  const minOrder = parseFloat(coupon.minOrder || 0);
  if (subtotal < minOrder) {
    throw new AppError(
      `Minimum order of ₹${minOrder.toFixed(2)} required to use this coupon`,
      400
    );
  }

  // Per-user limit check
  const [usage] = await db
    .select({ count: sql`COUNT(*)` })
    .from(couponUsage)
    .where(and(eq(couponUsage.userId, userId), eq(couponUsage.couponId, coupon.id)));

  const timesUsed = parseInt(usage?.count ?? 0);
  if (timesUsed >= coupon.perUserLimit) {
    throw new AppError(`You've already used this coupon ${coupon.perUserLimit} time(s)`, 400);
  }

  // Calculate discount
  let discountAmount = 0;
  if (coupon.type === 'flat') {
    discountAmount = parseFloat(coupon.value);
  } else {
    // percentage
    discountAmount = (subtotal * parseFloat(coupon.value)) / 100;
    if (coupon.maxDiscount) {
      discountAmount = Math.min(discountAmount, parseFloat(coupon.maxDiscount));
    }
  }
  discountAmount = Math.min(discountAmount, subtotal); // can't discount more than subtotal

  logger.debug('Coupon validated', { code, userId, subtotal, discountAmount });
  return {
    coupon: {
      id:    coupon.id,
      code:  coupon.code,
      type:  coupon.type,
      value: parseFloat(coupon.value),
    },
    discountAmount: parseFloat(discountAmount.toFixed(2)),
  };
};

/**
 * recordCouponUsage(couponId, userId, orderId)
 * Called after order is created to record usage.
 */
const recordCouponUsage = async (couponId, userId, orderId) => {
  await db.insert(couponUsage).values({ userId, couponId, orderId });
  await db.update(coupons)
    .set({ usedCount: sql`used_count + 1`, updatedAt: new Date() })
    .where(eq(coupons.id, couponId));
};

/**
 * Admin: create coupon
 */
const createCoupon = async (data) => {
  const { code, type, value, minOrder, maxDiscount, expiresAt, usageLimit, perUserLimit } = data;
  const [coupon] = await db.insert(coupons).values({
    code:         code.trim().toUpperCase(),
    type,
    value:        value.toFixed(2),
    minOrder:     (minOrder ?? 0).toFixed(2),
    maxDiscount:  maxDiscount ? maxDiscount.toFixed(2) : null,
    expiresAt:    expiresAt ? new Date(expiresAt) : null,
    usageLimit:   usageLimit ?? null,
    perUserLimit: perUserLimit ?? 1,
  }).returning();
  return coupon;
};

module.exports = { validateCoupon, recordCouponUsage, createCoupon };
