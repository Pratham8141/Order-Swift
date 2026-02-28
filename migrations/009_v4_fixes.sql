-- Migration 009: v4 Production Bug Fixes
-- 1. Ensure wallet_transactions reference_id column exists
-- 2. Ensure orders has preparation_time column (per-order not restaurant-level)
-- 3. Fix cancel rules: only pending/paid can be cancelled by user
-- 4. Add index for wallet transactions by user+type for refund queries

-- ── 1. Ensure wallet_transactions.reference_id exists ────────────────────────
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS reference_id UUID REFERENCES orders(id) ON DELETE SET NULL;

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS balance_after DECIMAL(10,2);

-- ── 2. Ensure orders.preparation_time column exists ──────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS preparation_time INTEGER DEFAULT 20;

-- ── 3. Index for wallet transactions by user ──────────────────────────────────
CREATE INDEX IF NOT EXISTS wallet_txn_user_idx
  ON wallet_transactions(user_id, created_at DESC);

-- ── 4. Ensure is_open defaults to true for existing restaurants ───────────────
UPDATE restaurants SET is_open = true WHERE is_open IS NULL;

-- ── 5. Ensure total_reviews column exists ─────────────────────────────────────
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS total_reviews INTEGER NOT NULL DEFAULT 0;
