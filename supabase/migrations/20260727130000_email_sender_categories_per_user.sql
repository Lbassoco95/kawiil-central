-- Cambia las categorías por remitente de "compartidas por organización" a POR USUARIO:
-- cada quien clasifica sus propias cuentas; el backend lo guarda y de ahí en adelante
-- los correos de ese remitente se clasifican solos EN SU bandeja, sin repetir la acción.
-- La tabla se creó en la migración anterior y aún no tiene datos, así que se redefine.
DROP TABLE IF EXISTS public.email_sender_categories;

CREATE TABLE public.email_sender_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sender_email text NOT NULL,
  -- clientes | sat | facturas | interno | notificaciones
  category text NOT NULL,
  sender_name text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (user_id, sender_email)
);

ALTER TABLE public.email_sender_categories ENABLE ROW LEVEL SECURITY;

-- Cada usuario gestiona SOLO sus propias categorías.
CREATE POLICY "Users manage own sender categories" ON public.email_sender_categories
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_email_sender_categories_user
  ON public.email_sender_categories (user_id);
