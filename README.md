# 🍔 Food Delivery Backend — Production Ready

Multi-restaurant food delivery API built with Node.js, Express, PostgreSQL (Supabase), Drizzle ORM.

## 📁 Folder Structure

```
src/
├── config/          # env validation (crashes on bad config), razorpay instance
├── controllers/     # HTTP only — parse req, call service, send res
├── services/        # All business logic lives here
├── routes/          # Endpoint definitions + middleware wiring
├── middleware/       # auth.js, errorHandler.js, rateLimiter.js
├── db/              # schema.js (Drizzle) + index.js (pool + connectDB)
├── utils/           # logger, jwt, otp, sms, response helpers, auditLog
└── validations/     # Zod schemas + validate() middleware factory
```

## 🚀 Quick Start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Fill in all values. Generate JWT secrets:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 3. Push schema to Supabase
npm run db:push

# 4. Run
npm run dev       # development
npm start         # production
```

## 🔐 Auth Flow

### Phone OTP
```
POST /api/v1/auth/send-otp     { phone: "9876543210" }
  → Rate limited: 3 requests per 10 min per phone
  → OTP: 6-digit, bcrypt-hashed, expires in 5 min

POST /api/v1/auth/verify-otp   { phone, otp }
  → Locked after 5 wrong attempts
  → Returns: { accessToken, refreshToken, user, isNewUser }
```

### Google
```
POST /api/v1/auth/google        { idToken }
  → Verifies Google ID token server-side
  → Returns: { accessToken, refreshToken, user }
```

### Token Refresh
```
POST /api/v1/auth/refresh       { refreshToken }
  → Returns: { accessToken }
```

## 📡 All Endpoints

### Auth `/api/v1/auth`
| Method | Path | Rate Limit | Auth |
|--------|------|-----------|------|
| POST | /send-otp | 3/10min per phone | ❌ |
| POST | /verify-otp | 20/15min | ❌ |
| POST | /google | 20/15min | ❌ |
| POST | /refresh | — | ❌ |
| POST | /logout | — | ✅ |

### User `/api/v1/user`
| Method | Path | Auth |
|--------|------|------|
| GET | /profile | ✅ |
| PUT | /profile | ✅ |
| GET | /addresses | ✅ |
| POST | /address | ✅ |
| PUT | /address/:id | ✅ |
| DELETE | /address/:id | ✅ |

### Restaurants `/api/v1/restaurants`
| Method | Path | Rate Limit |
|--------|------|-----------|
| GET | / | 60/min (search) |
| GET | /:id | — |
| GET | /:id/menu | — |
| GET | /:id/reviews | — |

Query params: `?search=&minRating=&maxDelivery=&page=&limit=`

### Cart `/api/v1/cart` (auth required)
| Method | Path | Body |
|--------|------|------|
| GET | / | — |
| POST | /add | `{ menuItemId, variantId?, addOnIds?, quantity }` |
| PUT | /update | `{ cartItemId, quantity }` |
| DELETE | /remove | `{ cartItemId }` |
| DELETE | /clear | — |

### Orders `/api/v1/orders` (auth required)
| Method | Path |
|--------|------|
| POST | / |
| GET | / |
| GET | /:id |
| PATCH | /:id/cancel |

### Payments `/api/v1/payments`
| Method | Path | Auth |
|--------|------|------|
| POST | /create-order | ✅ (10/hour) |
| POST | /verify | ✅ |
| POST | /webhook | ❌ (signature verified) |

### Reviews `/api/v1/reviews`
| Method | Path | Auth |
|--------|------|------|
| POST | / | ✅ |

### Admin `/api/v1/admin` (role=admin required)
| Method | Path |
|--------|------|
| POST | /restaurant |
| PUT | /restaurant/:id |
| DELETE | /restaurant/:id |
| POST | /menu-item |
| PUT | /menu-item/:id |
| GET | /orders |
| PATCH | /order/:id/status |

## 💳 Payment Flow

```
1. POST /orders/create           → orderId
2. POST /payments/create-order   → { razorpayOrderId, amount, keyId }
3. Frontend: Razorpay SDK checkout
4. POST /payments/verify         → { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId }
   → Backend verifies HMAC-SHA256 signature
   → Order marked as paid
5. Razorpay Webhook (optional)   → POST /payments/webhook
   → Handles payment.failed events
```

## 🔄 Order State Machine

```
pending ──→ paid ──→ confirmed ──→ preparing ──→ out_for_delivery ──→ delivered
   │          │           │
   └──────────┴───────────┴──────────────────────────────────────── cancelled
```

Invalid transitions return `400`. Terminal states (`delivered`, `cancelled`) reject all transitions.

## 🛡️ Security Checklist

| Feature | Status |
|---------|--------|
| Environment validation on startup | ✅ |
| Helmet security headers | ✅ |
| CORS strict allowlist | ✅ |
| JSON body size limit (2mb) | ✅ |
| Global rate limiting | ✅ |
| OTP rate limit (3/10min per phone) | ✅ |
| Search rate limit (60/min) | ✅ |
| Payment rate limit (10/hour) | ✅ |
| OTP bcrypt hashed | ✅ |
| OTP attempt tracking (max 5) | ✅ |
| JWT access + refresh tokens | ✅ |
| Refresh tokens stored in DB | ✅ |
| Role-based authorization | ✅ |
| Zod input validation | ✅ |
| Server-side price calculation | ✅ |
| Atomic order creation (transaction) | ✅ |
| Razorpay HMAC signature verification | ✅ |
| Double-payment prevention | ✅ |
| Razorpay idempotency (order reuse) | ✅ |
| Webhook signature verification | ✅ |
| Order state machine | ✅ |
| Admin audit logging | ✅ |
| Graceful shutdown | ✅ |
| SSL for Supabase | ✅ |

## 🗄️ Database Schema

| Table | Key Fields |
|-------|-----------|
| users | id, phone, email, google_id, role |
| otps | phone, otp_hash, expires_at, attempts, used |
| refresh_tokens | user_id, token, expires_at |
| addresses | user_id, street, city, pincode, is_default |
| restaurants | name, rating, delivery_time, is_active |
| categories | restaurant_id, name, sort_order |
| menu_items | restaurant_id, category_id, base_price, is_veg |
| menu_item_variants | menu_item_id, name, price |
| add_ons | menu_item_id, name, price |
| carts | user_id (unique), restaurant_id |
| cart_items | cart_id, menu_item_id, variant_id, add_ons (json) |
| orders | user_id, status, payment_status, total_amount, delivery_address (snapshot) |
| order_items | order_id, name (snapshot), unit_price (snapshot) |
| reviews | user_id, restaurant_id, rating → auto-updates restaurant.rating |

## 🚢 Deploy to Render

1. Push to GitHub
2. Create Web Service → connect repo
3. Set env vars from `.env.example`
4. `render.yaml` is pre-configured

**Supabase connection:**
- Use `DATABASE_URL` (direct, port 5432) for `npm run db:push`
- Use `DATABASE_POOLER_URL` (pooler, port 6543) in production for the app

## 📦 Stack

| Package | Purpose |
|---------|---------|
| express | HTTP framework |
| drizzle-orm | Type-safe ORM |
| pg | PostgreSQL driver |
| jsonwebtoken | JWT tokens |
| bcryptjs | OTP hashing |
| google-auth-library | Google token verification |
| razorpay | Payment SDK |
| zod | Schema validation |
| helmet | Security headers |
| express-rate-limit | Rate limiting |
| winston + daily-rotate-file | Structured logging |
| compression | Gzip responses |
| morgan | HTTP request logging |
