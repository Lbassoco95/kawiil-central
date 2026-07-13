-- =============================================================
-- RH — Nueva modalidad de jornada "Con cliente".
-- Se agrega al enum rh_work_mode para poder distinguir "con cliente"
-- de "diligencia / juzgado" (antes "de comisión", el cajón general de
-- salidas). Idempotente: no falla si el valor ya existe.
-- =============================================================
ALTER TYPE public.rh_work_mode ADD VALUE IF NOT EXISTS 'client';
