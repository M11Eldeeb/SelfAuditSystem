-- Warranty self-audit app: core schema
-- Run this in the Supabase SQL editor (or `supabase db push`) after creating the project.

create extension if not exists "pgcrypto";

create type user_role as enum ('officer', 'branch_admin');
create type cycle_status as enum ('draft', 'open', 'completed');
create type assignment_status as enum ('not_started', 'in_progress', 'submitted', 'ai_checked', 'reviewed');
create type officer_decision as enum ('confirmed', 'overridden');

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

-- Mirrors auth.users; role/branch live here since they're app concerns, not auth concerns.
create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role user_role not null,
  branch_id uuid references branches (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint branch_admin_requires_branch check (
    (role = 'branch_admin' and branch_id is not null) or (role = 'officer')
  )
);

create table upload_batches (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references users (id),
  uploaded_at timestamptz not null default now(),
  source_filename text not null,
  claim_month date not null, -- first day of the month the claims belong to
  row_count integer not null default 0
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches (id),
  upload_batch_id uuid not null references upload_batches (id) on delete cascade,
  claim_number text not null,
  vin text,
  vehicle_model text,
  mileage numeric,
  part_serial_number text,
  part_production_date date,
  repair_end_date date,
  dealer_submit_date date,
  creation_date date not null,
  raw_row jsonb not null default '{}'::jsonb, -- full original row, so nothing from the sheet is lost
  created_at timestamptz not null default now(),
  unique (branch_id, claim_number, upload_batch_id)
);
create index claims_branch_creation_idx on claims (branch_id, creation_date);

-- ---------------------------------------------------------------------------
-- Questionnaire config (seeded from audit_questions_schema.json, kept in the
-- DB rather than hardcoded so the questionnaire can change without a redeploy)
-- ---------------------------------------------------------------------------

create table audit_questions (
  id text primary key, -- q1..q18
  sort_order integer not null,
  text text not null,
  help_text text,
  type text not null,
  options jsonb not null default '[]'::jsonb,
  conditional_field jsonb,
  required boolean not null default true,
  ai_checkable boolean not null default false,
  ai_check_note text,
  compliant_options jsonb not null default '[]'::jsonb, -- full-credit answers
  partial_credit_options jsonb not null default '[]'::jsonb -- half-credit answers
);

