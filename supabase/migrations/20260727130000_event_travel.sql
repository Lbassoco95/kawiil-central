-- Trayecto (traslado) guardado por evento del calendario, por usuario.
-- Al calcular el trayecto de un evento, se persiste aquí para dibujar un bloque
-- de "traslado" antes del evento en el calendario y mantenerlo entre dispositivos.
--
-- Deploy: supabase db push

CREATE TABLE IF NOT EXISTS public.event_travel (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event_id text NOT NULL,
  origin text NOT NULL,
  destination text,
  duration_seconds integer NOT NULL,
  distance_text text,
  with_traffic boolean NOT NULL DEFAULT false,
  departure_iso text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

ALTER TABLE public.event_travel ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_travel_select_own" ON public.event_travel;
CREATE POLICY "event_travel_select_own"
  ON public.event_travel FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "event_travel_insert_own" ON public.event_travel;
CREATE POLICY "event_travel_insert_own"
  ON public.event_travel FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "event_travel_update_own" ON public.event_travel;
CREATE POLICY "event_travel_update_own"
  ON public.event_travel FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "event_travel_delete_own" ON public.event_travel;
CREATE POLICY "event_travel_delete_own"
  ON public.event_travel FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_travel TO authenticated;
GRANT ALL ON public.event_travel TO service_role;
