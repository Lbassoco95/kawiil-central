# Dropbox para los agentes (solo lectura)

Los agentes leen los documentos de los clientes en Dropbox **sin guardar ninguna credencial de Dropbox en la VM**: pasan por la función `agente-dropbox`, que reutiliza la conexión de equipo que Kawiil Central ya tiene (token, app y contexto de equipo viven solo en Supabase).

## Cómo funciona
- La VM (`kawiil-agents`) llama a `agente-dropbox` con la llave de servicio de Supabase **y** un secreto compartido (`X-Kawiil-Bridge-Token` = `KAWIIL_BRIDGE_TOKEN`, comparado en tiempo constante). Sin ese secreto responde 401.
- Acciones: `probar` (diagnóstico), `listar` (carpeta) y `leer` (contenido de un archivo). Solo `get_metadata`, `list_folder` y `download`: no sube, mueve, borra ni comparte nada.
- **Alcance:** solo lo que cuelga de las carpetas raíz autorizadas (por defecto `/Kawiil Mx/CLIENTES`; se cambia con el secreto opcional `DROPBOX_AGENTES_RAICES`, varias separadas por `;`). Antes de listar o leer se pide a Dropbox la metadata del elemento y se decide con **su** `path_lower`; lo que quede fuera, o no traiga ruta, se rechaza. Nunca se confía en la ruta que manda quien pregunta, y la raíz de todo Dropbox no se acepta.
- Contenido: máximo 8 MB, solo pdf, docx, xlsx, texto e imágenes. La VM lo convierte a texto con los mismos lectores de adjuntos que ya usa.
- Se registra la acción y el id; nunca el contenido ni los nombres de archivo.

## Dar acceso a un agente
Agentes → **Documentos** → elige el agente → «Dropbox (clientes)» → nombre → Agregar. Sirve para cualquier agente consultable activo (no solo los del constructor): `fuentes_docs` es una clave aparte que no toca el prompt del agente.

## Puesta en marcha (una vez)
1. Generar un secreto: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.
2. Supabase → Edge Functions → Secrets: `KAWIIL_BRIDGE_TOKEN` = ese valor.
3. En `louis-prod`, en `server/.env`: `KAWIIL_BRIDGE_TOKEN=` el mismo valor; reiniciar `kawiil-hq`.
4. Comprobar con `docs_cli.py dropbox-probar` (ver `FUENTES-DOCUMENTOS.md` en kawiil-agents).
