/**
 * src/services/order.service.js
 *
 * FIXES IN THIS VERSION:
 * ─────────────────────────────────────────────────────────────────────────────
 * FIX 1 — getOrders now returns restaurant name + order items:
 *   Previously returned only order rows with no joins. Frontend showed only
 *   "Order ID". Now performs:
 *     1. Fetch orders (with restaurantId)
 *     2. Batch-fetch restaurant names (no N+1 — single IN query)
 *     3. Batch-fetch order items for all returned orders (single IN query)
 *   Total: 3 queries for any page size vs N+2 before.
 *
 * FIX 2 — reorderFromPastOrder added:
 *   Validates each order item's menu item is still available, adds all valid
 *   items to cart, returns a summary of what was added and what was skipped.
 *
 * ARCHITECTURAL NOTE — Drizzle join vs batch approach:
 *   We deliberately avoid a single complex JOIN for getOrders because:
 *   - Drizzle's select() with joined tables requires column aliasing to avoid
 *     name collisions (e.g. orders.id vs restaurants.id vs order_items.id).
 *   - The batch approach (3 queries) is equivalent performance for page sizes
 *     up to ~50, cleaner to read, and easier to paginate correctly.
 */
const { db, pool }   = require('../db');
const {
  orders, orderItems, restaurants, menuItems, menuItemVariants, addOns,
} = require('../db/schema');
const { eq, and, desc, inArray } = require('drizzle-orm');
const { AppError }   = require('../utils/response');
const cartService    = require('./cart.service');
const walletService  = require('./wallet.service');
const couponService  = require('./coupon.service');
const logger         = require('../utils/logger');

// ─── Takeaway-only state machine ──────────────────────────────────────────────
const STATE_TRANSITIONS = {
  pending:   ['paid',      'cancelled'],
  paid:      ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready'],
  ready:     ['collected'],
  collected: [],
  cancelled: [],
};

