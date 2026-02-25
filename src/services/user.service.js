/**
 * src/services/user.service.js
 * Full user service: profile, password, push token, addresses,
 * favorites, notifications.
 */
const { db } = require('../db');
const { users, addresses, favorites, notifications, restaurants } = require('../db/schema');
const { eq, and, desc } = require('drizzle-orm');
const { AppError } = require('../utils/response');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

// ─── Profile ──────────────────────────────────────────────────────────────────

const getProfile = async (userId) => {
  logger.debug('getProfile', { userId });
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email,
              phone: users.phone, avatar: users.avatar, role: users.role, createdAt: users.createdAt })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError('User not found', 404);
  return user;
};

const updateProfile = async (userId, data) => {
  const ALLOWED = ['name', 'email', 'avatar'];
  const update = {};
  for (const k of ALLOWED) if (data[k] !== undefined) update[k] = data[k];
  const [updated] = await db.update(users)
    .set({ ...update, updatedAt: new Date() }).where(eq(users.id, userId))
    .returning({ id: users.id, name: users.name, email: users.email,
                 phone: users.phone, avatar: users.avatar, role: users.role, createdAt: users.createdAt });
  if (!updated) throw new AppError('User not found', 404);
  return updated;
};

const changePassword = async (userId, currentPassword, newPassword) => {
  const [user] = await db.select({ id: users.id, passwordHash: users.passwordHash })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError('User not found', 404);
  if (user.passwordHash) {
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError('Current password is incorrect', 400);
  }
  const hash = await bcrypt.hash(newPassword, 12);
  await db.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, userId));
};

const savePushToken = async (userId, token) => {
  await db.update(users).set({ expoPushToken: token, updatedAt: new Date() }).where(eq(users.id, userId));
};

// ─── Addresses ────────────────────────────────────────────────────────────────

const getAddresses = async (userId) =>
  db.select().from(addresses).where(eq(addresses.userId, userId)).orderBy(desc(addresses.isDefault));

const addAddress = async (userId, data) => {
  if (data.isDefault) {
    await db.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
  }
  const [existing] = await db.select({ id: addresses.id }).from(addresses)
    .where(eq(addresses.userId, userId)).limit(1);
  const isDefault = !existing ? true : (data.isDefault ?? false);
  const [address] = await db.insert(addresses).values({ userId, ...data, isDefault }).returning();
  return address;
};

const updateAddress = async (userId, addressId, data) => {
  if (data.isDefault) {
    await db.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
  }
  const [updated] = await db.update(addresses)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId))).returning();
  if (!updated) throw new AppError('Address not found', 404);
  return updated;
};

const deleteAddress = async (userId, addressId) => {
  const [deleted] = await db.delete(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
    .returning({ id: addresses.id });
  if (!deleted) throw new AppError('Address not found', 404);
};

// ─── Favorites ────────────────────────────────────────────────────────────────

const getFavorites = async (userId) => {
  const rows = await db
    .select({
      id: favorites.id, createdAt: favorites.createdAt,
      restaurant: {
        id: restaurants.id, name: restaurants.name,
        bannerImage: restaurants.bannerImage, rating: restaurants.rating,
        totalReviews: restaurants.totalReviews, preparationTime: restaurants.preparationTime,
        cuisines: restaurants.cuisines, isActive: restaurants.isActive,
      },
    })
    .from(favorites)
    .innerJoin(restaurants, eq(favorites.restaurantId, restaurants.id))
    .where(eq(favorites.userId, userId))
    .orderBy(desc(favorites.createdAt));
  return rows;
};

const getFavoriteIds = async (userId) => {
  const rows = await db
    .select({ restaurantId: favorites.restaurantId })
    .from(favorites).where(eq(favorites.userId, userId));
  return rows.map(r => r.restaurantId);
};

const toggleFavorite = async (userId, restaurantId) => {
  const [existing] = await db.select({ id: favorites.id })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.restaurantId, restaurantId)))
    .limit(1);
  if (existing) {
    await db.delete(favorites).where(eq(favorites.id, existing.id));
    return { favorited: false };
  } else {
    await db.insert(favorites).values({ userId, restaurantId });
    return { favorited: true };
  }
};

// ─── Notifications ────────────────────────────────────────────────────────────

const getNotifications = async (userId) => {
  const rows = await db.select().from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  const unreadCount = rows.filter(n => !n.isRead).length;
  return { notifications: rows, unreadCount };
};

const markAllNotificationsRead = async (userId) => {
  await db.update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
};

const markNotificationRead = async (userId, notifId) => {
  const [updated] = await db.update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, notifId), eq(notifications.userId, userId)))
    .returning();
  if (!updated) throw new AppError('Notification not found', 404);
  return updated;
};

module.exports = {
  getProfile, updateProfile, changePassword, savePushToken,
  getAddresses, addAddress, updateAddress, deleteAddress,
  getFavorites, getFavoriteIds, toggleFavorite,
  getNotifications, markAllNotificationsRead, markNotificationRead,
};
