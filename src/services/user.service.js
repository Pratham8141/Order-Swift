const { db } = require('../db');
const { users, addresses } = require('../db/schema');
const { eq, and } = require('drizzle-orm');
const { AppError } = require('../utils/response');

const getProfile = async (userId) => {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, avatar: users.avatar, role: users.role, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new AppError('User not found', 404);
  return user;
};

const updateProfile = async (userId, data) => {
  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id, name: users.name, email: users.email, phone: users.phone, avatar: users.avatar, role: users.role });

  if (!updated) throw new AppError('User not found', 404);
  return updated;
};

// ─── Addresses ────────────────────────────────────────────────────────────────
const getAddresses = async (userId) =>
  db.select().from(addresses).where(eq(addresses.userId, userId));

const addAddress = async (userId, data) => {
  // If setting as default, unset all others
  if (data.isDefault) {
    await db.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
  }

  // If first address, make default
  const existing = await db.select({ id: addresses.id }).from(addresses).where(eq(addresses.userId, userId)).limit(1);
  const isDefault = existing.length === 0 ? true : (data.isDefault ?? false);

  const [address] = await db.insert(addresses)
    .values({ userId, ...data, isDefault })
    .returning();

  return address;
};

const updateAddress = async (userId, addressId, data) => {
  if (data.isDefault) {
    await db.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
  }

  const [updated] = await db
    .update(addresses)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
    .returning();

  if (!updated) throw new AppError('Address not found', 404);
  return updated;
};

const deleteAddress = async (userId, addressId) => {
  const [deleted] = await db
    .delete(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
    .returning({ id: addresses.id });

  if (!deleted) throw new AppError('Address not found', 404);
};

module.exports = { getProfile, updateProfile, getAddresses, addAddress, updateAddress, deleteAddress };
