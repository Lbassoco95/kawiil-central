-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260928150100_portal_rate_limits.sql (solo huellas temporales; nada que conservar).
DROP FUNCTION IF EXISTS public.portal_rate_limit_hit(text, text, int, int);
DROP TABLE IF EXISTS public.portal_rate_limits;
