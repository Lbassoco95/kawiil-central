-- Alinear tareas de cumplimiento existentes con fases del proyecto: copiar categoría de plantilla a phase_key.
UPDATE public.tasks AS t
SET phase_key = ctt.category
FROM public.compliance_task_templates AS ctt
WHERE t.compliance_template_id = ctt.id
  AND t.area = 'cumplimiento'
  AND t.phase_key IS NULL;
