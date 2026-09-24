# Smoke manual — MVP contratos onboarding

## Prerrequisito

Aplicar en el proyecto Supabase `qppfampapbxdgednkofc`:

1. `supabase/migrations/20260924120000_contract_engagements_mvp.sql`
2. `supabase/migrations/20260924120100_contract_templates_seed.sql`

(SQL Editor o `supabase db push` con acceso al proyecto.)

## Flujo Backoffice (slice principal)

1. En Pipeline, mover un lead a etapa **convertido** (persona moral / servicios legal+contabilidad o bundle Backoffice).
2. Abrir ficha del lead → panel **Onboarding de contrato** → **Iniciar Backoffice (persona moral)**.
3. Copiar el link `/contrato/:token` y abrirlo en incógnito (sin login).
4. Completar wizard (razón social, RFC, plan 01/02/03, descuento opcional). Guardar.
5. En la vista staff (`/pipeline/leads/:id/contrato`), verificar que los mismos datos aparecen (dual fill).
6. **Generar contrato** → **Descargar HTML** o **Imprimir / PDF**.
7. (Fuera de Kawiil) firmar en plataforma externa.
8. **Confirmar que ya se firmó** → debe crear `clients` + proyectos `legal` y `contabilidad`.
9. Abrir `/clientes/:id` y verificar proyectos.

## Softlanding (mismo schema)

1. Lead convertido con servicio softlanding → **Iniciar Softlanding**.
2. Completar denominaciones + fees (defaults editables).
3. Generar / descargar / confirmar → cliente + proyecto softlanding.
4. Items `caratula_a2`, `anexo_b/c/d` quedan `pending` (stubs D11).

## Dos procesos en paralelo (D9)

Iniciar Softlanding **y** Backoffice en el mismo lead; dos links, dos confirmaciones.

## Tests automáticos

```bash
npm run test -- --run src/lib/contractMerge.test.ts
```
