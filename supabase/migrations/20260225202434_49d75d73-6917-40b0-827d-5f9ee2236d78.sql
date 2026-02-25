
-- =============================================
-- KAWIIL OS - Database Schema (Phase 1 MVP)
-- =============================================

-- 1. ENUM TYPES
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'staff', 'viewer');
CREATE TYPE public.client_type AS ENUM ('persona_moral', 'persona_fisica');
CREATE TYPE public.client_status AS ENUM ('activo', 'inactivo', 'prospecto');
CREATE TYPE public.service_area AS ENUM ('contabilidad', 'legal', 'softlanding', 'pld_ft');
CREATE TYPE public.task_priority AS ENUM ('urgente', 'alta', 'media', 'baja');
CREATE TYPE public.task_status AS ENUM ('pendiente', 'en_progreso', 'en_revision', 'completada', 'cancelada');
CREATE TYPE public.project_status AS ENUM ('activo', 'pausado', 'completado', 'cancelado');
CREATE TYPE public.document_source AS ENUM ('supabase', 'dropbox');

-- 2. ORGANIZATIONS (multi-tenant root)
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 3. PROFILES (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar_url TEXT,
  area service_area,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. USER_ROLES (separate table for roles)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 5. CLIENTS
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rfc TEXT,
  client_type client_type NOT NULL DEFAULT 'persona_moral',
  status client_status NOT NULL DEFAULT 'activo',
  responsible_user_id UUID REFERENCES auth.users(id),
  primary_area service_area,
  services service_area[] NOT NULL DEFAULT '{}',
  notes TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_clients_org ON public.clients(organization_id);
CREATE INDEX idx_clients_responsible ON public.clients(responsible_user_id);
CREATE INDEX idx_clients_status ON public.clients(status);

-- 6. PROJECTS
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  area service_area,
  status project_status NOT NULL DEFAULT 'activo',
  responsible_user_id UUID REFERENCES auth.users(id),
  start_date DATE,
  end_date DATE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_projects_org ON public.projects(organization_id);
CREATE INDEX idx_projects_client ON public.projects(client_id);

-- 7. PROJECT MEMBERS
CREATE TABLE public.project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(project_id, user_id)
);
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- 8. TASKS
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  area service_area,
  assigned_to UUID REFERENCES auth.users(id),
  priority task_priority NOT NULL DEFAULT 'media',
  status task_status NOT NULL DEFAULT 'pendiente',
  due_date DATE,
  tags TEXT[] DEFAULT '{}',
  checklist JSONB DEFAULT '[]',
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurrence_pattern TEXT,
  template_id UUID REFERENCES public.tasks(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tasks_org ON public.tasks(organization_id);
CREATE INDEX idx_tasks_assigned ON public.tasks(assigned_to);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_project ON public.tasks(project_id);
CREATE INDEX idx_tasks_client ON public.tasks(client_id);
CREATE INDEX idx_tasks_due_date ON public.tasks(due_date);

-- 9. TASK COMMENTS
CREATE TABLE public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  content TEXT NOT NULL,
  mentions UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_task_comments_task ON public.task_comments(task_id);

-- 10. DOCUMENTS
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  document_type TEXT,
  file_path TEXT,
  file_size BIGINT,
  mime_type TEXT,
  source document_source NOT NULL DEFAULT 'supabase',
  external_id TEXT,
  external_path TEXT,
  tags TEXT[] DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_documents_org ON public.documents(organization_id);
CREATE INDEX idx_documents_client ON public.documents(client_id);
CREATE INDEX idx_documents_type ON public.documents(document_type);

-- 11. INTEGRATIONS (placeholder for Dropbox etc.)
CREATE TABLE public.integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  config JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- 12. ACTIVITY LOG
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_activity_org ON public.activity_log(organization_id);
CREATE INDEX idx_activity_entity ON public.activity_log(entity_type, entity_id);

-- =============================================
-- SECURITY DEFINER FUNCTIONS
-- =============================================

CREATE OR REPLACE FUNCTION public.get_user_org_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE user_id = _user_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_manager(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin', 'manager')
  )
$$;

-- =============================================
-- RLS POLICIES
-- =============================================

CREATE POLICY "Users see own org" ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.get_user_org_id(auth.uid()));

CREATE POLICY "Users see org profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users see org roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    user_id IN (
      SELECT p.user_id FROM public.profiles p 
      WHERE p.organization_id = public.get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Org users see clients" ON public.clients
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      public.is_admin_or_manager(auth.uid())
      OR responsible_user_id = auth.uid()
    )
  );

CREATE POLICY "Admin/manager create clients" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.is_admin_or_manager(auth.uid())
  );

CREATE POLICY "Admin/manager update clients" ON public.clients
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.is_admin_or_manager(auth.uid())
  );

CREATE POLICY "Org users see projects" ON public.projects
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      public.is_admin_or_manager(auth.uid())
      OR responsible_user_id = auth.uid()
      OR id IN (SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = auth.uid())
    )
  );

CREATE POLICY "Admin/manager create projects" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.is_admin_or_manager(auth.uid())
  );

CREATE POLICY "Admin/manager update projects" ON public.projects
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.is_admin_or_manager(auth.uid())
  );

CREATE POLICY "Org users see project members" ON public.project_members
  FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT p.id FROM public.projects p 
      WHERE p.organization_id = public.get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Admin/manager manage project members" ON public.project_members
  FOR ALL TO authenticated
  USING (
    project_id IN (
      SELECT p.id FROM public.projects p 
      WHERE p.organization_id = public.get_user_org_id(auth.uid())
        AND public.is_admin_or_manager(auth.uid())
    )
  );

CREATE POLICY "Org users see tasks" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      public.is_admin_or_manager(auth.uid())
      OR assigned_to = auth.uid()
      OR project_id IN (SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = auth.uid())
    )
  );

CREATE POLICY "Org users create tasks" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "Org users update tasks" ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      public.is_admin_or_manager(auth.uid())
      OR assigned_to = auth.uid()
    )
  );

CREATE POLICY "Org users see task comments" ON public.task_comments
  FOR SELECT TO authenticated
  USING (
    task_id IN (
      SELECT t.id FROM public.tasks t 
      WHERE t.organization_id = public.get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Org users create task comments" ON public.task_comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Org users see documents" ON public.documents
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "Org users create documents" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "Admin/manager update documents" ON public.documents
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (public.is_admin_or_manager(auth.uid()) OR uploaded_by = auth.uid())
  );

CREATE POLICY "Admin see integrations" ON public.integrations
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admin manage integrations" ON public.integrations
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Org users see activity" ON public.activity_log
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "System inserts activity" ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

-- =============================================
-- TRIGGERS for updated_at
-- =============================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_task_comments_updated_at BEFORE UPDATE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for documents
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);

CREATE POLICY "Org users can upload documents" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Org users can view documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documents');
