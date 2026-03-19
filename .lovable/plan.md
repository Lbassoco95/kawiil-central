

## Plan: Módulo de Control Financiero (Fase 1 — Gastos)

### Resumen

Crear un módulo de finanzas que permita a cualquier kawiiler registrar gastos y solicitar viáticos/pagos, y que solo los miembros de las células "Finanzas" o "Administración" puedan ver el panel completo de gestión de pagos.

### Prerequisito: Asignación multi-célula por usuario

Actualmente `profiles.area` es un campo de texto único. Para que un usuario pueda pertenecer a varias células (ej. "Legal" + "Finanzas"), se necesita una tabla de relación.

**Migración 1 — Tabla `user_celulas`**
```sql
CREATE TABLE public.user_celulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  celula_id uuid NOT NULL REFERENCES public.celulas(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, celula_id)
);

ALTER TABLE public.user_celulas ENABLE ROW LEVEL SECURITY;

-- Org users can see
CREATE POLICY "Org users see user_celulas" ON public.user_celulas
FOR SELECT TO authenticated
USING (organization_id = get_user_org_id(auth.uid()));

-- Admin/manager manage
CREATE POLICY "Admin/manager manage user_celulas" ON public.user_celulas
FOR ALL TO authenticated
USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Security definer function to check célula membership
CREATE OR REPLACE FUNCTION public.user_in_celula(_user_id uuid, _celula_slug text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_celulas uc
    JOIN public.celulas c ON c.id = uc.celula_id
    WHERE uc.user_id = _user_id AND c.slug = _celula_slug
  )
$$;

-- Helper: check if user has finance access
CREATE OR REPLACE FUNCTION public.has_finance_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_celulas uc
    JOIN public.celulas c ON c.id = uc.celula_id
    WHERE uc.user_id = _user_id AND c.slug IN ('finanzas', 'administracion')
  ) OR is_admin_or_manager(_user_id)
$$;
```

**Migración 2 — Tablas del módulo financiero**
```sql
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  category text NOT NULL, -- 'terceros', 'viaticos', 'operativo', 'contratacion_externa'
  status text NOT NULL DEFAULT 'solicitado', -- solicitado, en_revision, aprobado, rechazado, pagado
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'MXN',
  description text NOT NULL,
  client_id uuid,
  project_id uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  paid_by uuid,
  paid_at timestamptz,
  rejection_reason text,
  receipt_path text, -- file in storage
  notes text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- Everyone can create expenses (their own)
CREATE POLICY "Users create own expenses" ON public.expenses
FOR INSERT TO authenticated
WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND requested_by = auth.uid());

-- Users see their own expenses
CREATE POLICY "Users see own expenses" ON public.expenses
FOR SELECT TO authenticated
USING (organization_id = get_user_org_id(auth.uid()) AND (
  requested_by = auth.uid() OR has_finance_access(auth.uid())
));

-- Finance users can update expenses (approve/reject/pay)
CREATE POLICY "Finance update expenses" ON public.expenses
FOR UPDATE TO authenticated
USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

-- Admin/manager delete
CREATE POLICY "Admin delete expenses" ON public.expenses
FOR DELETE TO authenticated
USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
```

### Cambios en código

**1. Admin — Asignación multi-célula (`UserEditDialog.tsx`)**
- Reemplazar el select único de `area` por un multi-select de células
- Al guardar, insertar/eliminar registros en `user_celulas`
- Mantener el campo `profiles.area` como la célula principal (backward compatibility)

**2. Hook de acceso financiero (`src/hooks/useFinanceAccess.ts`)**
- Query a `user_celulas` join `celulas` para ver si el usuario tiene célula "finanzas" o "administracion"
- Exportar `hasFinanceAccess` boolean

**3. Nueva página de Finanzas (`src/pages/Finanzas.tsx`)**
- **Vista de todos los usuarios**: Formulario para crear solicitudes de gasto
  - Categoría (select: terceros, viáticos, operativo, contratación externa)
  - Monto + moneda
  - Descripción
  - Cliente/proyecto (opcional, obligatorio para "terceros")
  - Fecha del gasto
  - Comprobante (upload)
  - Lista de "mis solicitudes" con estado
- **Vista financiera** (solo con acceso): Panel de gestión con tabla completa
  - Todas las solicitudes de la org
  - Filtros por categoría, status, solicitante, fecha
  - Acciones: revisar, aprobar, rechazar (con motivo), marcar pagado
  - Resumen de totales por categoría y periodo

**4. Navegación (`AppSidebar.tsx`)**
- Agregar item "Finanzas" con icono `Wallet`
- Visible para todos (cada quien ve sus solicitudes)

**5. Ruta (`App.tsx`)**
- `/finanzas` → `<Finanzas />`

### Archivos a crear/modificar
- **Crear**: `src/pages/Finanzas.tsx`, `src/hooks/useFinanceAccess.ts`, `src/hooks/useExpenses.ts`, `src/components/finanzas/ExpenseFormDialog.tsx`, `src/components/finanzas/ExpenseTable.tsx`, `src/components/finanzas/ExpenseReviewDialog.tsx`
- **Modificar**: `src/App.tsx`, `src/components/AppSidebar.tsx`, `src/components/admin/UserEditDialog.tsx`
- **Migraciones**: 2 (user_celulas + expenses)

### Fuera de alcance (Fase 2)
- Integración con Savio para ingresos
- Dashboard financiero con gráficas de ingresos vs gastos
- Reportes exportables

