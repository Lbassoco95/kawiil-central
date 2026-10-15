-- Rollback de supabase/migrations/20261015120000_mtg_meetings_archived_at.sql
-- Pierde la marca de archivado (las juntas vuelven a verse); no toca su contenido.
ALTER TABLE public.mtg_meetings DROP COLUMN IF EXISTS archived_at;
