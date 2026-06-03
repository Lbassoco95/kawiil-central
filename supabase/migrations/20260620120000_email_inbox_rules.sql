create table if not exists email_inbox_rules (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  rule_name text not null default '',
  sender_email text not null,
  move_to_folder_id text,
  move_to_folder_name text,
  mark_as_read boolean not null default false,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table email_inbox_rules enable row level security;

create policy "Users manage their own email rules"
  on email_inbox_rules for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index email_inbox_rules_user_id_idx on email_inbox_rules(user_id);
