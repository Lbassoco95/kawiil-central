-- Trigger to keep user_preferences.updated_at current on every UPDATE.
-- Without this, the prefsAreNewer check in generate-phrase would not detect
-- re-submitted questionnaire answers and stale cached phrases would be served.

CREATE OR REPLACE FUNCTION public.set_updated_at_user_preferences()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_user_preferences ON public.user_preferences;
CREATE TRIGGER set_updated_at_user_preferences
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_user_preferences();
