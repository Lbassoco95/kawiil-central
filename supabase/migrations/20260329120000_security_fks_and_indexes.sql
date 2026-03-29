-- Migration: Add missing foreign keys and performance indexes
-- Date: 2026-03-29

-- ============================================================
-- PART 1: Missing Foreign Keys (idempotent via DO blocks)
-- ============================================================

-- task_assignees.user_id → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_assignees_user_id_fkey') THEN
    ALTER TABLE public.task_assignees ADD CONSTRAINT task_assignees_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- user_celulas.user_id → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_celulas_user_id_fkey') THEN
    ALTER TABLE public.user_celulas ADD CONSTRAINT user_celulas_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- chat_conversations.user_id → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_conversations_user_id_fkey') THEN
    ALTER TABLE public.chat_conversations ADD CONSTRAINT chat_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- mood_checkins.user_id → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mood_checkins_user_id_fkey') THEN
    ALTER TABLE public.mood_checkins ADD CONSTRAINT mood_checkins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- notifications.user_id → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_user_id_fkey') THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- notifications.source_user_id → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_source_user_id_fkey') THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_source_user_id_fkey FOREIGN KEY (source_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- reminders.user_id → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reminders_user_id_fkey') THEN
    ALTER TABLE public.reminders ADD CONSTRAINT reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- personalized_phrases.user_id → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personalized_phrases_user_id_fkey') THEN
    ALTER TABLE public.personalized_phrases ADD CONSTRAINT personalized_phrases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- user_preferences.user_id → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_user_id_fkey') THEN
    ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- expenses.requested_by → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_requested_by_fkey') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id);
  END IF;
END $$;

-- expenses.reviewed_by → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_reviewed_by_fkey') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- expenses.approved_by → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_approved_by_fkey') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- expenses.paid_by → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_paid_by_fkey') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- expenses.organization_id → public.organizations(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_organization_id_fkey') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
  END IF;
END $$;

-- microsoft_tokens.user_id → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'microsoft_tokens_user_id_fkey') THEN
    ALTER TABLE public.microsoft_tokens ADD CONSTRAINT microsoft_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- project_comments.user_id → auth.users(id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_comments_user_id_fkey') THEN
    ALTER TABLE public.project_comments ADD CONSTRAINT project_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- PART 2: Performance indexes for frequent filter/join columns
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_user_celulas_org ON public.user_celulas(organization_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_org ON public.chat_conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON public.chat_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_mood_checkins_org ON public.mood_checkins(organization_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON public.notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_org ON public.reminders(organization_id);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON public.reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_personalized_phrases_org ON public.personalized_phrases(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_org ON public.user_preferences(organization_id);
CREATE INDEX IF NOT EXISTS idx_expenses_org ON public.expenses(organization_id);
CREATE INDEX IF NOT EXISTS idx_expenses_requested_by ON public.expenses(requested_by);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_org ON public.accounting_periods(organization_id);
CREATE INDEX IF NOT EXISTS idx_celulas_org ON public.celulas(organization_id);
CREATE INDEX IF NOT EXISTS idx_integrations_org ON public.integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_project ON public.documents(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);
CREATE INDEX IF NOT EXISTS idx_project_comments_project ON public.project_comments(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON public.chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_procedure_versions_procedure ON public.procedure_versions(procedure_id);
CREATE INDEX IF NOT EXISTS idx_procedure_comments_procedure ON public.procedure_comments(procedure_id);
