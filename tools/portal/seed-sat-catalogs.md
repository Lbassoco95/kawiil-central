# Carga de catálogos SAT (`sat_catalog_entries`)

## Estrategia

1. **Semilla en migración** (`20261006160000_portal_facturacion_facturapi.sql`): unidades frecuentes + ~90 `ClaveProdServ` de servicios/contabilidad + forma/método/uso/régimen usados en el formulario.
2. **Índices**: `pg_trgm` sobre `search_text` + FTS español + RPC `portal_sat_catalog_suggest`.
3. **Carga completa** (opcional, offline):

```bash
# Desde el Anexo 20 del SAT (catCFDI_V_4_*.xls) generar CSV:
# catalog,clave,descripcion,synonyms
# c_ClaveProdServ,80131500,Servicios de contabilidad,"contabilidad|contador"

psql "$DATABASE_URL" -c "\copy public.sat_catalog_entries(catalog,clave,descripcion) FROM 'clave_prod_serv.csv' CSV HEADER"
```

Sinónimos se pueden enriquecer después:

```sql
UPDATE public.sat_catalog_entries
SET synonyms = ARRAY['contabilidad','contador']
WHERE catalog = 'c_ClaveProdServ' AND clave = '80131500';
```

## Notas

- El catálogo oficial `c_ClaveProdServ` supera las 50k filas: no embeberlo en el repo.
- La UX sugiere por similitud de texto; el usuario confirma la clave de 8 dígitos.
- Re-seed idempotente: `ON CONFLICT (catalog, clave) DO UPDATE`.
