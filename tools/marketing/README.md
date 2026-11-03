# Carga del historial de Marketing

`generar_carga.py` lee el Calendario Maestro (.xlsx, no se versiona) y escribe `carga_historial.sql`.
`carga_historial.sql` ya generado: sustituir `__ORG__` por el id de la organización de Kawiil antes de correrlo.
Requiere la migración `supabase/migrations/20261031120000_marketing_modulo_base.sql`.
Solo escribe en tablas `mk_*`. No consulta Metricool.
