-- =============================================================================
-- Migration 005: Wallet, Coupons, Order Enhancements
-- Run AFTER migration 004.
-- =============================================================================

-- ─── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM ('credit', 'debit');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE coupon_type AS ENUM ('flat', 'percentage');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Wallets ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS wallets_user_idx ON wallets(user_id);

-- ─── Wallet Transactions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          transaction_type NOT NULL,
  amount        DECIMAL(10,2) NOT NULL,
  description   VARCHAR(255) NOT NULL,
  reference_id  UUID,
  balance_after DECIMAL(12,2) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wallet_tx_user_idx ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS wallet_tx_ref_idx  ON wallet_transactions(reference_id);

-- ─── Coupons ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(50) NOT NULL,
  type            coupon_type NOT NULL,
  value           DECIMAL(8,2) NOT NULL,
  min_order       DECIMAL(8,2) DEFAULT 0.00,
  max_discount    DECIMAL(8,2),
  expires_at      TIMESTAMP,
  usage_limit     INTEGER,
  used_count      INTEGER NOT NULL DEFAULT 0,
  per_user_limit  INTEGER NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_idx ON coupons(code);

-- ─── Coupon Usage ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupon_usage (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coupon_id  UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id   UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS coupon_usage_user_coupon_idx ON coupon_usage(user_id, coupon_id);

-- ─── Orders: add wallet_amount_used column ────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wallet_amount_used DECIMAL(10,2) DEFAULT 0.00;

-- ─── Sample coupons (optional, remove in production) ─────────────────────────
INSERT INTO coupons (code, type, value, min_order, max_discount, usage_limit, per_user_limit, is_active)
VALUES
  ('WELCOME50', 'flat',       50.00, 200.00, NULL,  1000, 1, TRUE),
  ('SAVE10',    'percentage', 10.00, 100.00, 50.00, NULL, 3, TRUE),
  ('FIRST20',   'flat',       20.00,  50.00, NULL,  500,  1, TRUE)
ON CONFLICT (code) DO NOTHING;
