/**
 * src/services/cart.service.js
 *
 * TAKEAWAY-ONLY pricing:
 *   totalAmount = subtotal - discountAmount
 *   No deliveryFee. No taxAmount.
 *
 * Duplicate-item merging:
 *   addToCart checks for an existing row with the same
 *   (menuItemId, variantId, addOns fingerprint).
 *   If found → increments quantity.  If not → inserts new row.
 */
const { db } = require('../db');
const {
  carts, cartItems, menuItems, menuItemVariants, addOns, restaurants,
} = require('../db/schema');
const { eq, and, inArray } = require('drizzle-orm');
const { AppError } = require('../utils/response');

// ─── Public API ───────────────────────────────────────────────────────────────

const getOrCreateCart = async (userId) => {
  const [cart] = await db.select().from(carts).where(eq(carts.userId, userId)).limit(1);
  return cart || null;
};

const getCart = async (userId) => {
  const cart = await getOrCreateCart(userId);
  if (!cart) return { cart: null, items: [], pricing: _emptyPricing() };

  const items   = await _getCartItemsWithDetails(cart.id);
  const pricing = _calculatePricing(items);

  return { cart, items, pricing };
};

/**
 * addToCart — deduplicates on (menuItemId, variantId, addOns fingerprint).
 *
 * Fingerprint: sorted JSON of the add-on IDs supplied by the client.
 * If the fingerprint matches an existing row the quantity is incremented and
 * the addOns snapshot is kept from the existing row (no silent price change).
 */
const addToCart = async (userId, { menuItemId, variantId, addOnIds = [], quantity }) => {
  // 1. Source of truth: server-side menu item
  const [item] = await db.select().from(menuItems)
    .where(and(eq(menuItems.id, menuItemId), eq(menuItems.isAvailable, true)))
    .limit(1);
  if (!item) throw new AppError('Menu item not available', 400);

  // 2. Cross-restaurant guard
  const existingCart = await getOrCreateCart(userId);
  if (existingCart && existingCart.restaurantId !== item.restaurantId) {
    throw new AppError(
      'Your cart already has items from a different restaurant. Clear it first.',
      400
    );
  }

  // 3. Get or create cart row
  let cart = existingCart;
  if (!cart) {
    [cart] = await db.insert(carts)
      .values({ userId, restaurantId: item.restaurantId })
      .returning();
  }

  // 4. Build server-side addOn snapshot (never trust client prices)
  let addOnSnapshot = [];
  if (addOnIds.length) {
    const validAddOns = await db.select().from(addOns)
      .where(and(inArray(addOns.id, addOnIds), eq(addOns.menuItemId, menuItemId)));
    addOnSnapshot = validAddOns.map(a => ({
      addOnId: a.id,
      name:    a.name,
      price:   a.price,
    }));
  }

  // 5. Build deduplication fingerprint from the REQUESTED add-on IDs (sorted)
  //    so that order of the array doesn't create phantom duplicates.
  const addOnFingerprint = JSON.stringify([...addOnIds].sort());

  // 6. Scan existing cart rows for a matching (item + variant + addOns) combination
  const existingRows = await db.select().from(cartItems)
    .where(and(
      eq(cartItems.cartId, cart.id),
      eq(cartItems.menuItemId, menuItemId),
      // NULL-safe variant comparison handled below in JS
    ));

  const matchingRow = existingRows.find(row => {
    // Variant must match exactly (both null, or same UUID)
    const variantMatch = (row.variantId ?? null) === (variantId ?? null);
    if (!variantMatch) return false;

    // AddOn fingerprint: reconstruct from the stored snapshot
    const storedFingerprint = JSON.stringify(
      (row.addOns || []).map(a => a.addOnId).sort()
    );
    return storedFingerprint === addOnFingerprint;
  });

  if (matchingRow) {
    // ── Merge: increment quantity only ──────────────────────────────────────
    const [updated] = await db.update(cartItems)
      .set({ quantity: matchingRow.quantity + quantity, updatedAt: new Date() })
      .where(eq(cartItems.id, matchingRow.id))
      .returning();

    await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    return updated;
  }

  // ── Insert: new combination ────────────────────────────────────────────────
  const [cartItem] = await db.insert(cartItems)
    .values({
      cartId:    cart.id,
      menuItemId,
      variantId: variantId || null,
      addOns:    addOnSnapshot,
      quantity,
    })
    .returning();

  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
  return cartItem;
};

