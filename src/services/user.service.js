/**
 * src/services/user.service.js
 *
 * Issue #5: Added debug logging for userId when fetching profile. (#9)
 * Issue #5: getProfile returns all required fields including createdAt.
 * Issue #5: updateProfile correctly sets updatedAt and returns updated user.
 * Issue #6: All address operations include proper userId scoping (no data leakage).
 */
const { db } = require('../db');
const { users, addresses } = require('../db/schema');
const { eq, and } = require('drizzle-orm');
const { AppError } = require('../utils/response');
const logger = require('../utils/logger');

// ─── Profile ──────────────────────────────────────────────────────────────────

/**
 * getProfile(userId)
 * Returns: { id, name, email, phone, avatar, role, createdAt }
 */
const getProfile = async (userId) => {
  logger.debug('getProfile', { userId }); // #9

  const [user] = await db
    .select({
      id:        users.id,
      name:      users.name,
      email:     users.email,
      phone:     users.phone,
      avatar:    users.avatar,
      role:      users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new AppError('User not found', 404);
  return user;
};

/**
 * updateProfile(userId, data)
 * Updates name, email, avatar. Sets updatedAt.
 * Returns updated user.
 */
const updateProfile = async (userId, data) => {
  logger.debug('updateProfile', { userId, fields: Object.keys(data) }); // #9

  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({
      id:        users.id,
      name:      users.name,
      email:     users.email,
      phone:     users.phone,
      avatar:    users.avatar,
      role:      users.role,
      createdAt: users.createdAt,
    });

  if (!updated) throw new AppError('User not found', 404);
  return updated;
};

// ─── Addresses ────────────────────────────────────────────────────────────────

const getAddresses = async (userId) => {
  logger.debug('getAddresses', { userId }); // #9
  return db.select().from(addresses).where(eq(addresses.userId, userId));
};

const addAddress = async (userId, data) => {
  // If setting as default, unset all others for this user
  if (data.isDefault) {
    await db.update(addresses)
      .set({ isDefault: false })
      .where(eq(addresses.userId, userId));
  }

  // First address auto-becomes default
  const [existing] = await db
    .select({ id: addresses.id })
    .from(addresses)
    .where(eq(addresses.userId, userId))
    .limit(1);

  const isDefault = !existing ? true : (data.isDefault ?? false);

  const [address] = await db
    .insert(addresses)
    .values({ userId, ...data, isDefault })
    .returning();

  return address;
};

const updateAddress = async (userId, addressId, data) => {
  if (data.isDefault) {
    await db.update(addresses)
      .set({ isDefault: false })
      .where(eq(addresses.userId, userId));
  }

  const [updated] = await db
    .update(addresses)
    .set({ ...data, updatedAt: new Date() })
    // Issue #6: userId in WHERE clause prevents cross-user access
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
    .returning();

  if (!updated) throw new AppError('Address not found', 404);
  return updated;
};

const deleteAddress = async (userId, addressId) => {
  const [deleted] = await db
    .delete(addresses)
    // Issue #6: userId in WHERE clause — user can only delete their own address
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
    .returning({ id: addresses.id });

  if (!deleted) throw new AppError('Address not found', 404);
};

module.exports = {
  getProfile,
  updateProfile,
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
};
