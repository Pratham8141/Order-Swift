const {
  pgTable, uuid, varchar, text, boolean, integer, decimal,
  timestamp, pgEnum, jsonb, index, uniqueIndex,
} = require('drizzle-orm/pg-core');

// ─── Enums ───────────────────────────────────────────────────────────────────
const userRoleEnum    = pgEnum('user_role',    ['user', 'admin', 'restaurant_owner']);
const orderStatusEnum = pgEnum('order_status', [
  'pending', 'paid', 'confirmed', 'preparing', 'ready', 'collected', 'cancelled',
]);
const paymentStatusEnum = pgEnum('payment_status', ['pending', 'paid', 'failed', 'refunded']);
const notifTypeEnum = pgEnum('notif_type', ['order_status', 'promo', 'system']);

// ─── Users ────────────────────────────────────────────────────────────────────
const users = pgTable('users', {
  id:             uuid('id').primaryKey().defaultRandom(),
  name:           varchar('name',  { length: 100 }),
  email:          varchar('email', { length: 255 }),
  phone:          varchar('phone', { length: 20 }),
  avatar:         text('avatar'),
  role:           userRoleEnum('role').default('user').notNull(),
  passwordHash:   text('password_hash'),
  expoPushToken:  text('expo_push_token'),
  isActive:       boolean('is_active').default(true).notNull(),
  googleId:       varchar('google_id', { length: 255 }),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  emailIdx:  uniqueIndex('users_email_idx').on(t.email),
  phoneIdx:  uniqueIndex('users_phone_idx').on(t.phone),
  googleIdx: uniqueIndex('users_google_idx').on(t.googleId),
}));

// ─── User Roles (scalable multi-role support) ─────────────────────────────────
// Allows a user to have multiple roles (e.g., both 'user' and 'restaurant_owner').
// The 'role' on the users table is the PRIMARY role for backward compatibility.
const userRoles = pgTable('user_roles', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  role:      userRoleEnum('role').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniqueUserRole: uniqueIndex('user_roles_user_role_idx').on(t.userId, t.role),
  userIdx:        index('user_roles_user_idx').on(t.userId),
}));
const otps = pgTable('otps', {
  id:        uuid('id').primaryKey().defaultRandom(),
  phone:     varchar('phone', { length: 20 }).notNull(),
  otpHash:   text('otp_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  attempts:  integer('attempts').default(0).notNull(),
  used:      boolean('used').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  phoneIdx: index('otps_phone_idx').on(t.phone),
}));

// ─── Refresh Tokens ───────────────────────────────────────────────────────────
const refreshTokens = pgTable('refresh_tokens', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  token:     text('token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  tokenIdx: uniqueIndex('refresh_tokens_token_idx').on(t.token),
  userIdx:  index('refresh_tokens_user_idx').on(t.userId),
}));

// ─── Addresses ────────────────────────────────────────────────────────────────
const addresses = pgTable('addresses', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  label:     varchar('label', { length: 20 }).default('Home'),   // Home / Work / Other
  name:      varchar('name',  { length: 100 }).notNull(),
  phone:     varchar('phone', { length: 20 }).notNull(),
  street:    text('street').notNull(),
  city:      varchar('city',    { length: 100 }).notNull(),
  state:     varchar('state',   { length: 100 }).notNull(),
  pincode:   varchar('pincode', { length: 10 }).notNull(),
  latitude:  decimal('latitude',  { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('addresses_user_idx').on(t.userId),
}));

// ─── Restaurants ──────────────────────────────────────────────────────────────
const restaurants = pgTable('restaurants', {
  id:           uuid('id').primaryKey().defaultRandom(),
  ownerId:      uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  name:         varchar('name', { length: 255 }).notNull(),
  description:  text('description'),
  bannerImage:  text('banner_image'),
  rating:       decimal('rating', { precision: 3, scale: 2 }).default('0.00'),
  totalReviews: integer('total_reviews').default(0),
  preparationTime: integer('preparation_time').default(20),
  minOrder:     decimal('min_order', { precision: 8, scale: 2 }).default('0.00'),
  isActive:     boolean('is_active').default(true).notNull(),
  isOpen:       boolean('is_open').default(true).notNull(),
  openingTime:  varchar('opening_time', { length: 5 }).default('09:00'),
  closingTime:  varchar('closing_time', { length: 5 }).default('22:00'),
  address:      text('address'),
  latitude:     decimal('latitude',  { precision: 10, scale: 7 }),
  longitude:    decimal('longitude', { precision: 10, scale: 7 }),
  cuisines:     jsonb('cuisines').default([]),
  termsAcceptedAt: timestamp("terms_accepted_at"),  // NULL = not accepted yet
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  nameIdx:   index('restaurants_name_idx').on(t.name),
  ratingIdx: index('restaurants_rating_idx').on(t.rating),
}));

