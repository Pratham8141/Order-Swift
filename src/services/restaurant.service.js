const { db } = require('../db');
const { restaurants, categories, menuItems, menuItemVariants, addOns } = require('../db/schema');
const { eq, and, gte, lte, ilike, sql } = require('drizzle-orm');
const { AppError } = require('../utils/response');

const getRestaurants = async ({ page, limit, search, minRating, maxDelivery, isActive }) => {
  const offset = (page - 1) * limit;

  const conditions = [];
  if (isActive !== undefined) conditions.push(eq(restaurants.isActive, isActive));
  if (search) conditions.push(ilike(restaurants.name, `%${search}%`));
  if (minRating) conditions.push(gte(restaurants.rating, minRating.toString()));
  if (maxDelivery) conditions.push(lte(restaurants.deliveryTime, maxDelivery));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, [{ count }]] = await Promise.all([
    db.select({
      id: restaurants.id,
      name: restaurants.name,
      description: restaurants.description,
      bannerImage: restaurants.bannerImage,
      rating: restaurants.rating,
      totalReviews: restaurants.totalReviews,
      deliveryTime: restaurants.deliveryTime,
      deliveryFee: restaurants.deliveryFee,
      minOrder: restaurants.minOrder,
      isActive: restaurants.isActive,
      openingTime: restaurants.openingTime,
      closingTime: restaurants.closingTime,
      cuisines: restaurants.cuisines,
    })
      .from(restaurants)
      .where(where)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql`COUNT(*)::int` }).from(restaurants).where(where),
  ]);

  return {
    restaurants: data,
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  };
};

const getRestaurantById = async (id) => {
  const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
  if (!restaurant) throw new AppError('Restaurant not found', 404);
  return restaurant;
};

const getMenu = async (restaurantId) => {
  const [restaurant] = await db
    .select({ id: restaurants.id, name: restaurants.name, isActive: restaurants.isActive })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  if (!restaurant) throw new AppError('Restaurant not found', 404);

  // Get all categories with their items
  const cats = await db.select().from(categories)
    .where(and(eq(categories.restaurantId, restaurantId), eq(categories.isActive, true)));

  const items = await db.select().from(menuItems)
    .where(and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.isAvailable, true)));

  // Attach variants and add-ons
  const itemIds = items.map(i => i.id);
  let variants = [];
  let itemAddOns = [];

  if (itemIds.length > 0) {
    [variants, itemAddOns] = await Promise.all([
      db.select().from(menuItemVariants).where(sql`${menuItemVariants.menuItemId} = ANY(${sql.raw(`ARRAY['${itemIds.join("','")}']::uuid[]`)})`),
      db.select().from(addOns).where(sql`${addOns.menuItemId} = ANY(${sql.raw(`ARRAY['${itemIds.join("','")}']::uuid[]`)})`),
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
    variants: variantMap[item.id] || [],
    addOns: addOnMap[item.id] || [],
  }));

  const menu = cats.map(cat => ({
    ...cat,
    items: enrichedItems.filter(i => i.categoryId === cat.id),
  }));

  // Items without a category
  const uncategorized = enrichedItems.filter(i => !i.categoryId);
  if (uncategorized.length) {
    menu.push({ id: null, name: 'Other', items: uncategorized });
  }

  return { restaurant, menu };
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

module.exports = { getRestaurants, getRestaurantById, getMenu, createRestaurant, updateRestaurant, deleteRestaurant };
