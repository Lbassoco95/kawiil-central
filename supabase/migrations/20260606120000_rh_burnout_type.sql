-- RH — nuevo tipo de ausencia: día de burnout.
-- (El valor del enum se agrega en su propia migración para poder usarlo en
--  funciones/triggers de migraciones posteriores.)
ALTER TYPE public.rh_absence_type ADD VALUE IF NOT EXISTS 'burnout';