// ─── Categories ───────────────────────────────────────────────────────────────
const categories = pgTable('categories', {
  id:           uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').references(() => restaurants.id, { onDelete: 'cascade' }).notNull(),
  name:         varchar('name', { length: 100 }).notNull(),
  description:  text('description'),
  sortOrder:    integer('sort_order').default(0),
  isActive:     boolean('is_active').default(true).notNull(),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  restaurantIdx: index('categories_restaurant_idx').on(t.restaurantId),
}));

// ─── Menu Items ───────────────────────────────────────────────────────────────
const menuItems = pgTable('menu_items', {
  id:           uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').references(() => restaurants.id, { onDelete: 'cascade' }).notNull(),
  categoryId:   uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  name:         varchar('name', { length: 255 }).notNull(),
  description:  text('description'),
  basePrice:    decimal('base_price', { precision: 8, scale: 2 }).notNull(),
  image:        text('image'),
  isVeg:        boolean('is_veg').default(true).notNull(),
  isAvailable:  boolean('is_available').default(true).notNull(),
  sortOrder:    integer('sort_order').default(0),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  restaurantIdx: index('menu_items_restaurant_idx').on(t.restaurantId),
  categoryIdx:   index('menu_items_category_idx').on(t.categoryId),
}));

// ─── Menu Item Variants ───────────────────────────────────────────────────────
const menuItemVariants = pgTable('menu_item_variants', {
  id:         uuid('id').primaryKey().defaultRandom(),
  menuItemId: uuid('menu_item_id').references(() => menuItems.id, { onDelete: 'cascade' }).notNull(),
  name:       varchar('name', { length: 100 }).notNull(),
  price:      decimal('price', { precision: 8, scale: 2 }).notNull(),
  isDefault:  boolean('is_default').default(false),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  menuItemIdx: index('variants_menu_item_idx').on(t.menuItemId),
}));

// ─── Add-ons ──────────────────────────────────────────────────────────────────
const addOns = pgTable('add_ons', {
  id:           uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').references(() => restaurants.id, { onDelete: 'cascade' }).notNull(),
  menuItemId:   uuid('menu_item_id').references(() => menuItems.id, { onDelete: 'cascade' }),
  name:         varchar('name', { length: 100 }).notNull(),
  price:        decimal('price', { precision: 8, scale: 2 }).notNull(),
  isAvailable:  boolean('is_available').default(true).notNull(),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  menuItemIdx: index('add_ons_menu_item_idx').on(t.menuItemId),
}));

// ─── Cart ─────────────────────────────────────────────────────────────────────
const carts = pgTable('carts', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  restaurantId: uuid('restaurant_id').references(() => restaurants.id, { onDelete: 'cascade' }).notNull(),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: uniqueIndex('carts_user_idx').on(t.userId),
}));

const cartItems = pgTable('cart_items', {
  id:         uuid('id').primaryKey().defaultRandom(),
  cartId:     uuid('cart_id').references(() => carts.id, { onDelete: 'cascade' }).notNull(),
  menuItemId: uuid('menu_item_id').references(() => menuItems.id, { onDelete: 'cascade' }).notNull(),
  variantId:  uuid('variant_id').references(() => menuItemVariants.id, { onDelete: 'set null' }),
  addOns:     jsonb('add_ons').default([]),
  quantity:   integer('quantity').default(1).notNull(),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
  updatedAt:  timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  cartIdx:     index('cart_items_cart_idx').on(t.cartId),
  menuItemIdx: index('cart_items_menu_item_idx').on(t.menuItemId),
}));

// ─── Orders ───────────────────────────────────────────────────────────────────
const orders = pgTable('orders', {
  id:               uuid('id').primaryKey().defaultRandom(),
  userId:           uuid('user_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  restaurantId:     uuid('restaurant_id').references(() => restaurants.id, { onDelete: 'restrict' }).notNull(),
  status:           orderStatusEnum('status').default('pending').notNull(),
  paymentStatus:    paymentStatusEnum('payment_status').default('pending').notNull(),
  razorpayOrderId:  varchar('razorpay_order_id',   { length: 255 }),
  razorpayPaymentId: varchar('razorpay_payment_id', { length: 255 }),
  subtotal:         decimal('subtotal',       { precision: 10, scale: 2 }).notNull(),
  discountAmount:   decimal('discount_amount', { precision: 10, scale: 2 }).default('0.00'),
  totalAmount:      decimal('total_amount',    { precision: 10, scale: 2 }).notNull(),
  couponCode:       varchar('coupon_code',     { length: 50 }),
  // FIX: wallet_amount_used was added via migration 005 but was missing from
  // this Drizzle schema definition. Without it, Drizzle's getOrderById() call
  // would fail with a column mapping error → 500 Internal Server Error.
  // The column exists in the DB (added by ALTER TABLE in 005_wallet_coupons.sql).
  walletAmountUsed: decimal('wallet_amount_used', { precision: 10, scale: 2 }).default('0.00'),
  pickupName:       varchar('pickup_name',     { length: 100 }),
  notes:            text('notes'),
  preparationTime:  integer('preparation_time'),
  idempotencyKey:   varchar('idempotency_key', { length: 100 }),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userIdx:        index('orders_user_idx').on(t.userId),
  restaurantIdx:  index('orders_restaurant_idx').on(t.restaurantId),
  statusIdx:      index('orders_status_idx').on(t.status),
  razorpayOrdIdx: uniqueIndex('orders_razorpay_order_idx').on(t.razorpayOrderId),
  idempotencyIdx: uniqueIndex('orders_idempotency_idx').on(t.userId, t.idempotencyKey),
}));

