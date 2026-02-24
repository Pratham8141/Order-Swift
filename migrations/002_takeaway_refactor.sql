-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — Takeaway refactor
-- Run once against the existing database.
-- Safe to re-run: each statement uses IF EXISTS / IF NOT EXISTS guards.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. restaurants table — remove delivery_fee, rename delivery_time
-- ══════════════════════════════════════════════════════════════════════════════

-- Rename delivery_time → preparation_time (how long to prepare, not deliver)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'restaurants' AND column_name = 'delivery_time'
  ) THEN
    ALTER TABLE restaurants RENAME COLUMN delivery_time TO preparation_time;
  END IF;
END $$;

-- Remove delivery_fee (takeaway has no delivery charge)
ALTER TABLE restaurants DROP COLUMN IF EXISTS delivery_fee;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. orders table — strip delivery fields, rename estimated_time, add new cols
-- ══════════════════════════════════════════════════════════════════════════════

-- Remove delivery-only columns
ALTER TABLE orders DROP COLUMN IF EXISTS address_id;
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_address;
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_fee;
ALTER TABLE orders DROP COLUMN IF EXISTS tax_amount;

-- Rename estimated_time → preparation_time
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'estimated_time'
  ) THEN
    ALTER TABLE orders RENAME COLUMN estimated_time TO preparation_time;
  END IF;
END $$;

-- Add coupon_code placeholder (nullable — logic not implemented yet)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code  VARCHAR(50);

-- Add pickup_name (who will collect the order)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_name  VARCHAR(100);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. order_status enum — add takeaway statuses, remove delivery ones
--    PostgreSQL does not support removing enum values, so we add the new
--    values and leave the old ones. The application layer will simply never
--    transition to out_for_delivery / delivered on new orders.
--    To fully clean up, recreate the type (requires a brief table lock).
-- ══════════════════════════════════════════════════════════════════════════════

-- Add new takeaway statuses if they don't already exist
DO $$ BEGIN
  BEGIN
    ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'ready';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'collected';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Backfill: set discount_amount default on rows that have NULL
-- ══════════════════════════════════════════════════════════════════════════════
UPDATE orders SET discount_amount = 0.00 WHERE discount_amount IS NULL;
ALTER TABLE orders ALTER COLUMN discount_amount SET DEFAULT '0.00';
ALTER TABLE orders ALTER COLUMN discount_amount SET NOT NULL;

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────────
-- Verification queries (run manually to confirm migration succeeded):
-- ──────────────────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'orders'   ORDER BY ordinal_position;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'restaurants' ORDER BY ordinal_position;
-- SELECT enum_range(NULL::order_status);
