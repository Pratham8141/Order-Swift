-- Migration 008: v3 Production Bug Fixes
-- 1. Ensure ratings table exists (maps to reviews table)
-- 2. Ensure restaurants.is_open column exists (for manual open/close toggle)
-- 3. Ensure restaurants lat/lng columns exist for location filtering

-- ── 1. ratings/reviews table (already exists as reviews, adding alias-friendly columns) ─────────────
-- The reviews table already has: id, user_id, restaurant_id, order_id, rating, comment, created_at
-- No structural changes needed — submitReview API uses /reviews endpoint.

-- ── 2. is_open column on restaurants ────────────────────────────────────────────────────────────────
-- This is a manual toggle separate from the time-based open/close computation.
-- is_active is used for "restaurant is fully active on the platform".
-- is_open is used for "owner toggled accepting orders right now".
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS is_open BOOLEAN NOT NULL DEFAULT true;

-- ── 3. Location columns (already added in earlier migrations, ensure they exist) ────────────────────
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(10,7);

-- ── 4. Index for common owner order queries ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS orders_restaurant_status_idx
  ON orders(restaurant_id, status);

CREATE INDEX IF NOT EXISTS orders_restaurant_created_idx
  ON orders(restaurant_id, created_at DESC);

-- ── 5. Total reviews denormalized column on restaurants ──────────────────────────────────────────────
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS total_reviews INTEGER NOT NULL DEFAULT 0;

-- Update total_reviews from existing reviews
UPDATE restaurants r
SET total_reviews = (
  SELECT COUNT(*) FROM reviews rv WHERE rv.restaurant_id = r.id
);

-- Trigger to keep total_reviews in sync
CREATE OR REPLACE FUNCTION update_restaurant_review_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE restaurants SET
      total_reviews = total_reviews + 1,
      rating = (
        SELECT ROUND(AVG(rating)::numeric, 1)
        FROM reviews WHERE restaurant_id = NEW.restaurant_id
      )::varchar
    WHERE id = NEW.restaurant_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE restaurants SET
      total_reviews = GREATEST(total_reviews - 1, 0),
      rating = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 1)
        FROM reviews WHERE restaurant_id = OLD.restaurant_id
      )::varchar, '0')
    WHERE id = OLD.restaurant_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_restaurant_review_count ON reviews;
CREATE TRIGGER trg_restaurant_review_count
AFTER INSERT OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION update_restaurant_review_count();
