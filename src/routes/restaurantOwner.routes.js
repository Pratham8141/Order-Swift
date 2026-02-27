/**
 * src/routes/restaurantOwner.routes.js
 *
 * All routes protected by JWT + role=restaurant_owner.
 *
 * Issue #2: GET /owner/restaurant added as primary endpoint.
 *           (was only /restaurant-info; both now work)
 * Issue #3: GET /owner/menu returns all menu items for owned restaurant.
 * Issue #7: Frontend calls GET /owner/restaurant first.
 *           If restaurant exists → update mode
 *           If 404 → create mode
 * Issue #9: Debug logging added to ownerId, restaurantId, userId queries.
 */
const router = require('express').Router();
const { protect, authorize }              = require('../middleware/auth');
const { asyncHandler, sendSuccess, AppError } = require('../utils/response');
const { db }                              = require('../db');
const {
  restaurants, categories, menuItems, orders, orderItems,
} = require('../db/schema');
const { eq, and, desc } = require('drizzle-orm');
const logger = require('../utils/logger');
const { notifyOrderStatusChange } = require('../utils/notifications');

// Apply auth + role guard to ALL routes in this file
router.use(protect, authorize('restaurant_owner'));

// ─── Ownership helper ─────────────────────────────────────────────────────────

/**
 * getOwnedRestaurant(ownerId)
 *
 * Issue #2 + #9: Logs ownerId before query so we can verify it matches user.id.
 * Throws 404 if no restaurant found — this is how frontend detects "create" mode.
 */
const getOwnedRestaurant = async (ownerId) => {
  logger.debug('getOwnedRestaurant — querying by ownerId', { ownerId }); // #9

  const [restaurant] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.ownerId, ownerId))
    .limit(1);

  logger.debug('getOwnedRestaurant — result', {
    found: !!restaurant,
    restaurantId: restaurant?.id ?? null,
  }); // #9

  if (!restaurant) {
    throw new AppError('You do not have a restaurant yet. Create one first.', 404);
  }
  return restaurant;
};

const assertMenuItemOwnership = async (menuItemId, restaurantId) => {
  const [item] = await db
    .select()
    .from(menuItems)
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
 * GET /api/v1/owner/restaurant
 *
 * Issue #2 + #7: Primary endpoint for fetching the owner's own restaurant.
 * Frontend calls this first to decide create vs update mode.
 * Returns 404 (not 200 with null) when no restaurant exists — React Query
 * catches the 404 and the frontend renders the "create" form.
 */
router.get('/restaurant', asyncHandler(async (req, res) => {
  logger.debug('GET /owner/restaurant', { userId: req.user.id }); // #9
  const restaurant = await getOwnedRestaurant(req.user.id);
  return sendSuccess(res, restaurant);
}));

/**
 * GET /api/v1/owner/restaurant-info
 * Alias kept for backward compatibility with settings.tsx.
 */
router.get('/restaurant-info', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);
  return sendSuccess(res, restaurant);
}));

/**
 * POST /api/v1/owner/restaurant
 * Create restaurant — one per owner.
 */
router.post('/restaurant', asyncHandler(async (req, res) => {
  const [existing] = await db
    .select({ id: restaurants.id })
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

  logger.info('Restaurant created', { restaurantId: restaurant.id, ownerId: req.user.id }); // #9
  return sendSuccess(res, restaurant, 'Restaurant created', 201);
}));

/**
 * PUT /api/v1/owner/restaurant
 * Update restaurant.
 */
router.put('/restaurant', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);

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

  const [updated] = await db
    .update(restaurants)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(restaurants.id, restaurant.id))
    .returning();

  return sendSuccess(res, updated, 'Restaurant updated');
}));

/**
 * PATCH /api/v1/owner/restaurant/toggle-active
 * Quickly toggle isActive without sending full payload.
 */
router.patch('/restaurant/toggle-active', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);
  const [updated] = await db
    .update(restaurants)
    .set({ isActive: !restaurant.isActive, updatedAt: new Date() })
    .where(eq(restaurants.id, restaurant.id))
    .returning();
  return sendSuccess(res, updated, `Restaurant is now ${updated.isActive ? 'active' : 'inactive'}`);
}));

// ═══════════════════════════════════════════════════════════════════════════════
// MENU MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/owner/menu
 *
 * Issue #3: Returns ALL menu items for the owner's restaurant (including
 * unavailable ones), so the owner can manage the full catalogue.
 *
 * This is different from the public GET /restaurants/:id/menu which only
 * returns isAvailable=true items.
 */
router.get('/menu', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);

  logger.debug('GET /owner/menu', { restaurantId: restaurant.id, ownerId: req.user.id }); // #9

  const items = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.restaurantId, restaurant.id));

  return sendSuccess(res, { restaurantId: restaurant.id, items });
}));

/**
 * GET /api/v1/owner/menu-item/:id
 * Fetch single menu item for edit form pre-fill.
 */
router.get('/menu-item/:id', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);
  const item = await assertMenuItemOwnership(req.params.id, restaurant.id);
  return sendSuccess(res, item);
}));

router.post('/menu-item', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);
  const {
    name, description, basePrice, image, isVeg, categoryId, isAvailable, sortOrder,
  } = req.body;

  if (!name || !name.trim()) throw new AppError('Item name is required', 400);
  if (basePrice === undefined || isNaN(parseFloat(basePrice))) {
    throw new AppError('A valid basePrice is required', 400);
  }

  if (categoryId) {
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
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
    isVeg:        isVeg      !== undefined ? Boolean(isVeg)        : true,
    isAvailable:  isAvailable !== undefined ? Boolean(isAvailable) : true,
    sortOrder:    sortOrder ?? 0,
  }).returning();

  return sendSuccess(res, item, 'Menu item created', 201);
}));