// ─── createOrder (ATOMIC TRANSACTION) ────────────────────────────────────────
const createOrder = async (userId, {
  notes, pickupName, idempotencyKey,
  useWallet = false, couponCode,
} = {}) => {
  // Idempotency check
  if (idempotencyKey) {
    const [existing] = await db.select()
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existing) {
      return getOrderById(existing.id, userId);
    }
  }

  const { cart, items, pricing } = await cartService.getCart(userId);
  if (!cart || !items.length) throw new AppError('Your cart is empty', 400);

  const [restaurant] = await db.select().from(restaurants)
    .where(eq(restaurants.id, cart.restaurantId)).limit(1);
  if (!restaurant)          throw new AppError('Restaurant not found', 404);
  if (!restaurant.isActive) throw new AppError('This restaurant is currently not available', 400);
  if (restaurant.isOpen === false) throw new AppError('This restaurant is currently not accepting orders', 400);

  const minOrder = parseFloat(restaurant.minOrder || 0);
  if (pricing.subtotal < minOrder) {
    throw new AppError(
      `Minimum order is ₹${minOrder.toFixed(2)}. Your subtotal is ₹${pricing.subtotal.toFixed(2)}.`,
      400
    );
  }

  let couponData = null;
  let couponDiscountAmount = 0;
  if (couponCode) {
    couponData = await couponService.validateCoupon(couponCode, userId, pricing.subtotal);
    couponDiscountAmount = couponData.discountAmount;
  }

  const totalDiscountAmount = pricing.discountAmount + couponDiscountAmount;
  const finalTotal = Math.max(0, pricing.subtotal - totalDiscountAmount);

  let walletDebitAmount = 0;
  if (useWallet) {
    const wallet = await walletService.getOrCreateWallet(userId);
    walletDebitAmount = Math.max(0, Math.min(parseFloat(wallet.balance), finalTotal));
  }

  const menuItemIds  = items.map(i => i.menuItemId);
  const menuItemList = await db.select().from(menuItems).where(inArray(menuItems.id, menuItemIds));
  const menuItemMap  = Object.fromEntries(menuItemList.map(m => [m.id, m]));

  const orderItemsData = items.map(item => ({
    menuItemId:  item.menuItemId,
    name:        menuItemMap[item.menuItemId]?.name ?? 'Unknown Item',
    variantName: item.variant?.name ?? null,
    addOns:      item.addOns ?? [],
    quantity:    item.quantity,
    unitPrice:   item.unitPrice.toFixed(2),
    totalPrice:  item.totalPrice.toFixed(2),
  }));

  const client = await pool.connect();
  let createdOrderId;

  try {
    await client.query('BEGIN');

    const { rows: [order] } = await client.query(
      `INSERT INTO orders (
         user_id, restaurant_id,
         status, payment_status,
         subtotal, discount_amount, total_amount,
         coupon_code,
         pickup_name, notes,
         preparation_time,
         idempotency_key,
         wallet_amount_used,
         created_at, updated_at
       ) VALUES ($1,$2,'pending','pending',$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
       RETURNING *`,
      [
        userId, cart.restaurantId,
        pricing.subtotal.toFixed(2),
        totalDiscountAmount.toFixed(2),
        finalTotal.toFixed(2),
        couponCode   ?? null,
        pickupName   ?? null,
        notes        ?? null,
        restaurant.preparationTime ?? 20,
        idempotencyKey ?? null,
        walletDebitAmount.toFixed(2),
      ]
    );

    createdOrderId = order.id;

    for (const oi of orderItemsData) {
      await client.query(
        `INSERT INTO order_items
           (order_id,menu_item_id,name,variant_name,add_ons,quantity,unit_price,total_price,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [order.id, oi.menuItemId, oi.name, oi.variantName,
          JSON.stringify(oi.addOns), oi.quantity, oi.unitPrice, oi.totalPrice]
      );
    }

    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cart.id]);
    await client.query('DELETE FROM carts WHERE id = $1', [cart.id]);

    await client.query('COMMIT');
    logger.info('Order created', { orderId: order.id, userId, total: finalTotal });

    if (walletDebitAmount > 0) {
      walletService.debitWallet(userId, walletDebitAmount, order.id, 'Order payment')
        .catch(err => logger.error('Wallet debit failed post-commit', { error: err.message, orderId: order.id }));
    }
    if (couponData) {
      couponService.recordCouponUsage(couponData.coupon.id, userId, order.id)
        .catch(err => logger.error('Coupon usage record failed', { error: err.message }));
    }

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Order creation rolled back', { error: err.message, userId });
    throw err;
  } finally {
    client.release();
  }

  return getOrderById(createdOrderId, userId);
};

// ─── Get user's orders WITH restaurant name + items (no N+1) ─────────────────
/**
 * Returns orders enriched with:
 *   - restaurantName: string
 *   - items:          OrderItem[]
 *
 * Query strategy (3 queries total regardless of page size):
 *   Q1: SELECT orders WHERE user_id = ? LIMIT N
 *   Q2: SELECT id,name FROM restaurants WHERE id IN (unique restaurant IDs from Q1)
 *   Q3: SELECT * FROM order_items WHERE order_id IN (all order IDs from Q1)
 *
 * Then assemble in JavaScript — zero N+1.
 */
const getOrders = async (userId, page = 1, limit = 10) => {
  const safeLimit  = Math.min(parseInt(limit)  || 10, 50);
  const safeOffset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

  // Q1: Fetch order rows
  const orderRows = await db.select({
    id:              orders.id,
    status:          orders.status,
    paymentStatus:   orders.paymentStatus,
    subtotal:        orders.subtotal,
    discountAmount:  orders.discountAmount,
    totalAmount:     orders.totalAmount,
    walletAmountUsed: orders.walletAmountUsed,
    couponCode:      orders.couponCode,
    preparationTime: orders.preparationTime,
    restaurantId:    orders.restaurantId,
    pickupName:      orders.pickupName,
    notes:           orders.notes,
    createdAt:       orders.createdAt,
    updatedAt:       orders.updatedAt,
  })
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(safeLimit)
    .offset(safeOffset);

  if (orderRows.length === 0) return [];

  // Q2: Batch-fetch restaurant names (single IN query, no N+1)
  const restaurantIds = [...new Set(orderRows.map(o => o.restaurantId).filter(Boolean))];
  const restaurantRows = restaurantIds.length
    ? await db.select({ id: restaurants.id, name: restaurants.name })
        .from(restaurants)
        .where(inArray(restaurants.id, restaurantIds))
    : [];
  const restaurantMap = Object.fromEntries(restaurantRows.map(r => [r.id, r.name]));

  // Q3: Batch-fetch all order items for these orders (single IN query, no N+1)
  const orderIds = orderRows.map(o => o.id);
  const itemRows = await db.select().from(orderItems)
    .where(inArray(orderItems.orderId, orderIds));

  // Group items by orderId
  const itemsByOrderId = itemRows.reduce((acc, item) => {
    if (!acc[item.orderId]) acc[item.orderId] = [];
    acc[item.orderId].push(item);
    return acc;
  }, {});

  // Assemble enriched response
  return orderRows.map(order => ({
    ...order,
    restaurantName: restaurantMap[order.restaurantId] ?? 'Unknown Restaurant',
    items: itemsByOrderId[order.id] ?? [],
  }));
};

// ─── Get single order (with items) ───────────────────────────────────────────
const getOrderById = async (orderId, userId = null) => {
  const conditions = [eq(orders.id, orderId)];
  if (userId) {
    logger.debug('getOrderById', { orderId, filterUserId: userId });
    conditions.push(eq(orders.userId, userId));
  }

  const [order] = await db.select().from(orders)
    .where(and(...conditions)).limit(1);

  if (!order) {
    logger.warn('getOrderById: not found', { orderId, userId: userId ?? 'admin-bypass' });
    throw new AppError('Order not found', 404);
  }

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  // Fetch restaurant name for single-order view as well
  const [restaurant] = await db.select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants).where(eq(restaurants.id, order.restaurantId)).limit(1);

  return {
    ...order,
    restaurantName: restaurant?.name ?? 'Unknown Restaurant',
    items,
  };
};

// ─── Reorder from a past order ────────────────────────────────────────────────
/**
 * reorderFromPastOrder(orderId, userId)
 *
 * Validates each past order item, adds available ones to cart, and returns a
 * summary of what was added and what was skipped (unavailable/deleted items).
 *
 * Idempotency: calls addToCart which deduplicates by (menuItemId, variantId, addOns).
 *
 * @returns {{ added: {name, qty}[], skipped: {name, reason}[] }}
 */
const reorderFromPastOrder = async (orderId, userId) => {
  // 1. Fetch past order + items
  const [order] = await db.select().from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId))).limit(1);

  if (!order) throw new AppError('Order not found', 404);

  const pastItems = await db.select().from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  if (!pastItems.length) throw new AppError('This order has no items', 400);

  // 2. Check restaurant is still active
  const [restaurant] = await db.select().from(restaurants)
    .where(eq(restaurants.id, order.restaurantId)).limit(1);

  if (!restaurant) throw new AppError('Restaurant no longer exists', 400);
  if (!restaurant.isActive) throw new AppError('This restaurant is currently closed', 400);

  // 3. Batch-validate menu items still exist and are available
  const menuItemIds = pastItems.map(i => i.menuItemId);
  const currentMenuItems = await db.select().from(menuItems)
    .where(inArray(menuItems.id, menuItemIds));
  const availabilityMap = Object.fromEntries(
    currentMenuItems.map(m => [m.id, { available: m.isAvailable, name: m.name }])
  );

  const added   = [];
  const skipped = [];

  // 4. Add each available item to cart
  for (const pastItem of pastItems) {
    const current = availabilityMap[pastItem.menuItemId];

    if (!current) {
      skipped.push({ name: pastItem.name, reason: 'Item no longer available' });
      continue;
    }
    if (!current.available) {
      skipped.push({ name: pastItem.name, reason: 'Currently unavailable' });
      continue;
    }

    try {
      // Resolve variantId by name — orderItems stores variantName snapshot, not variantId.
      // Look up the current variant UUID from menu_item_variants table.
      let resolvedVariantId = null;
      if (pastItem.variantName) {
        const [variant] = await db.select({ id: menuItemVariants.id })
          .from(menuItemVariants)
          .where(
            and(
              eq(menuItemVariants.menuItemId, pastItem.menuItemId),
              eq(menuItemVariants.name, pastItem.variantName)
            )
          ).limit(1);
        resolvedVariantId = variant?.id ?? null;
      }

      // Resolve addOnIds — addOns are stored as [{addOnId, name, price}] snapshots.
      // Re-validate that the add-on still exists and belongs to this item.
      const storedAddOns = Array.isArray(pastItem.addOns) ? pastItem.addOns : [];
      let resolvedAddOnIds = [];
      if (storedAddOns.length > 0) {
        const candidateIds = storedAddOns.map(a => a.addOnId).filter(Boolean);
        if (candidateIds.length > 0) {
          const validAddOns = await db.select({ id: addOns.id })
            .from(addOns)
            .where(and(inArray(addOns.id, candidateIds), eq(addOns.isAvailable, true)));
          resolvedAddOnIds = validAddOns.map(a => a.id);
        }
      }

      // addToCart is server-authoritative — it re-validates price from DB.
      // quantity: pastItem.quantity restores the original quantity (FIX: was always 1).
      await cartService.addToCart(userId, {
        menuItemId: pastItem.menuItemId,
        variantId:  resolvedVariantId,
        addOnIds:   resolvedAddOnIds,
        quantity:   pastItem.quantity,  // ← CRITICAL: restore original quantity
      });
      added.push({ name: pastItem.name, quantity: pastItem.quantity });
    } catch (err) {
      logger.warn('reorder: failed to add item', { menuItemId: pastItem.menuItemId, err: err.message });
      // Cross-restaurant guard or availability check failed — skip gracefully
      if (err.message?.includes('different restaurant')) {
        // Stop processing — cart has items from another restaurant
        throw new AppError(
          'Your cart has items from a different restaurant. Clear your cart first, then reorder.',
          400
        );
      }
      skipped.push({ name: pastItem.name, reason: err.message ?? 'Could not add to cart' });
    }
  }

  logger.info('Reorder complete', { orderId, userId, added: added.length, skipped: skipped.length });

  return {
    added,
    skipped,
    restaurantName: restaurant.name,
    message: added.length
      ? `Added ${added.length} item${added.length > 1 ? 's' : ''} to your cart${skipped.length ? ` (${skipped.length} skipped)` : ''}.`
      : 'No items could be added — all items are currently unavailable.',
  };
};

// ─── Cancel order (user-initiated) with wallet refund ────────────────────────
const cancelOrder = async (orderId, userId) => {
  const [order] = await db.select().from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId))).limit(1);

  if (!order) throw new AppError('Order not found', 404);

  // FIX: Only pending and paid orders can be cancelled by the user.
  // Once confirmed/preparing/ready, the restaurant is working on it.
  const cancellable = ['pending', 'paid'];
  if (!cancellable.includes(order.status)) {
    throw new AppError(
      `Cannot cancel — order is '${order.status}'. ` +
      `Only pending or paid orders can be cancelled. Once confirmed by the restaurant, cancellation is not allowed.`,
      400
    );
  }

  const client = await pool.connect();
  let updated;
  try {
    await client.query('BEGIN');

    const { rows: [cancelledOrder] } = await client.query(
      `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [orderId]
    );
    updated = cancelledOrder;

    // FIX: Refund wallet amount if it was used for this order
    const walletUsed = parseFloat(order.walletAmountUsed || '0');
    if (walletUsed > 0) {
      // Ensure wallet row exists
      await client.query(
        `INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
      // Credit wallet
      const { rows: [wallet] } = await client.query(
        `UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2 RETURNING *`,
        [walletUsed.toFixed(2), userId]
      );
      // Record transaction
      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, amount, description, reference_id, balance_after)
         VALUES ($1, 'credit', $2, 'Order Cancel Refund', $3, $4)`,
        [userId, walletUsed.toFixed(2), orderId, wallet.balance]
      );
      logger.info('Wallet refunded on order cancel', { orderId, userId, amount: walletUsed });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Cancel order rollback', { error: err.message, orderId, userId });
    throw err;
  } finally {
    client.release();
  }

  logger.info('Order cancelled by user', { orderId, userId });
  return updated;
};

// ─── Update order status (admin path) ────────────────────────────────────────
const updateOrderStatus = async (orderId, newStatus, preparationTime) => {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new AppError('Order not found', 404);

  const allowed = STATE_TRANSITIONS[order.status];
  if (!allowed) throw new AppError(`Unknown current status: ${order.status}`, 500);

  if (!allowed.includes(newStatus)) {
    throw new AppError(
      `Invalid transition: '${order.status}' → '${newStatus}'. ` +
      `Allowed: ${allowed.join(', ') || 'none (terminal state)'}`,
      400
    );
  }

  const updateData = { status: newStatus, updatedAt: new Date() };
  if (preparationTime != null) updateData.preparationTime = preparationTime;

  const [updated] = await db.update(orders).set(updateData).where(eq(orders.id, orderId)).returning();
  logger.info('Order status updated (admin)', { orderId, from: order.status, to: newStatus });
  return updated;
};

// ─── Admin: list all orders ───────────────────────────────────────────────────
const getAllOrders = async ({ page = 1, limit = 20, status } = {}) => {
  const safeLimit  = Math.min(parseInt(limit) || 20, 100);
  const safeOffset = (Math.max(1, parseInt(page)) - 1) * safeLimit;
  const where = status ? eq(orders.status, status) : undefined;

  return db.select().from(orders).where(where)
    .orderBy(desc(orders.createdAt)).limit(safeLimit).offset(safeOffset);
};

module.exports = {
  createOrder,
  getOrders,
  getOrderById,
  reorderFromPastOrder,
  cancelOrder,
  updateOrderStatus,
  getAllOrders,
};
