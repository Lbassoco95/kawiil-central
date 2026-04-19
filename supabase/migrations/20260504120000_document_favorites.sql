-- document_favorites: tabla simple por usuario para marcar documentos como favoritos.
-- Aplicar en el proyecto kawiil-central (qppfampapbxdgednkofc) vía supabase db push o SQL Editor.

create table if not exists public.document_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, document_id)
);

create index if not exists document_favorites_user_idx
  on public.document_favorites (user_id, created_at desc);

alter table public.document_favorites enable row level security;

drop policy if exists "users see own favorites" on public.document_favorites;
create policy "users see own favorites" on public.document_favorites
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
