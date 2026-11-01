# Marketing · Secretos de Metricool para el proyecto de Kawiil Central

Proyecto de Supabase: `qppfampapbxdgednkofc`. Solo se piden **nombres**; los valores los carga quien administra la cuenta de Metricool. Nunca en el chat, el repositorio ni la documentación.

## Variables que necesita el conector de solo lectura (Entrega 2)

| Variable | Qué es |
|---|---|
| `METRICOOL_USER_TOKEN` | Token de la API de Metricool de la cuenta |
| `METRICOOL_USER_ID` | Identificador de usuario de Metricool |
| `METRICOOL_BLOG_ID` | Identificador de la marca (blog) de Kawiil MX en Metricool |

Los nombres son decisión nuestra. Qué llama Metricool a cada dato y cómo se envía (cabeceras o parámetros) se confirma contra su documentación en la Entrega 2, antes de escribir código.

## Cómo cargarlas (CLI de Supabase)

Evita escribir los valores en la línea de comandos: quedarían en el historial del shell. Se usa un archivo temporal:

```bash
umask 077
cat > metricool.env <<'ENVEOF'
METRICOOL_USER_TOKEN=<pegar el valor aquí>
METRICOOL_USER_ID=<pegar el valor aquí>
METRICOOL_BLOG_ID=<pegar el valor aquí>
ENVEOF
```

```bash
supabase secrets set --env-file ./metricool.env --project-ref qppfampapbxdgednkofc
```

```bash
rm -f ./metricool.env
```

Verificar que quedaron (muestra nombres, no valores):

```bash
supabase secrets list --project-ref qppfampapbxdgednkofc | grep METRICOOL
```

No agregar `metricool.env` al control de versiones.
