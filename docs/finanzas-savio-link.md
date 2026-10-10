# Enlace Kawiil ↔ Savio (RF-05)

Wizard para emparejar clientes locales (`clients`) sin `savio_customer_id` con
clientes de Savio (`savio_customers`) sin ficha local, por RFC/nombre, con
confirmación manual.

## Piezas

| Archivo | Rol |
|---|---|
| `src/hooks/useSavioLink.ts` | Clientes/Savio sin enlace, sugerencia por RFC/nombre y mutaciones (enlazar, crear ficha local, crear en Savio). |
| `src/components/finanzas/SavioLinkWizard.tsx` | Diálogo con dos direcciones (Local→Savio, Savio→Local). |
| Botón "Enlazar clientes" | Toolbar del dashboard de Ingresos (Savio). |

No requiere migración: reusa `clients.savio_customer_id`, `savio_customers.client_id`
y la función existente `savio-finance-write` (create_customer).

## Acciones

- **Enlazar** (local, inmediato): fija `clients.savio_customer_id` y `savio_customers.client_id`. Sin escritura externa.
- **Crear ficha local**: crea un `clients` a partir de un cliente Savio y lo enlaza. Local.
- **Crear en Savio** (escritura externa, manual): `POST /customer` vía `savio-finance-write`, luego guarda el vínculo. Requiere permiso `can_write_savio_finance`. La fila espejo en `savio_customers` la crea el siguiente `savio-sync`.

## Emparejamiento

`suggestSavioMatch`: RFC exacto (normalizado) primero; si no, nombre exacto o
parcial (normalizado, sin acentos ni sufijos societarios SA/DE/CV…). La sugerencia
es solo eso: el usuario confirma.

## Meta

Dejar 0 clientes sin enlace: cada cliente local queda con `savio_customer_id` y
cada cliente Savio con `client_id`, de modo que facturas/pagos se atribuyen bien
en aging y conciliación.
