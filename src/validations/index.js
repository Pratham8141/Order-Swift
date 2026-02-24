const { z } = require('zod');

// ─── Self-assignable roles ────────────────────────────────────────────────────
const SELF_ASSIGNABLE_ROLES = ['user', 'restaurant_owner'];

const optionalRoleField = z
  .enum(['user', 'restaurant_owner'], {
    errorMap: () => ({
      message: 'role must be "user" or "restaurant_owner". The "admin" role cannot be self-assigned.',
    }),
  })
  .optional();

// ─── Auth ─────────────────────────────────────────────────────────────────────
const sendOtpSchema = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid Indian phone number (10 digits starting 6-9)'),
  role:  optionalRoleField,
});

const verifyOtpSchema = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid Indian phone number'),
  otp:   z.string().length(6).regex(/^\d+$/, 'OTP must be 6 digits'),
  role:  optionalRoleField,
});

const googleAuthSchema    = z.object({ idToken:      z.string().min(1) });
const refreshTokenSchema  = z.object({ refreshToken: z.string().min(1) });

// ─── User profile ─────────────────────────────────────────────────────────────
const updateProfileSchema = z.object({
  name:   z.string().min(2).max(100).optional(),
  email:  z.string().email().optional(),
  avatar: z.string().url().optional(),
});

const addressSchema = z.object({
  name:      z.string().min(2).max(100),
  phone:     z.string().regex(/^[6-9]\d{9}$/),
  street:    z.string().min(5).max(500),
  city:      z.string().min(2).max(100),
  state:     z.string().min(2).max(100),
  pincode:   z.string().regex(/^\d{6}$/, 'Invalid pincode'),
  latitude:  z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isDefault: z.boolean().optional(),
});

// ─── Restaurants ──────────────────────────────────────────────────────────────
const restaurantQuerySchema = z.object({
  page:        z.string().optional().transform(v => parseInt(v) || 1),
  limit:       z.string().optional().transform(v => Math.min(parseInt(v) || 10, 50)),
  search:      z.string().optional(),
  minRating:   z.string().optional().transform(v => v ? parseFloat(v) : undefined),
  maxDelivery: z.string().optional().transform(v => v ? parseInt(v) : undefined),
  isActive:    z.string().optional().transform(v => v === 'true'),
});

// preparationTime replaces deliveryTime; deliveryFee removed
const restaurantSchema = z.object({
  name:            z.string().min(2).max(255),
  description:     z.string().max(1000).optional(),
  bannerImage:     z.string().url().optional(),
  preparationTime: z.number().int().min(1).max(120).optional(),
  minOrder:        z.number().min(0).optional(),
  isActive:        z.boolean().optional(),
  openingTime:     z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closingTime:     z.string().regex(/^\d{2}:\d{2}$/).optional(),
  address:         z.string().optional(),
  latitude:        z.number().min(-90).max(90).optional(),
  longitude:       z.number().min(-180).max(180).optional(),
  cuisines:        z.array(z.string()).optional(),
});

// ─── Menu ─────────────────────────────────────────────────────────────────────
const menuItemSchema = z.object({
  restaurantId: z.string().uuid(),
  categoryId:   z.string().uuid().optional(),
  name:         z.string().min(2).max(255),
  description:  z.string().max(1000).optional(),
  basePrice:    z.number().positive(),
  image:        z.string().url().optional(),
  isVeg:        z.boolean().optional(),
  isAvailable:  z.boolean().optional(),
  sortOrder:    z.number().int().optional(),
  variants: z.array(z.object({
    name:      z.string().min(1).max(100),
    price:     z.number().positive(),
    isDefault: z.boolean().optional(),
  })).optional(),
  addOns: z.array(z.object({
    name:  z.string().min(1).max(100),
    price: z.number().min(0),
  })).optional(),
});

// ─── Cart ─────────────────────────────────────────────────────────────────────
const addToCartSchema = z.object({
  menuItemId: z.string().uuid(),
  variantId:  z.string().uuid().optional(),
  addOnIds:   z.array(z.string().uuid()).optional(),
  quantity:   z.number().int().min(1).max(20),
});

const updateCartSchema = z.object({
  cartItemId: z.string().uuid(),
  quantity:   z.number().int().min(0).max(20),
});

const removeCartSchema = z.object({ cartItemId: z.string().uuid() });

// ─── Orders ───────────────────────────────────────────────────────────────────
// TAKEAWAY: addressId removed — pickup only, no delivery address required.
const createOrderSchema = z.object({
  notes:      z.string().max(500).optional(),
  pickupName: z.string().max(100).optional(),
});

// preparationTime replaces estimatedTime
// Status enum updated to takeaway lifecycle
const orderStatusSchema = z.object({
  status: z.enum(['pending', 'paid', 'confirmed', 'preparing', 'ready', 'collected', 'cancelled']),
  preparationTime: z.number().int().min(1).optional(),
});

// ─── Payments ─────────────────────────────────────────────────────────────────
const verifyPaymentSchema = z.object({
  razorpayOrderId:   z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
  orderId:           z.string().uuid(),
});

// ─── Reviews ─────────────────────────────────────────────────────────────────
const reviewSchema = z.object({
  restaurantId: z.string().uuid(),
  orderId:      z.string().uuid().optional(),
  rating:       z.number().int().min(1).max(5),
  comment:      z.string().max(1000).optional(),
});

// ─── Middleware ───────────────────────────────────────────────────────────────
/**
 * validate(schema) — runs Zod safeParse on req.body.
 * IMPORTANT: Zod strips keys NOT declared in the schema (default "strip" mode).
 * Any field that must survive into the controller MUST be declared in the schema.
 */
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors:  result.error.flatten().fieldErrors,
    });
  }
  req.body = result.data;
  next();
};

const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid query parameters',
      errors:  result.error.flatten().fieldErrors,
    });
  }
  req.query = result.data;
  next();
};

module.exports = {
  schemas: {
    sendOtp:       sendOtpSchema,
    verifyOtp:     verifyOtpSchema,
    googleAuth:    googleAuthSchema,
    refreshToken:  refreshTokenSchema,
    updateProfile: updateProfileSchema,
    address:       addressSchema,
    restaurantQuery: restaurantQuerySchema,
    restaurant:    restaurantSchema,
    menuItem:      menuItemSchema,
    addToCart:     addToCartSchema,
    updateCart:    updateCartSchema,
    removeCart:    removeCartSchema,
    createOrder:   createOrderSchema,
    orderStatus:   orderStatusSchema,
    verifyPayment: verifyPaymentSchema,
    review:        reviewSchema,
  },
  validate,
  validateQuery,
  SELF_ASSIGNABLE_ROLES,
};