router.put('/menu-item/:id', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);
  await assertMenuItemOwnership(req.params.id, restaurant.id);

  const ALLOWED = [
    'name', 'description', 'basePrice', 'image',
    'isVeg', 'categoryId', 'isAvailable', 'sortOrder',
  ];
  const updateData = {};
  for (const field of ALLOWED) {
    if (req.body[field] !== undefined) updateData[field] = req.body[field];
  }

  if (updateData.basePrice !== undefined) {
    if (isNaN(parseFloat(updateData.basePrice))) {
      throw new AppError('basePrice must be a valid number', 400);
    }
    updateData.basePrice = parseFloat(updateData.basePrice).toFixed(2);
  }
  if (updateData.isVeg      !== undefined) updateData.isVeg      = Boolean(updateData.isVeg);
  if (updateData.isAvailable !== undefined) updateData.isAvailable = Boolean(updateData.isAvailable);

  if (updateData.categoryId) {
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, updateData.categoryId), eq(categories.restaurantId, restaurant.id)))
      .limit(1);
    if (!cat) throw new AppError('Category not found or does not belong to your restaurant', 404);
  }

  if (Object.keys(updateData).length === 0) throw new AppError('No valid fields provided', 400);

  const [updated] = await db
    .update(menuItems)
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
 *
 * Issue #3 + #9: Correctly joins through restaurant to filter orders.
 * Only shows orders for the owner's own restaurant.
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

  // Batch-fetch order items for all returned orders (single IN query)
  let itemsMap = {};
  if (data.length > 0) {
    const orderIds = data.map(o => o.id);
    const allItems = await db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds));
    for (const item of allItems) {
      if (!itemsMap[item.orderId]) itemsMap[item.orderId] = [];
      itemsMap[item.orderId].push(item);
    }
  }

  const ordersWithItems = data.map(o => ({ ...o, items: itemsMap[o.id] ?? [] }));
  return sendSuccess(res, { orders: ordersWithItems, page, limit });
}));

/**
 * GET /api/v1/owner/order/:id
 */
router.get('/order/:id', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, req.params.id), eq(orders.restaurantId, restaurant.id)))
    .limit(1);

  if (!order) throw new AppError('Order not found or does not belong to your restaurant', 404);

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));

  return sendSuccess(res, { ...order, items });
}));

// ─── Takeaway-only owner state machine ───────────────────────────────────────
const OWNER_TRANSITIONS = {
  pending:   ['confirmed'],
  confirmed: ['preparing'],
  preparing: ['ready'],
  ready:     ['collected'],
};

/**
 * PATCH /api/v1/owner/order/:id/status
 */
router.patch('/order/:id/status', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id);

  const { status: newStatus, preparationTime } = req.body;
  if (!newStatus) throw new AppError('status is required', 400);

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, req.params.id), eq(orders.restaurantId, restaurant.id)))
    .limit(1);

  if (!order) {
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

  if (preparationTime !== undefined && newStatus === 'confirmed') {
    const mins = parseInt(preparationTime);
    if (isNaN(mins) || mins < 1) {
      throw new AppError('preparationTime must be a positive integer (minutes)', 400);
    }
    updateData.preparationTime = mins;
  }

  const [updated] = await db
    .update(orders)
    .set(updateData)
    .where(eq(orders.id, order.id))
    .returning();

  // Fire notification async (non-blocking)
  notifyOrderStatusChange(updated).catch(err => logger.error('Notification failed', { error: err.message }));
  return sendSuccess(res, updated, `Order status updated to '${newStatus}'`);
}));

// ═══════════════════════════════════════════════════════════════════════════════
// TERMS & CONDITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/owner/terms-status
 * Returns whether the current owner has accepted the platform T&C.
 */
router.get('/terms-status', asyncHandler(async (req, res) => {
  const restaurant = await getOwnedRestaurant(req.user.id).catch(() => null);
  return sendSuccess(res, {
    accepted:   !!restaurant?.termsAcceptedAt,
    acceptedAt: restaurant?.termsAcceptedAt ?? null,
  });
}));

/**
 * POST /api/v1/owner/terms-accept
 * Records T&C acceptance for the owner's restaurant.
 * Body: { accepted: true } — must be explicitly true.
 */
router.post('/terms-accept', asyncHandler(async (req, res) => {
  if (req.body.accepted !== true) {
    throw new AppError('You must explicitly accept the Terms & Conditions (accepted: true)', 400);
  }

  const restaurant = await getOwnedRestaurant(req.user.id);

  if (restaurant.termsAcceptedAt) {
    // Already accepted — idempotent, no error
    return sendSuccess(res, {
      accepted:   true,
      acceptedAt: restaurant.termsAcceptedAt,
    }, 'Terms already accepted');
  }

  const [updated] = await db
    .update(restaurants)
    .set({ termsAcceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(restaurants.id, restaurant.id))
    .returning();

  logger.info('Terms accepted', { ownerId: req.user.id, restaurantId: restaurant.id });

  return sendSuccess(res, {
    accepted:   true,
    acceptedAt: updated.termsAcceptedAt,
  }, 'Terms & Conditions accepted');
}));


module.exports = router;
