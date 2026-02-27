-- =============================================================================
-- Migration 007: Terms Acceptance + Reorder Support
-- Run AFTER migration 006.
-- =============================================================================

-- ─── Terms acceptance on restaurants ─────────────────────────────────────────
-- Tracks when a restaurant owner accepted the platform Terms & Conditions.
-- NULL = not accepted yet. Non-null = timestamp of acceptance.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP;

-- ─── Verification query ───────────────────────────────────────────────────────
-- SELECT id, name, terms_accepted_at FROM restaurants LIMIT 5;
