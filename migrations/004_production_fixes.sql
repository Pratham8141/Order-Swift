-- =============================================================================
-- Migration 004: Production Fixes
-- Run this against your Supabase/PostgreSQL production database.
-- All statements are safe to run even if some columns already exist.
-- =============================================================================

-- ─── Ensure enums exist (safe) ───────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('user', 'admin', 'restaurant_owner');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('pending','paid','confirmed','preparing','ready','collected','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending','paid','failed','refunded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notif_type AS ENUM ('order_status','promo','system');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── users table fixes ────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_push_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Role column: ensure it exists with the enum type
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN role user_role NOT NULL DEFAULT 'user';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Unique indexes on users (safe)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx  ON users(email)     WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_idx  ON users(phone)     WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_idx ON users(google_id) WHERE google_id IS NOT NULL;

-- ─── addresses table fixes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS addresses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      VARCHAR(20) DEFAULT 'Home',
  name       VARCHAR(100) NOT NULL,
  phone      VARCHAR(20) NOT NULL,
  street     TEXT NOT NULL,
  city       VARCHAR(100) NOT NULL,
  state      VARCHAR(100) NOT NULL,
  pincode    VARCHAR(10) NOT NULL,
  latitude   DECIMAL(10,7),
  longitude  DECIMAL(10,7),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS label VARCHAR(20) DEFAULT 'Home';
CREATE INDEX IF NOT EXISTS addresses_user_idx ON addresses(user_id);

-- ─── restaurants table fixes ──────────────────────────────────────────────────
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS preparation_time INTEGER DEFAULT 20;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS banner_image TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS total_reviews INTEGER DEFAULT 0;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS min_order DECIMAL(8,2) DEFAULT 0.00;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS opening_time VARCHAR(5) DEFAULT '09:00';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS closing_time VARCHAR(5) DEFAULT '22:00';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS cuisines JSONB DEFAULT '[]';

-- ─── orders table fixes ───────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_name VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preparation_time INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0.00;

-- Idempotency index (unique per user+key, null keys excluded)
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_idx
  ON orders(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── favorites table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_restaurant_idx
  ON favorites(user_id, restaurant_id);

-- ─── notifications table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        VARCHAR(255) NOT NULL,
  body         TEXT NOT NULL,
  type         notif_type NOT NULL DEFAULT 'system',
  reference_id UUID,
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id);

-- ─── OTP table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      VARCHAR(20) NOT NULL,
  otp_hash   TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS otps_phone_idx ON otps(phone);

-- ─── refresh_tokens table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_token_idx ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_id);

-- ─── Done ─────────────────────────────────────────────────────────────────────
-- Verify by running: SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders';

-- ─── user_roles table (scalable multi-role support) ──────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       user_role NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_idx ON user_roles(user_id, role);
CREATE INDEX IF NOT EXISTS user_roles_user_idx ON user_roles(user_id);

-- Backfill user_roles from existing users.role values
INSERT INTO user_roles (user_id, role)
SELECT id, role FROM users
ON CONFLICT (user_id, role) DO NOTHING;
