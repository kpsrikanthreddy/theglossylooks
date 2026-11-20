-- ============================================================================
-- READ-ONLY Reconciliation Audit Queries for Glossy Looks <-> SMAV Identity
-- Safe to execute anytime: SELECT queries ONLY, zero mutations.
-- ============================================================================

-- ============================================================================
-- PART A: Run in The Glossy Looks Supabase (onswigwiwuvkvoduuhxr)
-- ============================================================================

-- A0. Inspect existing production columns and legacy vw_smav_staff_auth_status definition
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('users', 'staff', 'smav_user_sync_outbox')
ORDER BY table_name, ordinal_position;

SELECT
  schemaname,
  viewname,
  definition
FROM pg_catalog.pg_views
WHERE schemaname = 'public'
  AND viewname IN ('vw_smav_staff_auth_status', 'vw_smav_user_sync_status');

-- A1. Full inventory of authoritative Admin Users (public.users) vs public.staff
SELECT
  u.id AS local_user_id,
  u.user_id AS staff_code,
  u.name AS user_name,
  u.email AS user_email,
  u.phone AS user_phone,
  u.role AS rbac_role,
  CASE
    WHEN lower(u.role) IN ('owner', 'manager') THEN 'ADMIN'
    ELSE 'POS_BILLING'
  END AS expected_smav_role,
  u.is_active AS user_active,
  u.central_auth_id AS user_central_auth_id,
  u.central_sync_status,
  u.central_sync_error,
  u.central_last_synced_at,
  s.id AS staff_id,
  s.name AS staff_name,
  s.email AS staff_email,
  s.role AS staff_job_title,
  s.is_active AS staff_active,
  s.central_auth_id AS staff_central_auth_id,
  -- Flag anomalies for manual review before running live reconciliation
  ARRAY_REMOVE(ARRAY[
    CASE WHEN u.central_auth_id IS NULL THEN 'MISSING_CENTRAL_AUTH_ID' END,
    CASE WHEN u.central_auth_id IS NOT NULL AND s.central_auth_id IS NOT NULL AND u.central_auth_id <> s.central_auth_id THEN 'USERS_VS_STAFF_UUID_MISMATCH' END,
    CASE WHEN u.central_auth_id IS NULL AND s.central_auth_id IS NOT NULL THEN 'STAFF_HAS_UUID_USERS_MISSING' END,
    CASE WHEN s.id IS NOT NULL AND lower(trim(COALESCE(u.email, ''))) <> lower(trim(COALESCE(s.email, ''))) THEN 'USERS_VS_STAFF_EMAIL_MISMATCH' END,
    CASE WHEN s.id IS NOT NULL AND COALESCE(u.is_active, true) <> COALESCE(s.is_active, true) THEN 'USERS_VS_STAFF_STATUS_MISMATCH' END,
    CASE WHEN COALESCE(trim(u.email), '') = '' OR position('@' IN COALESCE(u.email, '')) = 0 THEN 'INVALID_EMAIL' END
  ], NULL) AS local_anomalies
FROM public.users u
LEFT JOIN public.staff s ON s.user_id = u.id
ORDER BY u.created_at ASC;

-- A2. Targeted focus on named accounts under investigation
SELECT
  u.id AS local_user_id,
  u.user_id AS staff_code,
  u.name,
  u.email,
  u.phone,
  u.role AS rbac_role,
  CASE WHEN lower(u.role) IN ('owner', 'manager') THEN 'ADMIN' ELSE 'POS_BILLING' END AS expected_smav_role,
  u.is_active,
  u.central_auth_id,
  u.central_auth_status,
  u.central_last_synced_at,
  s.email AS staff_table_email,
  s.role AS staff_job_title,
  s.central_auth_id AS staff_table_central_auth_id
FROM public.users u
LEFT JOIN public.staff s ON s.user_id = u.id
WHERE
  u.name ILIKE '%renuka%'
  OR u.name ILIKE '%mounika%'
  OR u.name ILIKE '%srikanth%'
  OR u.name ILIKE '%kayidapuram%'
  OR u.name ILIKE '%sharadha%'
  OR u.name ILIKE '%srireddy%'
  OR u.email ILIKE '%renuka%'
  OR u.email ILIKE '%srireddy%'
ORDER BY u.created_at ASC;

-- A3. Detect duplicate emails, duplicate user_ids, or duplicate central_auth_ids in public.users
SELECT 'DUPLICATE_EMAIL' AS issue, lower(trim(email)) AS key_value, COUNT(*) AS row_count, array_agg(id) AS user_ids
FROM public.users
WHERE email IS NOT NULL
GROUP BY lower(trim(email))
HAVING COUNT(*) > 1
UNION ALL
SELECT 'DUPLICATE_CENTRAL_AUTH_ID' AS issue, central_auth_id::text AS key_value, COUNT(*) AS row_count, array_agg(id) AS user_ids
FROM public.users
WHERE central_auth_id IS NOT NULL
GROUP BY central_auth_id
HAVING COUNT(*) > 1
UNION ALL
SELECT 'ORPHAN_STAFF_WITHOUT_USER' AS issue, s.id::text AS key_value, 1 AS row_count, ARRAY[s.user_id] AS user_ids
FROM public.staff s
LEFT JOIN public.users u ON u.id = s.user_id
WHERE u.id IS NULL;

-- ============================================================================
-- PART B: Run in Central SMAV Supabase (qykdwswatopylzvqhgog)
-- Compare side-by-side with Part A output (zero mutations!)
-- ============================================================================
/*
SELECT
  au.id AS central_auth_id,
  au.email AS central_email,
  au.banned_until,
  p.full_name,
  p.username,
  p.is_active AS profile_active,
  ei.source AS ext_source,
  ei.external_id AS glossylooks_local_user_id,
  ou.role AS smav_outlet_role,
  ou.is_active AS outlet_membership_active
FROM auth.users au
LEFT JOIN public.smav_profiles p ON p.id = au.id
LEFT JOIN public.smav_external_identities ei
  ON ei.user_id = au.id AND lower(ei.source) = 'glossylooks'
LEFT JOIN public.smav_outlet_users ou
  ON ou.user_id = au.id
WHERE ei.source IS NOT NULL
   OR au.email ILIKE '%glossylooks%'
   OR p.full_name ILIKE '%renuka%'
   OR p.full_name ILIKE '%mounika%'
   OR p.full_name ILIKE '%srikanth%'
   OR p.full_name ILIKE '%sharadha%'
   OR p.full_name ILIKE '%srireddy%'
ORDER BY au.created_at ASC;
*/
