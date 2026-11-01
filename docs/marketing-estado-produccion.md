# Marketing · Estado en producción (proyecto `qppfampapbxdgednkofc`)

Actualizado: 31 oct 2026.

## Migraciones aplicadas (versión real del registro de Supabase)
| Versión en producción | Nombre | Archivo del repo |
|---|---|---|
| `20261031205319` | `marketing_modulo_base` | `supabase/migrations/20261031120000_marketing_modulo_base.sql` |
| `20261031210227` | `marketing_revocar_anon` | `supabase/migrations/20261031210000_marketing_revocar_anon.sql` |

Las versiones del registro difieren de los nombres de archivo porque se aplicaron con `apply_migration`, que asigna la hora real.
Carga del historial: ejecutada desde `tools/marketing/carga_historial.sql` con la organización `a0000000-0000-0000-0000-000000000001` («Kawiil Demo»). **Pendiente de Dirección: confirmar que es la organización de Kawiil MX.** No se ha movido ni duplicado nada.
Contenido: 48 piezas, 121 publicaciones/resultados (IG 26+5, FB 47, LI 48), 14 reglas, 1 caso de investigación, 5 casos «dato sospechoso», 3 filas de cobertura, 3 de seguidores, 42 de calibración, 1 de bitácora.

## Regla de trabajo (Dirección, 31 oct)
Toda escritura en producción (migraciones, cargas, funciones, secretos) requiere confirmación explícita de Dirección en el mismo mensaje. La migración `marketing_revocar_anon` se aplicó sin confirmación específica; es un REVOKE reversible.

## Avisos de seguridad sobre mk_* (asesor de Supabase)
Propuestas, **sin aplicar**:
1. `function_search_path_mutable`: `mk_solo_insercion` y `mk_semana_inicio` sin `search_path`. Cierre: `ALTER FUNCTION ... SET search_path = public, pg_temp` (no cambia su lógica).
2. `pg_graphql_authenticated_table_exposed`: las 13 tablas `mk_*` visibles en GraphQL para autenticados. Cierre posible: `REVOKE SELECT ON mk_* FROM authenticated` y dar acceso solo vía funciones/vistas; **rompería las pantallas que lean directo con RLS**, por lo que conviene decidirlo antes de construir la interfaz.
3. `authenticated_security_definer_function_executable`: ejecutables por autenticados `mk_cambiar_regla`, `mk_decidir_propuesta` (diseñadas así y validan `marketing_decidir` por dentro), `mk_can_view`, `mk_can_decide`, `mk_org_id` (las usan las políticas RLS: deben seguir ejecutables), y **`mk_semaforo_semana`, `mk_sembrar_reglas_v1` y `mk_recalcular_primera_publicacion`, que no deberían**. El archivo de migración decía que el semáforo era solo para `service_role`, pero en la práctica el privilegio por defecto de Supabase lo dejó abierto; `mk_sembrar_reglas_v1(p_org)` permitiría a cualquier autenticado sembrar reglas de cualquier organización. Cierre: `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` en esas tres.
4. `anon_security_definer_function_executable`: es **`mk_recalcular_primera_publicacion`** (función de disparador, `SECURITY DEFINER`, ejecutable por anon). Cierre: `REVOKE EXECUTE ON FUNCTION public.mk_recalcular_primera_publicacion() FROM PUBLIC, anon, authenticated;` (los disparadores no requieren que el rol tenga EXECUTE).
Además `mk_semana_inicio` y `mk_solo_insercion` son ejecutables por anon pero no son `SECURITY DEFINER` (no generan aviso de ese tipo).
