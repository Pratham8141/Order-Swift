-- Migration: 003_add_favorites_notifications.sql
-- Safe to re-run (idempotent). Adds:
--   • users.password_hash, users.expo_push_token
--   • addresses.label
--   • favorites table
--   • notif_type enum + notifications table

BEGIN;

-- ── Users: new columns ───────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_push_token TEXT;

-- ── Addresses: label column ──────────────────────────────────────────────────
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS label VARCHAR(20) DEFAULT 'Home';

-- ── Favorites ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT favorites_user_restaurant_unique UNIQUE (user_id, restaurant_id)
);

-- ── Notification type enum ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE notif_type AS ENUM ('order_status', 'promo', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Notifications ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        VARCHAR(255) NOT NULL,
  body         TEXT NOT NULL,
  type         notif_type NOT NULL DEFAULT 'system',
  reference_id UUID,      -- orderId for order_status notifications
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id);
CREATE INDEX IF NOT EXISTS favorites_user_idx     ON favorites(user_id);

COMMIT;
