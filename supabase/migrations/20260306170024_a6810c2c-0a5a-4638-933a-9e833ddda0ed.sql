-- Add new values to service_area enum
ALTER TYPE public.service_area ADD VALUE IF NOT EXISTS 'gestoria';
ALTER TYPE public.service_area ADD VALUE IF NOT EXISTS 'constitucion_nacional';