const { db } = require('../db');
const { menuItems, menuItemVariants, addOns } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { AppError } = require('../utils/response');

const createMenuItem = async (data) => {
  const { variants, addOns: addOnsData, ...itemData } = data;

  const [item] = await db.insert(menuItems).values(itemData).returning();

  if (variants?.length) {
    await db.insert(menuItemVariants).values(variants.map(v => ({ ...v, menuItemId: item.id })));
  }
  if (addOnsData?.length) {
    await db.insert(addOns).values(addOnsData.map(a => ({ ...a, menuItemId: item.id, restaurantId: item.restaurantId })));
  }

  return getMenuItemById(item.id);
};

const getMenuItemById = async (id) => {
  const [item] = await db.select().from(menuItems).where(eq(menuItems.id, id)).limit(1);
  if (!item) throw new AppError('Menu item not found', 404);

  const [variants, itemAddOns] = await Promise.all([
    db.select().from(menuItemVariants).where(eq(menuItemVariants.menuItemId, id)),
    db.select().from(addOns).where(eq(addOns.menuItemId, id)),
  ]);

  return { ...item, variants, addOns: itemAddOns };
};

const updateMenuItem = async (id, data) => {
  const { variants, addOns: addOnsData, ...itemData } = data;

  const [updated] = await db
    .update(menuItems)
    .set({ ...itemData, updatedAt: new Date() })
    .where(eq(menuItems.id, id))
    .returning();

  if (!updated) throw new AppError('Menu item not found', 404);

  if (variants !== undefined) {
    await db.delete(menuItemVariants).where(eq(menuItemVariants.menuItemId, id));
    if (variants.length) {
      await db.insert(menuItemVariants).values(variants.map(v => ({ ...v, menuItemId: id })));
    }
  }

  return getMenuItemById(id);
};

module.exports = { createMenuItem, updateMenuItem, getMenuItemById };
