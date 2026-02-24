/**
 * src/services/order.service.js
 *
 * TAKEAWAY-ONLY — no address validation, no delivery fee, no tax.
 * Pricing: totalAmount = subtotal - discountAmount
 * preparationTime replaces estimatedTime throughout.
 *
 * All DB writes in createOrder are wrapped in a single Postgres transaction.
 */
const { db, pool }   = require('../db');
const {
  orders, orderItems, restaurants, menuItems,
} = require('../db/schema');
const { eq, and, desc, inArray } = require('drizzle-orm');
const { AppError }   = require('../utils/response');
const cartService    = require('./cart.service');
const logger         = require('../utils/logger');

// ─── Takeaway-only state machine ──────────────────────────────────────────────
// Removed: out_for_delivery, delivered — replaced with ready + collected
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
/**
 * Creates a takeaway order.
 *
 * Removed: addressId requirement, address validation, deliveryFee, taxAmount.
 * Added:   pickupName (optional), couponCode (reserved for future use).
 *
 * @param {string} userId
 * @param {{ notes?: string, pickupName?: string }} body
 */
const createOrder = async (userId, { notes, pickupName } = {}) => {
  // 1. Fetch cart — server calculates all prices, never trusts frontend
  const { cart, items, pricing } = await cartService.getCart(userId);
  if (!cart || !items.length) throw new AppError('Your cart is empty', 400);

  // 2. Validate restaurant is active
  const [restaurant] = await db.select().from(restaurants)
    .where(eq(restaurants.id, cart.restaurantId))
    .limit(1);
  if (!restaurant)        throw new AppError('Restaurant not found', 404);
  if (!restaurant.isActive) throw new AppError('This restaurant is currently closed', 400);

  // 3. Minimum order check
  const minOrder = parseFloat(restaurant.minOrder || 0);
  if (pricing.subtotal < minOrder) {
    throw new AppError(
      `Minimum order is ₹${minOrder.toFixed(2)}. Your subtotal is ₹${pricing.subtotal.toFixed(2)}.`,
      400
    );
  }

  // 4. Build order-item snapshots from DB (price at time of order, immutable)
  const menuItemIds  = items.map(i => i.menuItemId);
  const menuItemList = await db.select().from(menuItems)
    .where(inArray(menuItems.id, menuItemIds));
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

  // 5. Atomic transaction: order INSERT + items INSERT + cart DELETE
  const client = await pool.connect();
  let createdOrderId;

  try {
    await client.query('BEGIN');

    const { rows: [order] } = await client.query(
      `INSERT INTO orders (
         user_id, restaurant_id,
         status, payment_status,
         subtotal, discount_amount, total_amount,
         pickup_name, notes,
         preparation_time,
         created_at, updated_at
       ) VALUES (
         $1, $2,
         'pending', 'pending',
         $3, $4, $5,
         $6, $7,
         $8,
         NOW(), NOW()
       ) RETURNING *`,
      [
        userId,
        cart.restaurantId,
        pricing.subtotal.toFixed(2),
        pricing.discountAmount.toFixed(2),
        pricing.totalAmount.toFixed(2),
        pickupName  ?? null,
        notes       ?? null,
        restaurant.preparationTime ?? 20,
      ]
    );

    createdOrderId = order.id;

    for (const oi of orderItemsData) {
      await client.query(
        `INSERT INTO order_items (
           order_id, menu_item_id, name, variant_name, add_ons,
           quantity, unit_price, total_price, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [
          order.id,
          oi.menuItemId,
          oi.name,
          oi.variantName,
          JSON.stringify(oi.addOns),
          oi.quantity,
          oi.unitPrice,
          oi.totalPrice,
        ]
      );
    }

    // Clear cart within the same transaction — atomically
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cart.id]);
    await client.query('DELETE FROM carts      WHERE id      = $1', [cart.id]);

    await client.query('COMMIT');
    logger.info('Order created', {
      orderId: order.id,
      userId,
      total: pricing.totalAmount,
      restaurantId: cart.restaurantId,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Order creation rolled back', { error: err.message, userId });
    throw err;
  } finally {
    client.release();
  }

  return getOrderById(createdOrderId, userId);
};

// ─── Get user's own orders ────────────────────────────────────────────────────
const getOrders = async (userId, page = 1, limit = 10) => {
  const safeLimit  = Math.min(parseInt(limit)  || 10, 50);
  const safeOffset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

  logger.debug('getOrders', { userId, page, limit: safeLimit });

  return db.select({
    id:              orders.id,
    status:          orders.status,
    paymentStatus:   orders.paymentStatus,
    subtotal:        orders.subtotal,
    discountAmount:  orders.discountAmount,
    totalAmount:     orders.totalAmount,
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
};

// ─── Get single order (with items) ───────────────────────────────────────────
const getOrderById = async (orderId, userId = null) => {
  const conditions = [eq(orders.id, orderId)];

  // #4 — always filter by userId when provided; log a clear debug line so
  // "order not found after re-login" is immediately diagnosable in server logs.
  if (userId) {
    logger.debug('getOrderById', { orderId, filterUserId: userId });
    conditions.push(eq(orders.userId, userId));
  }

  const [order] = await db.select().from(orders)
    .where(and(...conditions))
    .limit(1);

  if (!order) {
    // #4 — surface userId in the error log so operator can cross-check
    logger.warn('getOrderById: not found', { orderId, userId: userId ?? 'admin-bypass' });
    throw new AppError('Order not found', 404);
  }

  const items = await db.select().from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  return { ...order, items };
};

// ─── Cancel order (user-initiated) ───────────────────────────────────────────
const cancelOrder = async (orderId, userId) => {
  const [order] = await db.select().from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);

  if (!order) throw new AppError('Order not found', 404);

  const cancellable = ['pending', 'paid', 'confirmed'];
  if (!cancellable.includes(order.status)) {
    throw new AppError(
      `Cannot cancel — order is already '${order.status}'. ` +
      `Only pending, paid, or confirmed orders can be cancelled.`,
      400
    );
  }

  const [updated] = await db.update(orders)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(orders.id, orderId))
    .returning();

  logger.info('Order cancelled by user', { orderId, userId });
  return updated;
};

// ─── Update order status (admin path) ────────────────────────────────────────
const updateOrderStatus = async (orderId, newStatus, preparationTime) => {
  const [order] = await db.select().from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

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

  const [updated] = await db.update(orders)
    .set(updateData)
    .where(eq(orders.id, orderId))
    .returning();

  logger.info('Order status updated (admin)', {
    orderId,
    from: order.status,
    to: newStatus,
  });
  return updated;
};

// ─── Admin: list all orders ───────────────────────────────────────────────────
const getAllOrders = async ({ page = 1, limit = 20, status } = {}) => {
  const safeLimit  = Math.min(parseInt(limit) || 20, 100);
  const safeOffset = (Math.max(1, parseInt(page)) - 1) * safeLimit;
  const where = status ? eq(orders.status, status) : undefined;

  return db.select().from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(safeLimit)
    .offset(safeOffset);
};

module.exports = {
  createOrder,
  getOrders,
  getOrderById,
  cancelOrder,
  updateOrderStatus,
  getAllOrders,
};
