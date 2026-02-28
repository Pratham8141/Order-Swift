/**
 * src/services/restaurant.service.js
 *
 * Fixes applied:
 *  #1  — getRestaurants: removed stale deliveryTime / deliveryFee column
 *        references (columns no longer exist after takeaway migration).
 *        Replaced with preparationTime.
 *  #1  — isActive default: the Zod schema bug (transform returning false when
 *        param absent) is fixed in validations/index.js. The service itself
 *        is fine — if isActive is undefined we add no condition, so all active
 *        AND inactive rows are returned, which is intentional for admin use.
 *        For the public listing the controller always passes isActive=true.
 *  #9  — Added debug logging where useful.
 */
const { db } = require('../db');
const { restaurants, categories, menuItems, menuItemVariants, addOns } = require('../db/schema');
const { eq, and, gte, ilike, sql, inArray } = require('drizzle-orm');
const { AppError } = require('../utils/response');
const logger = require('../utils/logger');

// ─── Public listing ───────────────────────────────────────────────────────────

/**
 * getRestaurants
 *
 * isActive behaviour:
 *   - Public endpoint always passes isActive = true  → only active restaurants shown.
 *   - Admin endpoint may pass isActive = false/undefined → unfiltered.
 *   - If isActive is undefined no condition is added (returns all).
 */
const getRestaurants = async ({ page, limit, search, minRating, isActive, latitude, longitude, radius }) => {
  const offset = (page - 1) * limit;

  const conditions = [];

  // Only add the isActive filter when a value was explicitly provided.
  if (isActive !== undefined) {
    conditions.push(eq(restaurants.isActive, isActive));
  }

  if (search)     conditions.push(ilike(restaurants.name, `%${search}%`));
  if (minRating)  conditions.push(gte(restaurants.rating, minRating.toString()));

  // Location radius filter using Haversine formula (if lat/lng/radius provided)
  let locationFilter = null;
  if (latitude && longitude) {
    const r = parseFloat(radius) || 5; // km
    // 1 degree lat ≈ 111km, use simple bounding box first then haversine
    const latDelta = r / 111.0;
    const lngDelta = r / (111.0 * Math.cos(parseFloat(latitude) * Math.PI / 180));
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    conditions.push(
      sql`${restaurants.latitude} IS NOT NULL AND ${restaurants.longitude} IS NOT NULL AND
        ${restaurants.latitude}::float BETWEEN ${lat - latDelta} AND ${lat + latDelta} AND
        ${restaurants.longitude}::float BETWEEN ${lng - lngDelta} AND ${lng + lngDelta} AND
        (
          6371 * 2 * ASIN(SQRT(
            POWER(SIN((${restaurants.latitude}::float - ${lat}) * PI() / 360), 2) +
            COS(${lat} * PI() / 180) * COS(${restaurants.latitude}::float * PI() / 180) *
            POWER(SIN((${restaurants.longitude}::float - ${lng}) * PI() / 360), 2)
          ))
        ) <= ${r}`
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  logger.debug('getRestaurants query', { isActive, search, minRating, page, limit });

  const [data, [{ count }]] = await Promise.all([
    db.select({
      id:              restaurants.id,
      name:            restaurants.name,
      description:     restaurants.description,
      bannerImage:     restaurants.bannerImage,
      rating:          restaurants.rating,
      totalReviews:    restaurants.totalReviews,
      preparationTime: restaurants.preparationTime,
      minOrder:        restaurants.minOrder,
      isActive:        restaurants.isActive,
      isOpen:          restaurants.isOpen,
      openingTime:     restaurants.openingTime,
      closingTime:     restaurants.closingTime,
      cuisines:        restaurants.cuisines,
      latitude:        restaurants.latitude,
      longitude:       restaurants.longitude,
    })
      .from(restaurants)
      .where(where)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql`COUNT(*)::int` }).from(restaurants).where(where),
  ]);

  logger.debug('getRestaurants result', { count, returned: data.length });

  return {
    restaurants: data,
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  };
};

// ─── Single restaurant ────────────────────────────────────────────────────────

const getRestaurantById = async (id) => {
  const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
  if (!restaurant) throw new AppError('Restaurant not found', 404);
  return restaurant;
};

// ─── Public menu ──────────────────────────────────────────────────────────────

const getMenu = async (restaurantId) => {
  logger.debug('getMenu', { restaurantId }); // #9

  const [restaurant] = await db
    .select({ id: restaurants.id, name: restaurants.name, isActive: restaurants.isActive })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  if (!restaurant) throw new AppError('Restaurant not found', 404);

  const cats = await db.select().from(categories)
    .where(and(eq(categories.restaurantId, restaurantId), eq(categories.isActive, true)));

  const items = await db.select().from(menuItems)
    .where(and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.isAvailable, true)));

  const itemIds = items.map(i => i.id);
  let variants = [];
  let itemAddOns = [];

  if (itemIds.length > 0) {
    [variants, itemAddOns] = await Promise.all([
      db.select().from(menuItemVariants).where(inArray(menuItemVariants.menuItemId, itemIds)),
      db.select().from(addOns).where(inArray(addOns.menuItemId, itemIds)),
    ]);
  }

  const variantMap = variants.reduce((acc, v) => {
    if (!acc[v.menuItemId]) acc[v.menuItemId] = [];
    acc[v.menuItemId].push(v);
    return acc;
  }, {});

  const addOnMap = itemAddOns.reduce((acc, a) => {
    if (!acc[a.menuItemId]) acc[a.menuItemId] = [];
    acc[a.menuItemId].push(a);
    return acc;
  }, {});

  const enrichedItems = items.map(item => ({
    ...item,
    variants:  variantMap[item.id]  || [],
    addOns:    addOnMap[item.id]    || [],
  }));

  const menu = cats.map(cat => ({
    ...cat,
    items: enrichedItems.filter(i => i.categoryId === cat.id),
  }));

  const uncategorized = enrichedItems.filter(i => !i.categoryId);
  if (uncategorized.length) {
    menu.push({ id: null, name: 'Other', items: uncategorized });
  }

  return { restaurant, menu };
};

// ─── Owner menu ───────────────────────────────────────────────────────────────
// #3 — Returns ALL menu items (including unavailable) for the owner to manage.

const getOwnerMenu = async (restaurantId, ownerId) => {
  logger.debug('getOwnerMenu', { restaurantId, ownerId }); // #9

  // Verify ownership
  const [restaurant] = await db.select().from(restaurants)
    .where(and(eq(restaurants.id, restaurantId), eq(restaurants.ownerId, ownerId)))
    .limit(1);

  if (!restaurant) throw new AppError('Restaurant not found or access denied', 403);

  const items = await db.select().from(menuItems)
    .where(eq(menuItems.restaurantId, restaurantId));

  return items;
};

// ─── Admin CRUD ───────────────────────────────────────────────────────────────

const createRestaurant = async (data) => {
  const [restaurant] = await db.insert(restaurants).values(data).returning();
  return restaurant;
};

const updateRestaurant = async (id, data) => {
  const [updated] = await db
    .update(restaurants)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(restaurants.id, id))
    .returning();
  if (!updated) throw new AppError('Restaurant not found', 404);
  return updated;
};

const deleteRestaurant = async (id) => {
  const [deleted] = await db.delete(restaurants).where(eq(restaurants.id, id)).returning({ id: restaurants.id });
  if (!deleted) throw new AppError('Restaurant not found', 404);
};

module.exports = {
  getRestaurants,
  getRestaurantById,
  getMenu,
  getOwnerMenu,
  createRestaurant,
  updateRestaurant,
  deleteRestaurant,
};
