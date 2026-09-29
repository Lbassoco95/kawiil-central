# backup-data — respaldo de tablas de central

Función Edge que copia una lista cerrada de tablas de central a un archivo JSON en el bucket privado `backups`.

## Quién puede llamarla

| Vía | Credencial | Qué recibe |
|---|---|---|
| Tarea programada | Cabecera `x-backup-secret` con el valor de `BACKUP_CRON_SECRET` (≥32 caracteres, distinto de `CRON_SECRET`) | Solo el resumen (archivo, filas por tabla, errores). Si pide `include_data`, se ignora. |
| Una persona G4 (rol `transformador`) de la organización `BACKUP_ORGANIZATION_ID` | `Authorization: Bearer <su JWT de sesión>` | El resumen y, si pide `include_data: true`, los datos. |

Cualquier otra llamada (sin credencial, con un secreto equivocado, con el JWT de alguien que no es G4 o de un G4 de otra organización) recibe 401 o 403 **antes** de que se lea una sola tabla del volcado. Si falta `BACKUP_CRON_SECRET`, la vía de cron queda cerrada. Si falta `BACKUP_ORGANIZATION_ID`, la vía de G4 queda cerrada.

`verify_jwt` sigue en `false` (config.toml) porque la tarea programada no tiene JWT. La función valida la credencial en su propio código (`handler.ts`).

El volcado cubre **toda la base**, no solo una organización. Por eso solo la organización dueña (`BACKUP_ORGANIZATION_ID`) puede usarla.

## Qué no se respalda (A3)

**Criterio:** sale del respaldo toda tabla con alguna columna que sirva para entrar a un sistema propio o de terceros: token de acceso o de refresco, llave, contraseña, secreto, o su versión cifrada. Son reemitibles (se vuelve a conectar la cuenta) y guardarlas en un respaldo solo agrega riesgo.

Se revisaron columna por columna las 39 tablas del listado anterior. Solo dos cumplen el criterio:

| Tabla | Por qué |
|---|---|
| `microsoft_tokens` | `access_token` y `refresh_token` de Microsoft 365 de cada persona. |
| `integrations` | `config` guarda credenciales de integraciones (el `refresh_token` de Dropbox que usan `process-document` e `index-dropbox`). |

Revisadas y que **sí** se respaldan porque no guardan credenciales: `profiles` (`outlook_signature_html` es la firma del correo, no una credencial), `savio_webhook_events` (solo el cuerpo del aviso de cobranza, sin cabeceras ni firmas), `project_comments.step_key` y `tasks.phase_key` (claves de flujo, no llaves). Quedan 37 tablas.

Además, la función se salta siempre las tablas de certificados, secretos, sal y conexiones de Slack (`NEVER_BACKUP` en `handler.ts`), aunque alguien las agregue a la lista.

## El bucket `backups`

Es privado, y desde `20260929100000_backup_bucket_no_browser_read.sql` ningún rol del navegador lo lee (antes podía cualquier G4). Solo se abre con service_role, desde el Dashboard de Supabase (Storage → backups).

## Quién la llama hoy (A5)

En el repositorio **no hay ningún llamador**: ni cron (pg_cron), ni otra función, ni pantalla, ni workflow. Si alguien la llamaba desde fuera, por ejemplo un programador externo o un script, dejará de funcionar al desplegar esta versión, y eso es intencional. Revisar los registros de la función (paso 3 abajo) dice si alguien la llamaba.

### Cómo programarla (si Polo lo decide)

1. Generar un secreto de ≥32 caracteres y cargarlo en dos lugares: en Edge Functions → Secrets como `BACKUP_CRON_SECRET`, y en el Vault (SQL Editor: `SELECT vault.create_secret('<secreto>', 'backup_cron_secret');`).
2. Programarla, igual que las demás tareas del repo que usan Vault:
   ```sql
   SELECT cron.schedule('backup-data-diario', '41 8 * * *', $$
     SELECT net.http_post(
       url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/backup-data',
       headers := jsonb_build_object('Content-Type', 'application/json',
         'x-backup-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'backup_cron_secret' LIMIT 1)),
       body := '{}'::jsonb)
   $$);
   ```
   Cada corrida sube un archivo nuevo al bucket. Conviene definir cuántos se conservan (hoy no hay limpieza automática).

## Bitácora (A6)

Cada llamada, aceptada o rechazada, deja una fila en `public.backup_access_log`. Registra cuándo, resultado, motivo, vía, quién (si fue un G4), IP, navegador, si pidió datos, cuántas tablas y filas, y el archivo. **Nunca** registra el contenido del volcado. Solo la leen los G4 y nadie la puede modificar.

## Qué debe hacer Polo al desplegar

1. Crear `BACKUP_CRON_SECRET` (solo si se va a programar) y `BACKUP_ORGANIZATION_ID` (id de la organización Kawiil) en Edge Functions → Secrets.
2. Desplegar la función (`supabase functions deploy backup-data --no-verify-jwt`).
3. Revisar los registros de la función en el Dashboard (Edge Functions → backup-data → Logs e Invocations) **de antes del despliegue**. Cualquier llamada que no reconozca significa que alguien pudo haber descargado datos.
4. Si hay llamadas desconocidas: rotar los tokens de Microsoft (que cada persona vuelva a conectar su cuenta y borrar las filas de `microsoft_tokens`), rotar el `refresh_token` de Dropbox de `integrations`, y seguir el procedimiento de vulneraciones de la LFPDPPP.
5. Revisar si hay archivos en el bucket `backups` que nadie espera y borrarlos si no se necesitan.
