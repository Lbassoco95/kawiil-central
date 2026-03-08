
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_temp, public
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;
