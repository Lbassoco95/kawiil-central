-- Migration: ai_task_events - streaming en vivo de progreso de tareas IA
-- Propósito: tabla que recibe INSERTs de la VM mientras un agente trabaja,
--            y el frontend se suscribe via postgres_changes (Realtime).
-- Parte del Bloque B1 del plan v6 de la plataforma de agentes Kawiil.

-- Tabla
CREATE TABLE IF NOT EXISTS public.ai_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  agent_id uuid,
  user_id uuid,
  organization_id uuid NOT NULL,
  event_type text NOT NULL,
  sequence integer NOT NULL,
  progress integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_ai_task_events_task_id
  ON public.ai_task_events(task_id);

CREATE INDEX IF NOT EXISTS idx_ai_task_events_task_sequence
  ON public.ai_task_events(task_id, sequence);

CREATE INDEX IF NOT EXISTS idx_ai_task_events_organization_id
  ON public.ai_task_events(organization_id);

CREATE INDEX IF NOT EXISTS idx_ai_task_events_created_at
  ON public.ai_task_events(created_at DESC);

-- Habilitar RLS
ALTER TABLE public.ai_task_events ENABLE ROW LEVEL SECURITY;

-- Política SELECT: usuarios autenticados pueden ver eventos de tareas
-- de su misma organización (derivada del usuario via profiles).
CREATE POLICY "Users can view events of their org"
  ON public.ai_task_events
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.profiles
      WHERE user_id = auth.uid()
    )
  );

-- Política INSERT: solo service_role puede insertar (la VM usa service_role).
-- NO creamos política de INSERT para authenticated — esto los bloquea.

-- Política UPDATE/DELETE: bloqueadas (no creamos políticas) para que
-- nadie pueda modificar eventos una vez escritos. Solo service_role
-- tiene bypass completo.

-- Agregar a la publicación de Realtime (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ai_task_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_task_events;
  END IF;
END $$;

-- Comentarios de documentación
COMMENT ON TABLE public.ai_task_events IS
  'Eventos de progreso en tiempo real emitidos por la VM durante la ejecución de tareas de agentes IA. El frontend se suscribe vía postgres_changes filtrando por task_id para mostrar progreso en vivo en la ventana del agente.';

COMMENT ON COLUMN public.ai_task_events.event_type IS
  'Tipo de evento. Valores esperados: started, file_downloaded, file_processing, thinking, progress_update, result_ready, completed, failed, warning. Sin CHECK constraint por ahora — se endurecerá cuando el set de tipos sea estable.';

COMMENT ON COLUMN public.ai_task_events.sequence IS
  'Número de secuencia del evento dentro de la tarea. Garantiza orden correcto en la UI aunque created_at coincida en el mismo milisegundo.';

COMMENT ON COLUMN public.ai_task_events.progress IS
  'Progreso numérico 0-100 cuando aplica. NULL para eventos sin métrica de progreso.';

COMMENT ON COLUMN public.ai_task_events.payload IS
  'Datos variables según event_type. Ejemplos: {"file_name": "contrato.pdf", "pages": 15}, {"message": "Analizando cláusulas"}, {"artifact_id": "uuid"}.';
