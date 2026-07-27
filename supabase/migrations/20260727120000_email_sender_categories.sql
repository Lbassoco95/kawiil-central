-- Categorías por remitente, CONFIRMADAS por el equipo y compartidas en la organización.
-- Cuando un usuario confirma que un remitente es SAT / Factura / Cliente / Interno /
-- Notificación, se guarda aquí y TODOS los miembros de la organización lo aprovechan:
-- de ahí en adelante los correos de ese remitente se clasifican solos en esa sección.
CREATE TABLE IF NOT EXISTS public.email_sender_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  sender_email text NOT NULL,
  -- valores alineados con las pestañas del correo: clientes | sat | facturas | interno | notificaciones
  category text NOT NULL,
  sender_name text,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, sender_email)
);

ALTER TABLE public.email_sender_categories ENABLE ROW LEVEL SECURITY;

-- Los miembros de una organización leen y escriben las categorías de SU organización.
CREATE POLICY "Org members manage sender categories" ON public.email_sender_categories
  FOR ALL
  USING (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_email_sender_categories_org
  ON public.email_sender_categories (organization_id);
