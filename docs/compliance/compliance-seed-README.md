# Kawiil OS — Seed `compliance_entity_types` + `compliance_task_templates`

Inventario estructurado de obligaciones de cumplimiento por tipo de entidad, listo para alimentar el botón **"Generar tareas de cumplimiento"** del módulo Compliance.

---

## Archivos del paquete

| Archivo | Para qué sirve |
|---|---|
| `kawiil_compliance_templates_seed.xlsx` | Inventario humano-legible (multi-hoja) para que el equipo legal revise y ajuste antes de seedear. Incluye colores de confianza por renglón. |
| `compliance_task_templates.csv` | Mismo dato que la hoja `templates_master`, en CSV plano para importadores o data-loaders. |
| `kawiil_compliance_seed.sql` | Migración SQL idempotente lista para Cursor / `supabase migration new`. |
| `README.md` (este archivo) | Notas de diseño, decisiones, fuentes y caveats. |

---

## Resumen del seed

- **3 tipos de entidad** sembrados: `ifpe`, `transmisor_dinero`, `av_general`.
- **64 plantillas de tarea** (35 IFPE · 19 Transmisor · 10 AV).
- **Idempotente**: el SQL hace `ON CONFLICT (code) DO UPDATE` en `compliance_entity_types` y resuelve `entity_type_id` por subquery, no por UUID hardcodeado.

---

## Mapeo a `compliance_task_templates`

El CSV / SQL ya viene con las columnas alineadas al esquema que mencionaste en el prompt:

```
entity_code  →  resolver entity_type_id por code
task_name
description
category        ∈ {reportes_uif, reportes_cnbv, reportes_banxico*,
                   reportes_condusef*, capacitacion, kyc, politicas,
                   auditoria, avisos_sat, conservacion,
                   gobierno_corporativo*, fiscal*}
periodicity     ∈ {mensual, trimestral, semestral, anual, cuando_aplique}
due_day         (día calendario aproximado)
due_month       (1..12, sólo anual / semestral)
due_month_2     (sólo semestral)
due_description (texto literal de la norma — fuente de verdad)
legal_basis
sort_order
active = true
```

> Las cuatro categorías marcadas con `*` son nuevas. Aparecerán en la UI sin etiqueta bonita hasta que las agregues al diccionario de labels del modal.

---

## Decisiones que tomé y conviene revisar

### 1) Día hábil → día calendario
El esquema del template usa `due_day` (día calendario), pero la mayoría de las normas usan "día hábil". Aproximé así:

| Norma | due_day | due_description (texto oficial)
|---|---|---|
| 6° día hábil | 10 | "Sexto día hábil del mes" |
| 10° día hábil | 14 | "Décimo día hábil del mes inmediato siguiente" |
| Último día hábil | 28 | "Último día hábil del mes" |
| 15 días hábiles primeros del mes | 21 | "Dentro de los primeros 15 días hábiles" |
| 60 días siguientes al cierre fiscal | 28 (mes 2) | "Dentro de los 60 días siguientes al cierre" |

Si `calculateDueDates` ya resuelve día hábil internamente, ajusten `due_day` al valor exacto y respetar la regla de la norma. El texto oficial siempre vive en `due_description` para que el responsable confirme la fecha exacta antes de enviar.

### 2) Categorías nuevas
Propuse 4 categorías nuevas. Sugerencia de etiqueta en UI:

| code | etiqueta sugerida | icono |
|---|---|---|
| `reportes_banxico` | "Reportes Banxico" | landmark / building |
| `reportes_condusef` | "Reportes Condusef" | shield-check |
| `gobierno_corporativo` | "Gobierno corporativo" | users |
| `fiscal` | "Obligaciones SAT/Fiscal" | receipt |

### 3) Decisión pendiente del módulo
Memoria del proyecto registra la pregunta abierta: ¿fusionar la pestaña existente "PLD/FT" en Tasks con la nueva "Compliance" o mantenerlas separadas?

**Recomendación operativa:** mantenerlas separadas. La pestaña Compliance se alimenta de `compliance_task_templates` (este seed). La pestaña PLD/FT puede seguir existiendo como **vista filtrada** del mismo backend (categorías `reportes_uif + politicas + auditoria + capacitacion + kyc`). Cero duplicación de datos, separación visual mantenida.

---

## Niveles de confianza por renglón

Cada renglón trae una columna `confidence` (en el Excel y CSV; **no** se exporta al SQL):

- 🟢 **alta**: tomado literal del Excel Sylon o del PPTX de Transmisores, o normativa estable.
- 🟡 **media**: documentado por mí en general pero conviene confirmar plazo/aplicabilidad antes del seed productivo. Sobre todo Condusef.
- 🔴 **verificar**: requiere confirmación contra fuente oficial. En este paquete son sólo 2 renglones (TD: renovación de registro CNBV y reporte semestral de operaciones — no aparecen ni en la matriz Sylon ni en el PPTX, los incluí como placeholder por completitud).

**Recomiendo**: el equipo legal revisa el Excel, valida los 'media' y 'verificar', borra o ajusta lo que no aplique, y sólo entonces se ejecuta el SQL.

---

## Limitación de alcance

Este inventario fue construido con:
1. Los dos archivos del cliente (Sylon Excel + PPTX Transmisores).
2. Conocimiento del marco normativo a corte enero-2026 + reformas Reglamento LFPIORPI marzo-2026 ya mapeadas en notas previas del proyecto.

**No se hicieron consultas en línea** a DOF / CNBV / Banxico / Condusef / SAT durante la generación. Si quieres una capa adicional de validación, vale la pena un sprint corto de fact-check sobre los renglones marcados 'media' y 'verificar' antes de mover a producción.

---

## Cómo aplicar el seed (Cursor / Supabase)

```bash
# Opción A — supabase CLI con archivo de migración
mv kawiil_compliance_seed.sql supabase/migrations/$(date +%Y%m%d%H%M%S)_compliance_seed.sql
supabase db push

# Opción B — psql directo
psql "$DATABASE_URL" -f kawiil_compliance_seed.sql

# Verificación
psql "$DATABASE_URL" -c "
  SELECT et.code, COUNT(*) AS n
    FROM compliance_task_templates t
    JOIN compliance_entity_types et ON et.id = t.entity_type_id
   WHERE et.code IN ('ifpe','transmisor_dinero','av_general')
   GROUP BY et.code ORDER BY et.code;
"
# esperado:  av_general | 10
#            ifpe       | 35
#            transmisor_dinero | 19
```

---

## Próximos pasos sugeridos

1. **Equipo legal**: revisar el Excel hoja por hoja (especialmente `IFPE`, `Transmisor_Dinero`, `Actividad_Vulnerable`) y marcar borrar/editar.
2. **Backend**: confirmar que `compliance_task_templates` tiene las columnas en mismo nombre/orden que el seed; si no, ajustar el `INSERT`.
3. **UI**: agregar las 4 etiquetas nuevas de categoría al diccionario.
4. **Decisión de pestaña**: resolver fusión vs separación según recomendación arriba.
5. **Probar** "Generar tareas de cumplimiento" en staging con un cliente IFPE y un cliente Transmisor para validar que `calculateDueDates` produce el calendario correcto (especialmente para `cuando_aplique` y semestral).
