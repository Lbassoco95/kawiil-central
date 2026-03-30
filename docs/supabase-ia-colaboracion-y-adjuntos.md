# Supabase: proyectos IA colaborativos, memoria `/team/` y adjuntos en chat

Este documento describe qué se desplegó en el proyecto **Kawiil Central** (`qppfampapbxdgednkofc`) y cómo volver a aplicarlo o comprobar que todo está bien.

## Qué incluye la migración `20260330120000_ai_collab_chat_attachments.sql`

- **Tablas**: `ai_project_members`, `ai_project_shared_memories`
- **Columna** `chat_messages.attachments` (JSONB, lista de archivos del mensaje)
- **Bucket de Storage**: `chat-uploads` (privado; rutas `{organization_id}/{user_id}/...`)
- **Función RPC**: `get_my_ai_projects()` — devuelve proyectos de IA donde el usuario es dueño o miembro
- **RLS**: acceso a proyectos compartidos y documentos según membresía; se retira el listado amplio “toda la org” en `ai_projects` para SELECT
- **`document_chunks`**: tipo de fuente `shared_memory` para embeddings de memoria de equipo

## Edge Function `ai-chat`

- Valida que el `ai_project_id` del body pertenezca a la organización del usuario y que sea dueño o miembro.
- Acepta **`attachmentRefs`** (archivos ya subidos a `chat-uploads`) y arma el contexto multimodal (imagen, PDF, Excel, SQLite, texto).
- Memoria de equipo vía tool **`memory`** en rutas bajo **`/team/`** (además de **`/memories/`** personal).

## Comandos desde la raíz del repo

Requisitos: [Supabase CLI](https://supabase.com/docs/guides/cli) instalado y proyecto enlazado (`supabase link`).

```bash
# 1) Aplicar migraciones pendientes al proyecto remoto enlazado
supabase db push --linked --yes

# 2) Desplegar la función de chat (obligatorio tras cambiar index.ts)
supabase functions deploy ai-chat --project-ref qppfampapbxdgednkofc
```

Si usas otro proyecto, sustituye `--project-ref` y revisa `.cursor/rules/supabase-config.mdc` / `supabase/config.toml` para no apuntar al ID equivocado.

## Cómo comprobar en el Dashboard de Supabase

1. **Database → Migrations** (o **Schema Visualizer**): debe figurar la migración `20260330120000` o las tablas nuevas.
2. **Table Editor**: existen `ai_project_members` y `ai_project_shared_memories`.
3. **Storage → Buckets**: existe **`chat-uploads`** (no público).
4. **Database → Functions** (Postgres): existe **`get_my_ai_projects`**.
5. **Edge Functions**: **`ai-chat`** con fecha de despliegue reciente.

### SQL rápido (SQL Editor)

```sql
-- Tablas y bucket
SELECT to_regclass('public.ai_project_members') AS members,
       to_regclass('public.ai_project_shared_memories') AS shared_memories;

SELECT id, name, public FROM storage.buckets WHERE id = 'chat-uploads';

-- RPC (debe existir)
SELECT proname FROM pg_proc
WHERE proname = 'get_my_ai_projects' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
```

## Si “no lo ves” en Supabase

| Síntoma | Qué revisar |
|--------|-------------|
| No ves tablas nuevas | ¿Estás en el proyecto **qppfampapbxdgednkofc**? ¿Ejecutaste `supabase db push --linked` desde este repo? |
| El chat falla al adjuntar | ¿Existe el bucket `chat-uploads` y las políticas de Storage? ¿Redeploy de `ai-chat`? |
| La app no lista proyectos compartidos | Migración aplicada + RPC `get_my_ai_projects` + usuario invitado en `ai_project_members` |
| Lovable / otro entorno | Variables `.env` deben apuntar a la misma URL de Supabase que este proyecto |

## Git y el código de la feature

Los cambios de aplicación y la migración viven en el repositorio (commit tipo `feat(ai): colaboración en proyectos IA...`). **Supabase Dashboard no muestra commits de Git**: ahí solo verás el resultado de migraciones y despliegues de funciones. Para ver el código en GitHub/GitLab hay que hacer **`git push`**.

## Referencia del proyecto

- **Project ID**: `qppfampapbxdgednkofc`
- **Dashboard**: `https://supabase.com/dashboard/project/qppfampapbxdgednkofc`
