-- When a technician's phone cannot stamp or send a file, the reason (and the phone's browser) is written here so the
-- warranty team can see what went wrong without asking for screenshots. Server-only (service role); no RLS policies.
create table if not exists public.self_audit_tech_upload_problems (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid references public.self_audit_users (id) on delete set null,
  file_name text,
  file_type text,
  file_size bigint,
  message text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.self_audit_tech_upload_problems enable row level security;
create index if not exists self_audit_tech_upload_problems_created_idx on public.self_audit_tech_upload_problems (created_at desc);
