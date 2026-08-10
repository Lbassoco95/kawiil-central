# Integración Búho Legal — Monitoreo de expedientes

Conecta los juicios (`projects.area = 'juicios'`) con la **API EXPEDIENTES** de Búho
Legal (`https://monitoreo.buholegal.com/api/v1/`) para traer automáticamente los
**acuerdos** (actuaciones del juzgado) de cada expediente.

## Piezas

| Pieza | Ruta |
|-------|------|
| Migración (tablas + RLS) | `supabase/migrations/20260810120000_buho_monitoreo.sql` |
| Cliente compartido (auth + token cache) | `supabase/functions/_shared/buhoClient.ts` |
| Edge function proxy (catálogos, vincular, sincronizar) | `supabase/functions/buho-proxy/` |
| Edge function cron (sync diario + notificaciones) | `supabase/functions/buho-sync-acuerdos/` |
| Hook front | `src/hooks/useBuhoMonitoring.ts` |
| UI en el expediente | `src/components/projects/BuhoMonitoringCard.tsx` (montada en `LawsuitDashboard`) |

Tablas nuevas: `buho_auth` (cache token), `buho_expedientes` (mapeo juicio↔expediente),
`buho_acuerdos` (feed de acuerdos). Todas org-scoped por RLS. Nada de esto toca otros módulos.

## Despliegue (lado Kawiil / Supabase)

1. **Aplicar la migración**: `supabase db push` (proyecto `qppfampapbxdgednkofc`).
2. **Regenerar tipos**: regenerar `src/integrations/supabase/types.ts` para incluir las
   tablas `buho_*` (el hook usa un acceso sin tipar mientras tanto; al regenerar puede
   tiparse fuerte).
3. **Cargar secretos** de las funciones (NUNCA en el repo):
   ```
   supabase secrets set BUHO_EMAIL="usuario@despacho.mx" BUHO_PASSWORD="••••"
   # opcional: BUHO_BASE_URL, CRON_SECRET
   ```
4. **Desplegar funciones**:
   ```
   supabase functions deploy buho-proxy
   supabase functions deploy buho-sync-acuerdos --no-verify-jwt
   ```
5. **Programar el cron** (diario) que invoca `buho-sync-acuerdos` con el header
   `x-cron-secret: <CRON_SECRET>`. Respeta el `limite_consultas_diarias` del plan
   (una consulta por organización por corrida).

## Mapeo de datos

| Juicio (lawsuit_details) | Búho |
|--------------------------|------|
| `jurisdiction` cdmx / edomex / federal | `entidad` cdmx / estado_mexico / federal |
| `case_number` | `expediente` |
| `court` (texto) | `juzgado_id` (se elige del catálogo `/juzgados/{entidad}/` al vincular) |
| `lawsuit_type` | `asunto` |
| (federal) | `tipo_expediente` (requerido solo en federal) |

## Flujo

1. En el expediente, **Vincular monitoreo** → elige entidad (precargada de la rama),
   juzgado (catálogo), nº de expediente y, si es federal, `tipo_expediente` → crea el
   expediente en Búho y guarda el mapeo.
2. El cron diario (o el botón **Sincronizar**) consulta `/mis-acuerdos/`, guarda los
   acuerdos nuevos (dedup por índice único) y **notifica al responsable** del juicio.
3. Los acuerdos se muestran en la tarjeta "Monitoreo Búho Legal" del expediente.

## Notas / pendientes de confirmar con Búho

- **Límites del plan**: `limite_expedientes` y `limite_consultas_diarias` (endpoint
  `GET /cuenta/estado/`) definen cuántos juicios se pueden monitorear y la cadencia.
- **Estado de México**: la entidad `estado_mexico` aparece como soportada; confirmar que
  el `create/{entidad}/` la acepta igual que federal/cdmx.
- **v1**: los acuerdos solo se muestran + notifican. Auto-crear términos/tareas desde un
  acuerdo (audiencia/requerimiento) queda como mejora posterior.
