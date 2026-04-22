-- Notificación in-app al completar o fallar tarea de agente (kawiil-agents → ai_task_events).
-- Usa useNotificationDelivery + deep link a /asistente?conversation=...

CREATE OR REPLACE FUNCTION public.notify_on_ai_task_event_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv_id text;
  org_id uuid;
  uid uuid;
  task_title text;
  ntype text;
  ntitle text;
  nbody text;
BEGIN
  IF NEW.event_type IS DISTINCT FROM 'completed' AND NEW.event_type IS DISTINCT FROM 'failed' THEN
    RETURN NEW;
  END IF;

  SELECT
    (at.input_context->>'conversation_id'),
    at.organization_id,
    coalesce(NEW.user_id, at.created_by),
    at.title
  INTO conv_id, org_id, uid, task_title
  FROM public.agent_tasks at
  WHERE at.id = NEW.task_id;

  IF conv_id IS NULL OR conv_id = '' OR uid IS NULL OR org_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = uid) THEN
    RETURN NEW;
  END IF;

  IF NEW.event_type = 'failed' THEN
    ntype := 'agent_task_failed';
    ntitle := 'Tarea de agente con error';
  ELSE
    ntype := 'agent_task_completed';
    ntitle := 'Tarea de agente completada';
  END IF;

  nbody := left(
    coalesce(nullif(trim(task_title), ''), 'Ver resultado en el chat'),
    500
  );

  INSERT INTO public.notifications (
    user_id,
    organization_id,
    title,
    body,
    type,
    entity_type,
    entity_id,
    is_read
  ) VALUES (
    uid,
    org_id,
    ntitle,
    nbody,
    ntype,
    'asistente',
    conv_id,
    false
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_ai_task_events_notify_completion ON public.ai_task_events;

CREATE TRIGGER tr_ai_task_events_notify_completion
  AFTER INSERT ON public.ai_task_events
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_ai_task_event_finished();

COMMENT ON FUNCTION public.notify_on_ai_task_event_finished() IS
  'Crea fila en notifications al completed/failed en ai_task_events; entity_id=conversation_id para deep link.';
