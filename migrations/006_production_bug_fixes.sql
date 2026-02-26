-- =============================================================================
-- Migration 006: Production Bug Fixes
-- Run AFTER migration 005.
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).
-- =============================================================================

-- ─── FIX 1: wallet_amount_used column ─────────────────────────────────────────
-- This was added in 005_wallet_coupons.sql but listed here for safety.
-- If migration 005 was already run, this is a no-op.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wallet_amount_used DECIMAL(10,2) DEFAULT 0.00;

-- ─── FIX 2: Idempotency partial index ─────────────────────────────────────────
-- The Drizzle schema generates:
--   UNIQUE (user_id, idempotency_key)
-- But in PostgreSQL, NULL != NULL in unique indexes. This means two rows with
-- (same_user, NULL) would BOTH be inserted — allowing unlimited duplicate orders
-- when no idempotency key is provided.
--
-- The correct fix is a PARTIAL unique index that only enforces uniqueness when
-- idempotency_key IS NOT NULL (NULL rows are ignored entirely).
--
-- Drop the Drizzle-generated index (if it exists) and replace with partial.
DROP INDEX IF EXISTS orders_idempotency_idx;
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_partial_idx
  ON orders(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── FIX 3: Coupon code uppercase enforcement at DB level ─────────────────────
-- Ensures codes stored in the DB are always uppercase regardless of how they
-- were inserted, making lookups case-insensitive by default.
UPDATE coupons SET code = UPPER(code) WHERE code != UPPER(code);

-- Add check constraint to prevent lowercase codes going forward
ALTER TABLE coupons
  DROP CONSTRAINT IF EXISTS coupons_code_uppercase;
ALTER TABLE coupons
  ADD CONSTRAINT coupons_code_uppercase
  CHECK (code = UPPER(code));

-- ─── FIX 4: wallet_transactions reference_id should allow NULL ────────────────
-- The column was created without a NOT NULL constraint (correct) but some
-- INSERT paths were passing undefined instead of NULL. This is safe to confirm.
ALTER TABLE wallet_transactions
  ALTER COLUMN reference_id DROP NOT NULL;

-- ─── FIX 5: orders table — ensure coupon_code column exists ───────────────────
-- In case migration 005 partially failed, ensure this column exists.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50);

-- ─── DIAGNOSTICS: Run these SELECT statements to verify DB health ─────────────
-- (These are comments — not executed. Copy/paste into Supabase SQL editor.)
--
-- 1. Check all columns on orders table:
--    SELECT column_name, data_type, column_default, is_nullable
--    FROM information_schema.columns
--    WHERE table_name = 'orders'
--    ORDER BY ordinal_position;
--
-- 2. Check all indexes on orders table:
--    SELECT indexname, indexdef
--    FROM pg_indexes
--    WHERE tablename = 'orders';
--
-- 3. Check wallets table exists:
--    SELECT COUNT(*) FROM wallets;
--
-- 4. Check coupons:
--    SELECT code, type, value, is_active, used_count FROM coupons;
--
-- 5. Verify enum types:
--    SELECT typname, enumlabel FROM pg_enum
--    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
--    WHERE typname IN ('order_status', 'payment_status', 'transaction_type', 'coupon_type')
--    ORDER BY typname, enumsortorder;

