-- Lógica de formulario para plantillas contables:
--   * En Envío de declaración anual, `saldo_favor` y `a_pagar` son
--     mutuamente excluyentes (el resultado de la declaración es UNO:
--     saldo a favor o saldo a pagar). Se agrupan en `exclusive_group`
--     = "resultado_anual" para que el picker los muestre bajo un solo
--     selector "¿Qué aplica?".
--   * `clabe` sólo tiene sentido cuando hay saldo a favor con devolución,
--     así que se marca con `depends_on = "saldo_favor"` y el picker la
--     oculta cuando `saldo_favor` está inactiva.
--
-- Idempotente: se sobreescribe completo el array `variables` de la
-- plantilla anual en cada organización.

UPDATE public.email_templates
SET variables = '[
      {"name":"razon_social","label":"Razón social","type":"text","bold":false,"required":true},
      {"name":"saldo_favor","label":"Saldo a favor","type":"currency","bold":true,"required":false,"exclusive_group":"resultado_anual"},
      {"name":"a_pagar","label":"Monto a pagar","type":"currency","bold":true,"required":false,"exclusive_group":"resultado_anual"},
      {"name":"clabe","label":"CLABE bancaria para devolución","type":"text","bold":true,"required":false,"depends_on":"saldo_favor"}
    ]'::jsonb,
    updated_at = now()
WHERE scope = 'accounting' AND category = 'envio_anuales';