create table audit_photo_types (
  id text primary key,
  sort_order integer not null,
  label text not null,
  help_text text,
  required boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Audit cycles / assignments / submissions
-- ---------------------------------------------------------------------------

create table audit_cycles (
  id uuid primary key default gen_random_uuid(),
  cycle_month date not null unique, -- e.g. 2026-08-01
  claims_month date not null, -- e.g. 2026-07-01 (cycle_month minus 1 month)
  status cycle_status not null default 'draft',
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

create table audit_assignments (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references audit_cycles (id) on delete cascade,
  branch_id uuid not null references branches (id),
  claim_id uuid not null references claims (id),
  status assignment_status not null default 'not_started',
  submitted_at timestamptz,
  submitted_by uuid references users (id),
  reviewed_at timestamptz,
  reviewed_by uuid references users (id),
  created_at timestamptz not null default now(),
  unique (cycle_id, claim_id)
);
create index audit_assignments_branch_cycle_idx on audit_assignments (branch_id, cycle_id);

create table audit_answers (
  assignment_id uuid not null references audit_assignments (id) on delete cascade,
  question_id text not null references audit_questions (id),
  answer_value text,
  conditional_value text,
  updated_at timestamptz not null default now(),
  primary key (assignment_id, question_id)
);

create table audit_photos (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references audit_assignments (id) on delete cascade,
  photo_type_id text not null references audit_photo_types (id),
  storage_path text not null,
  uploaded_at timestamptz not null default now(),
  unique (assignment_id, photo_type_id)
);

create table audit_notes (
  assignment_id uuid primary key references audit_assignments (id) on delete cascade,
  note_text text,
  updated_at timestamptz not null default now()
);

create table ai_reviews (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references audit_assignments (id) on delete cascade,
  question_id text not null references audit_questions (id),
  ai_suggested_value text,
  ai_reasoning text,
  ai_confidence text,
  officer_decision officer_decision,
  officer_value text,
  reviewed_by uuid references users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (assignment_id, question_id)
);

create table audit_results (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references audit_cycles (id) on delete cascade,
  branch_id uuid not null references branches (id),
  score_pct numeric not null,
  per_question_breakdown jsonb not null default '{}'::jsonb,
  finalized_by uuid references users (id),
  finalized_at timestamptz not null default now(),
  unique (cycle_id, branch_id)
);

-- ---------------------------------------------------------------------------
-- Role helpers (security definer so RLS on `users` doesn't recurse into itself)
-- ---------------------------------------------------------------------------

create or replace function public.current_user_role() returns user_role
language sql security definer stable
set search_path = public
as $$
  select role from users where id = auth.uid();
$$;

create or replace function public.current_user_branch_id() returns uuid
language sql security definer stable
set search_path = public
as $$
  select branch_id from users where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table branches enable row level security;
alter table users enable row level security;
alter table upload_batches enable row level security;
alter table claims enable row level security;
alter table audit_questions enable row level security;
alter table audit_photo_types enable row level security;
alter table audit_cycles enable row level security;
alter table audit_assignments enable row level security;
alter table audit_answers enable row level security;
alter table audit_photos enable row level security;
alter table audit_notes enable row level security;
alter table ai_reviews enable row level security;
alter table audit_results enable row level security;

create policy "officers manage branches" on branches for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins read own branch" on branches for select
  using (id = current_user_branch_id());

create policy "officers manage users" on users for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "users read own row" on users for select
  using (id = auth.uid());

create policy "officers manage upload_batches" on upload_batches for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');

create policy "officers manage claims" on claims for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins read own claims" on claims for select
  using (branch_id = current_user_branch_id());

create policy "authenticated read audit_questions" on audit_questions for select
  using (auth.role() = 'authenticated');
create policy "officers manage audit_questions" on audit_questions for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');

create policy "authenticated read audit_photo_types" on audit_photo_types for select
  using (auth.role() = 'authenticated');
create policy "officers manage audit_photo_types" on audit_photo_types for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');

create policy "authenticated read audit_cycles" on audit_cycles for select
  using (auth.role() = 'authenticated');
create policy "officers manage audit_cycles" on audit_cycles for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');

create policy "officers manage audit_assignments" on audit_assignments for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins read own assignments" on audit_assignments for select
  using (branch_id = current_user_branch_id());
create policy "branch admins update own assignments" on audit_assignments for update
  using (branch_id = current_user_branch_id())
  with check (branch_id = current_user_branch_id());

create policy "officers manage audit_answers" on audit_answers for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins manage own audit_answers" on audit_answers for all
  using (exists (
    select 1 from audit_assignments a
    where a.id = audit_answers.assignment_id and a.branch_id = current_user_branch_id()
  ))
  with check (exists (
    select 1 from audit_assignments a
    where a.id = audit_answers.assignment_id and a.branch_id = current_user_branch_id()
  ));

create policy "officers manage audit_photos" on audit_photos for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins manage own audit_photos" on audit_photos for all
  using (exists (
    select 1 from audit_assignments a
    where a.id = audit_photos.assignment_id and a.branch_id = current_user_branch_id()
  ))
  with check (exists (
    select 1 from audit_assignments a
    where a.id = audit_photos.assignment_id and a.branch_id = current_user_branch_id()
  ));

create policy "officers manage audit_notes" on audit_notes for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins manage own audit_notes" on audit_notes for all
  using (exists (
    select 1 from audit_assignments a
    where a.id = audit_notes.assignment_id and a.branch_id = current_user_branch_id()
  ))
  with check (exists (
    select 1 from audit_assignments a
    where a.id = audit_notes.assignment_id and a.branch_id = current_user_branch_id()
  ));

create policy "officers manage ai_reviews" on ai_reviews for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins read own ai_reviews" on ai_reviews for select
  using (exists (
    select 1 from audit_assignments a
    where a.id = ai_reviews.assignment_id and a.branch_id = current_user_branch_id()
  ));

create policy "officers manage audit_results" on audit_results for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins read own audit_results" on audit_results for select
  using (branch_id = current_user_branch_id());

-- ---------------------------------------------------------------------------
-- Storage bucket for the 4 required photos per claim
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('audit-photos', 'audit-photos', false)
on conflict (id) do nothing;

create policy "officers read audit photos" on storage.objects for select
  using (bucket_id = 'audit-photos' and current_user_role() = 'officer');

create policy "branch admins manage own audit photos" on storage.objects for all
  using (
    bucket_id = 'audit-photos'
    and exists (
      select 1 from audit_assignments a
      where a.id::text = (storage.foldername(name)) [1]
      and a.branch_id = current_user_branch_id()
    )
  )
  with check (
    bucket_id = 'audit-photos'
    and exists (
      select 1 from audit_assignments a
      where a.id::text = (storage.foldername(name)) [1]
      and a.branch_id = current_user_branch_id()
    )
  );
