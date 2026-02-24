/**
 * src/routes/restaurantOwner.routes.js
 *
 * All routes protected by JWT + role=restaurant_owner.
 * Restaurant ownership is always verified from req.user.id — never from the body.
 *
 * TAKEAWAY changes:
 *  - deliveryFee / deliveryTime removed from restaurant create/update
 *  - estimatedTime → preparationTime on order PATCH
 *  - Order list response no longer includes deliveryFee / deliveryAddress / taxAmount
 *  - State machine updated to: pending → confirmed → preparing → ready → collected
 */

const router = require('express').Router();
const { protect, authorize }         = require('../middleware/auth');
const { asyncHandler, sendSuccess, AppError } = require('../utils/response');
const { db }                         = require('../db');
const { restaurants, categories, menuItems, orders, orderItems } = require('../db/schema');
const { eq, and, desc }              = require('drizzle-orm');

// ─── Apply auth + role guard to ALL routes in this file ──────────────────────
router.use(protect, authorize('restaurant_owner'));

// ─── Ownership helper ─────────────────────────────────────────────────────────
const getOwnedRestaurant = async (ownerId) => {
  const [restaurant] = await db.select().from(restaurants)
    .where(eq(restaurants.ownerId, ownerId))
    .limit(1);

  if (!restaurant) {
    throw new AppError('You do not have a restaurant yet. Create one first.', 404);
  }
  return restaurant;
};

const assertMenuItemOwnership = async (menuItemId, restaurantId) => {
  const [item] = await db.select().from(menuItems)
    .where(eq(menuItems.id, menuItemId))
    .limit(1);

  if (!item) throw new AppError('Menu item not found', 404);
  if (item.restaurantId !== restaurantId) {
    throw new AppError('Forbidden — this item does not belong to your restaurant', 403);
  }
  return item;
};

// ═══════════════════════════════════════════════════════════════════════════════
// RESTAURANT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/owner/restaurant-info
 * Get the owner's restaurant (used by settings screen).
 */
router.get('/restaurant-info', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);
  return sendSuccess(res, restaurant);
}));

/**
 * POST /api/v1/owner/restaurant
 * Create owner's restaurant (one per owner, enforced here).
 *
 * TAKEAWAY: no deliveryFee / deliveryTime accepted.
 * Body (required: name):
 *   name, description, bannerImage, preparationTime,
 *   minOrder, openingTime, closingTime, address, latitude, longitude, cuisines
 */
router.post('/restaurant', asyncHandler(async (req, res) => {
  const [existing] = await db.select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.ownerId, req.user.id))
    .limit(1);

  if (existing) {
    throw new AppError(
      'You already have a restaurant. Use PUT /owner/restaurant to update it.',
      409
    );
  }

  const {
    name, description, bannerImage,
    preparationTime,
    minOrder,
    openingTime, closingTime,
    address, latitude, longitude,
    cuisines,
  } = req.body;

  if (!name || !name.trim()) throw new AppError('Restaurant name is required', 400);

  const [restaurant] = await db.insert(restaurants).values({
    ownerId:         req.user.id,
    name:            name.trim(),
    description,
    bannerImage,
    preparationTime: preparationTime ?? 20,
    minOrder:        minOrder        ?? 0,
    openingTime:     openingTime     ?? '09:00',
    closingTime:     closingTime     ?? '22:00',
    address,
    latitude,
    longitude,
    cuisines:        cuisines ?? [],
  }).returning();

  return sendSuccess(res, restaurant, 'Restaurant created', 201);
}));

/**
 * PUT /api/v1/owner/restaurant
 * Update the owner's restaurant.
 * ownerId is NEVER accepted from body — always taken from JWT.
 */
router.put('/restaurant', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);

  // Only these fields can be updated by the owner (deliveryFee removed)
  const ALLOWED = [
    'name', 'description', 'bannerImage',
    'preparationTime',
    'minOrder',
    'isActive',
    'openingTime', 'closingTime',
    'address', 'latitude', 'longitude',
    'cuisines',
  ];

  const updateData = {};
  for (const field of ALLOWED) {
    if (req.body[field] !== undefined) updateData[field] = req.body[field];
  }

  if (Object.keys(updateData).length === 0) {
    throw new AppError('No valid fields provided for update', 400);
  }

  const [updated] = await db.update(restaurants)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(restaurants.id, restaurant.id))
    .returning();

  return sendSuccess(res, updated, 'Restaurant updated');
}));

// ═══════════════════════════════════════════════════════════════════════════════
// MENU ITEM MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/menu-item', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);
  const { name, description, basePrice, image, isVeg, categoryId, isAvailable, sortOrder } = req.body;

  if (!name || !name.trim()) throw new AppError('Item name is required', 400);
  if (basePrice === undefined || isNaN(parseFloat(basePrice))) {
    throw new AppError('A valid basePrice is required', 400);
  }

  if (categoryId) {
    const [cat] = await db.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.restaurantId, restaurant.id)))
      .limit(1);
    if (!cat) throw new AppError('Category not found or does not belong to your restaurant', 404);
  }

  const [item] = await db.insert(menuItems).values({
    restaurantId: restaurant.id,
    categoryId:   categoryId || null,
    name:         name.trim(),
    description,
    basePrice:    parseFloat(basePrice).toFixed(2),
    image:        image || null,
    isVeg:        isVeg     !== undefined ? Boolean(isVeg)        : true,
    isAvailable:  isAvailable !== undefined ? Boolean(isAvailable) : true,
    sortOrder:    sortOrder ?? 0,
  }).returning();

  return sendSuccess(res, item, 'Menu item created', 201);
}));