const updateCartItem = async (userId, { cartItemId, quantity }) => {
  const cart = await getOrCreateCart(userId);
  if (!cart) throw new AppError('Cart not found', 404);

  if (quantity === 0) return removeCartItem(userId, cartItemId);

  const [updated] = await db.update(cartItems)
    .set({ quantity, updatedAt: new Date() })
    .where(and(eq(cartItems.id, cartItemId), eq(cartItems.cartId, cart.id)))
    .returning();

  if (!updated) throw new AppError('Cart item not found', 404);
  return getCart(userId);
};

const removeCartItem = async (userId, cartItemId) => {
  const cart = await getOrCreateCart(userId);
  if (!cart) throw new AppError('Cart not found', 404);

  await db.delete(cartItems)
    .where(and(eq(cartItems.id, cartItemId), eq(cartItems.cartId, cart.id)));

  // Auto-clean empty cart
  const [remaining] = await db.select({ id: cartItems.id })
    .from(cartItems).where(eq(cartItems.cartId, cart.id)).limit(1);
  if (!remaining) await db.delete(carts).where(eq(carts.id, cart.id));

  return getCart(userId);
};

const clearCart = async (userId) => {
  const cart = await getOrCreateCart(userId);
  if (cart) {
    await db.delete(cartItems).where(eq(cartItems.cartId, cart.id));
    await db.delete(carts).where(eq(carts.id, cart.id));
  }
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const _getCartItemsWithDetails = async (cartId) => {
  const items = await db.select().from(cartItems).where(eq(cartItems.cartId, cartId));
  if (!items.length) return [];

  const menuItemIds = [...new Set(items.map(i => i.menuItemId))];
  const variantIds  = items.filter(i => i.variantId).map(i => i.variantId);

  const [menuItemList, variantList] = await Promise.all([
    db.select().from(menuItems).where(inArray(menuItems.id, menuItemIds)),
    variantIds.length
      ? db.select().from(menuItemVariants).where(inArray(menuItemVariants.id, variantIds))
      : [],
  ]);

  const menuItemMap = Object.fromEntries(menuItemList.map(m => [m.id, m]));
  const variantMap  = Object.fromEntries(variantList.map(v => [v.id, v]));

  return items.map(item => {
    const menuItem   = menuItemMap[item.menuItemId];
    const variant    = item.variantId ? variantMap[item.variantId] : null;
    const basePrice  = parseFloat(variant ? variant.price : menuItem.basePrice);
    const addOnPrice = (item.addOns || []).reduce((s, a) => s + parseFloat(a.price), 0);
    const unitPrice  = basePrice + addOnPrice;

    return {
      ...item,
      menuItem: {
        id:    menuItem.id,
        name:  menuItem.name,
        image: menuItem.image,
        isVeg: menuItem.isVeg,
      },
      variant,
      unitPrice,
      totalPrice: unitPrice * item.quantity,
    };
  });
};

/**
 * TAKEAWAY pricing — no tax, no delivery fee.
 *   totalAmount = subtotal - discountAmount
 */
const _calculatePricing = (items) => {
  const subtotal       = parseFloat(items.reduce((s, i) => s + i.totalPrice, 0).toFixed(2));
  const discountAmount = 0; // reserved for future coupon system
  const totalAmount    = parseFloat((subtotal - discountAmount).toFixed(2));

  return { subtotal, discountAmount, totalAmount };
};

const _emptyPricing = () => ({ subtotal: 0, discountAmount: 0, totalAmount: 0 });

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  _getCartItemsWithDetails,
  _calculatePricing,
};