const orderItems = pgTable('order_items', {
  id:          uuid('id').primaryKey().defaultRandom(),
  orderId:     uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
  menuItemId:  uuid('menu_item_id').references(() => menuItems.id, { onDelete: 'restrict' }).notNull(),
  name:        varchar('name', { length: 255 }).notNull(),
  variantName: varchar('variant_name', { length: 100 }),
  addOns:      jsonb('add_ons').default([]),
  quantity:    integer('quantity').notNull(),
  unitPrice:   decimal('unit_price',  { precision: 8,  scale: 2 }).notNull(),
  totalPrice:  decimal('total_price', { precision: 10, scale: 2 }).notNull(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  orderIdx: index('order_items_order_idx').on(t.orderId),
}));

// ─── Reviews ──────────────────────────────────────────────────────────────────
const reviews = pgTable('reviews', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  restaurantId: uuid('restaurant_id').references(() => restaurants.id, { onDelete: 'cascade' }).notNull(),
  orderId:      uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  rating:       integer('rating').notNull(),
  comment:      text('comment'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  restaurantIdx: index('reviews_restaurant_idx').on(t.restaurantId),
  userOrderIdx:  uniqueIndex('reviews_user_order_idx').on(t.userId, t.orderId),
}));

// ─── Favorites ────────────────────────────────────────────────────────────────
const favorites = pgTable('favorites', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  restaurantId: uuid('restaurant_id').references(() => restaurants.id, { onDelete: 'cascade' }).notNull(),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniqueFav: uniqueIndex('favorites_user_restaurant_idx').on(t.userId, t.restaurantId),
}));

// ─── Notifications ────────────────────────────────────────────────────────────
const notifications = pgTable('notifications', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title:       varchar('title', { length: 255 }).notNull(),
  body:        text('body').notNull(),
  type:        notifTypeEnum('type').default('system').notNull(),
  referenceId: uuid('reference_id'),   // orderId for order_status notifications
  isRead:      boolean('is_read').default(false).notNull(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('notifications_user_idx').on(t.userId),
}));

// ─── Wallet ───────────────────────────────────────────────────────────────────
const wallets = pgTable('wallets', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  balance:   decimal('balance', { precision: 12, scale: 2 }).default('0.00').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: uniqueIndex('wallets_user_idx').on(t.userId),
}));

const transactionTypeEnum = pgEnum('transaction_type', ['credit', 'debit']);

const walletTransactions = pgTable('wallet_transactions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  type:        transactionTypeEnum('type').notNull(),
  amount:      decimal('amount', { precision: 10, scale: 2 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  referenceId: uuid('reference_id'),   // orderId for debit/refund transactions
  balanceAfter: decimal('balance_after', { precision: 12, scale: 2 }).notNull(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userIdx:    index('wallet_tx_user_idx').on(t.userId),
  refIdx:     index('wallet_tx_ref_idx').on(t.referenceId),
}));

// ─── Coupons ──────────────────────────────────────────────────────────────────
const couponTypeEnum = pgEnum('coupon_type', ['flat', 'percentage']);

const coupons = pgTable('coupons', {
  id:            uuid('id').primaryKey().defaultRandom(),
  code:          varchar('code', { length: 50 }).notNull(),
  type:          couponTypeEnum('type').notNull(),
  value:         decimal('value', { precision: 8, scale: 2 }).notNull(),
  minOrder:      decimal('min_order', { precision: 8, scale: 2 }).default('0.00'),
  maxDiscount:   decimal('max_discount', { precision: 8, scale: 2 }),
  expiresAt:     timestamp('expires_at'),
  usageLimit:    integer('usage_limit'),
  usedCount:     integer('used_count').default(0).notNull(),
  perUserLimit:  integer('per_user_limit').default(1).notNull(),
  isActive:      boolean('is_active').default(true).notNull(),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  codeIdx: uniqueIndex('coupons_code_idx').on(t.code),
}));

const couponUsage = pgTable('coupon_usage', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  couponId:  uuid('coupon_id').references(() => coupons.id, { onDelete: 'cascade' }).notNull(),
  orderId:   uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userCouponIdx: index('coupon_usage_user_coupon_idx').on(t.userId, t.couponId),
}));

module.exports = {
  users, userRoles, otps, refreshTokens, addresses,
  restaurants, categories, menuItems, menuItemVariants, addOns,
  carts, cartItems,
  orders, orderItems,
  reviews,
  favorites,
  notifications,
  wallets, walletTransactions,
  coupons, couponUsage,
  userRoleEnum, orderStatusEnum, paymentStatusEnum, notifTypeEnum,
  transactionTypeEnum, couponTypeEnum,
};
