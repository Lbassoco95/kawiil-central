-- Sede confirmada de una actividad: bandera y proveedor que es la sede (opcional).
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS venue_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS venue_provider_id uuid
    REFERENCES public.activity_providers(id) ON DELETE SET NULL;