router.put('/menu-item/:id', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);
  await assertMenuItemOwnership(req.params.id, restaurant.id);

  const ALLOWED = ['name', 'description', 'basePrice', 'image', 'isVeg', 'categoryId', 'isAvailable', 'sortOrder'];
  const updateData = {};
  for (const field of ALLOWED) {
    if (req.body[field] !== undefined) updateData[field] = req.body[field];
  }

  if (updateData.basePrice !== undefined) {
    if (isNaN(parseFloat(updateData.basePrice))) throw new AppError('basePrice must be a valid number', 400);
    updateData.basePrice = parseFloat(updateData.basePrice).toFixed(2);
  }
  if (updateData.isVeg      !== undefined) updateData.isVeg      = Boolean(updateData.isVeg);
  if (updateData.isAvailable !== undefined) updateData.isAvailable = Boolean(updateData.isAvailable);

  if (updateData.categoryId) {
    const [cat] = await db.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.id, updateData.categoryId), eq(categories.restaurantId, restaurant.id)))
      .limit(1);
    if (!cat) throw new AppError('Category not found or does not belong to your restaurant', 404);
  }

  if (Object.keys(updateData).length === 0) throw new AppError('No valid fields provided', 400);

  const [updated] = await db.update(menuItems)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(menuItems.id, req.params.id))
    .returning();

  return sendSuccess(res, updated, 'Menu item updated');
}));

router.delete('/menu-item/:id', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);
  await assertMenuItemOwnership(req.params.id, restaurant.id);
  await db.delete(menuItems).where(eq(menuItems.id, req.params.id));
  return sendSuccess(res, {}, 'Menu item deleted');
}));

// ═══════════════════════════════════════════════════════════════════════════════
// ORDER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/owner/orders
 * List orders for the owner's restaurant.
 *
 * FIX #3 — the restaurant lookup (getOwnedRestaurant) correctly resolves the
 * restaurant that belongs to req.user.id, then filters orders by that restaurantId.
 * The bug was that the old code referenced schema columns (taxAmount, deliveryFee,
 * deliveryAddress, estimatedTime) that no longer exist post-takeaway refactor,
 * causing a silent empty result or DB error.
 */
router.get('/orders', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);

  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = (page - 1) * limit;

  const conditions = [eq(orders.restaurantId, restaurant.id)];
  if (req.query.status) conditions.push(eq(orders.status, req.query.status));

  const data = await db.select({
    id:              orders.id,
    userId:          orders.userId,
    status:          orders.status,
    paymentStatus:   orders.paymentStatus,
    subtotal:        orders.subtotal,
    discountAmount:  orders.discountAmount,
    totalAmount:     orders.totalAmount,
    preparationTime: orders.preparationTime,
    pickupName:      orders.pickupName,
    notes:           orders.notes,
    createdAt:       orders.createdAt,
    updatedAt:       orders.updatedAt,
  })
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt))
    .limit(limit)
    .offset(offset);

  return sendSuccess(res, { orders: data, page, limit });
}));

/**
 * GET /api/v1/owner/order/:id
 * Get full order detail (with items).
 * Only accessible if the order belongs to owner's restaurant.
 */
router.get('/order/:id', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);

  const [order] = await db.select().from(orders)
    .where(and(eq(orders.id, req.params.id), eq(orders.restaurantId, restaurant.id)))
    .limit(1);

  if (!order) throw new AppError('Order not found or does not belong to your restaurant', 404);

  const items = await db.select().from(orderItems)
    .where(eq(orderItems.orderId, order.id));

  return sendSuccess(res, { ...order, items });
}));

// ─── Takeaway-only owner state machine ───────────────────────────────────────
// Out-for-delivery and delivered removed. Lifecycle: confirmed → preparing → ready → collected.
const OWNER_TRANSITIONS = {
  pending:   ['confirmed'],
  confirmed: ['preparing'],
  preparing: ['ready'],
  ready:     ['collected'],
};

/**
 * PATCH /api/v1/owner/order/:id/status
 *
 * Body:
 *   status          (required) — next status
 *   preparationTime (optional, integer minutes) — accepted when confirming
 *
 * #7 — parameter renamed from estimatedTime to preparationTime.
 */
router.patch('/order/:id/status', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);

  const { status: newStatus, preparationTime } = req.body;
  if (!newStatus) throw new AppError('status is required', 400);

  // Fetch order and verify it belongs to this restaurant
  const [order] = await db.select().from(orders)
    .where(and(eq(orders.id, req.params.id), eq(orders.restaurantId, restaurant.id)))
    .limit(1);

  if (!order) {
    // Return 403 (not 404) to avoid leaking other restaurants' order IDs
    throw new AppError('Forbidden — order not found or does not belong to your restaurant', 403);
  }

  const allowed = OWNER_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(newStatus)) {
    const allowedStr = allowed.length ? allowed.join(', ') : 'none (terminal state)';
    throw new AppError(
      `Invalid transition: '${order.status}' → '${newStatus}'. Allowed: ${allowedStr}`,
      400
    );
  }

  const updateData = { status: newStatus, updatedAt: new Date() };

  // preparationTime is only meaningful when confirming (pending → confirmed)
  if (preparationTime !== undefined && newStatus === 'confirmed') {
    const mins = parseInt(preparationTime);
    if (isNaN(mins) || mins < 1) {
      throw new AppError('preparationTime must be a positive integer (minutes)', 400);
    }
    updateData.preparationTime = mins;
  }

  const [updated] = await db.update(orders)
    .set(updateData)
    .where(eq(orders.id, order.id))
    .returning();

  return sendSuccess(res, updated, `Order status updated to '${newStatus}'`);
}));

module.exports = router;
