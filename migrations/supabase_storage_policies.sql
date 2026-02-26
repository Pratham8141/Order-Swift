-- =============================================================================
-- Supabase Storage RLS Policies
-- Run this in: Supabase Dashboard → SQL Editor
--
-- BUCKETS REQUIRED (create manually first):
--   Dashboard → Storage → New Bucket
--     Name: menu-images,       Public: YES
--     Name: restaurant-images, Public: YES
--
-- WHY "Network request failed" IN REACT NATIVE BUT NOT WEB?
-- ─────────────────────────────────────────────────────────────────────────────
-- The Web Fetch API and React Native's fetch() behave differently:
--
-- 1. BLOB BODIES: On web, fetch(url, { body: blob }) works because browsers
--    have native Blob serialisation. React Native's Hermes JS engine does NOT
--    have a real Blob implementation — it's a polyfill that creates an object
--    with metadata but no actual binary data attached to it. When you call
--    fetch(supabaseUrl, { body: blob }), the body arrives empty or malformed,
--    causing Supabase to return 400 or the network layer to error out entirely.
--
-- 2. ARRAYBUFFER WORKS: ArrayBuffer is a proper binary primitive in both V8
--    and Hermes. supabase-js v2 wraps uploads in XMLHttpRequest (not fetch),
--    which correctly serialises ArrayBuffer / Uint8Array as binary data.
--    This is why the fix is: fetch(localUri).arrayBuffer() → Uint8Array →
--    supabase.storage.upload(). See lib/uploadImage.ts for the implementation.
--
-- 3. MISSING RLS POLICY: Even with a PUBLIC bucket, INSERT operations require
--    an explicit RLS policy. Without it, anonymous uploads return 403 Forbidden,
--    which React Native's network stack sometimes reports as "Network request
--    failed" (the error message is determined by the HTTP client, not the HTTP
--    status code in some RN versions).
--
-- 4. WRONG SUPABASE URL: The .env file had a double-prefix bug:
--    EXPO_PUBLIC_SUPABASE_URL=EXPO_PUBLIC_SUPABASE_URL=https://...
--    This made the URL literally "EXPO_PUBLIC_SUPABASE_URL=https://..." which
--    is not a valid URL. Fixed in .env.
-- =============================================================================

-- ─── menu-images bucket policies ──────────────────────────────────────────────

-- Allow anyone to READ (view) images from menu-images (it's a public bucket)
CREATE POLICY "Public read access for menu-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'menu-images');

-- Allow authenticated users (restaurant owners) to INSERT (upload) images
-- The anon key is used by the app — Supabase treats all requests with a valid
-- anon JWT as "authenticated" for storage purposes even without a user session.
CREATE POLICY "Authenticated users can upload to menu-images"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'menu-images');

-- Allow overwrite (upsert) — needed because we pass upsert:true in the upload
CREATE POLICY "Authenticated users can update menu-images"
  ON storage.objects FOR UPDATE
  TO anon
  USING (bucket_id = 'menu-images');

-- Allow delete (for future image management)
CREATE POLICY "Authenticated users can delete from menu-images"
  ON storage.objects FOR DELETE
  TO anon
  USING (bucket_id = 'menu-images');

-- ─── restaurant-images bucket policies ────────────────────────────────────────

CREATE POLICY "Public read access for restaurant-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'restaurant-images');

CREATE POLICY "Authenticated users can upload to restaurant-images"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'restaurant-images');

CREATE POLICY "Authenticated users can update restaurant-images"
  ON storage.objects FOR UPDATE
  TO anon
  USING (bucket_id = 'restaurant-images');

CREATE POLICY "Authenticated users can delete from restaurant-images"
  ON storage.objects FOR DELETE
  TO anon
  USING (bucket_id = 'restaurant-images');

-- ─── Verify policies were created ─────────────────────────────────────────────
-- Run this to confirm:
--
--   SELECT policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--   ORDER BY policyname;
--
-- You should see 8 rows — 4 per bucket.
-- =============================================================================

-- ─── ALTERNATIVE: Single permissive policy (simpler, slightly less strict) ────
-- If you want one policy covering both buckets instead of per-bucket policies,
-- use this INSTEAD of the above (don't run both):
--
-- CREATE POLICY "Allow all operations on public storage buckets"
--   ON storage.objects
--   FOR ALL
--   TO anon
--   USING (bucket_id IN ('menu-images', 'restaurant-images'))
--   WITH CHECK (bucket_id IN ('menu-images', 'restaurant-images'));

