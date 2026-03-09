
-- Add payroll_type column and migrate data from has_payroll
ALTER TABLE public.clients ADD COLUMN payroll_type text DEFAULT NULL;

-- Migrate existing data: has_payroll=true becomes 'nomina'
UPDATE public.clients SET payroll_type = 'nomina' WHERE has_payroll = true;

-- Drop old column
ALTER TABLE public.clients DROP COLUMN has_payroll;
