-- Finanzas: la gestión (gastos de toda la organización, bancos y caja, compromisos, terceros, planeación)
-- queda solo para el rol transformador. Ya no depende de célula, de rol referente ni del interruptor del módulo.
-- Los perfiles administrativos / auxiliares se agregarán aquí cuando se creen esos tipos de usuario.
-- Quien no tiene acceso sigue pudiendo crear y ver sus propias solicitudes de gasto (política "Users see own expenses").

CREATE OR REPLACE FUNCTION public.has_finance_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'transformador'
  );
$function$;
