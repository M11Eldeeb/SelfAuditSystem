-- Quality control: the branch's quality controller records one QC per vehicle (WIP), passes or fails it, and tests a
-- failed one again after the workshop read his notes. Files go to Google Drive: Warranty Documents / <Branch> / <WIP> /
-- QC-<WIP>. Every write goes through the website (service role, after its own role checks); no table policies.

alter table self_audit_users drop constraint if exists branch_admin_requires_branch;
alter table self_audit_users add constraint branch_admin_requires_branch check (
  (role::text = any (array['branch_admin', 'workshop_supervisor', 'team_leader', 'service_manager', 'technician', 'claims_reviewer', 'service_advisor', 'quality_controller']) and branch_id is not null)
  or role::text = any (array['officer', 'finance', 'technical'])
);

create sequence if not exists self_audit_qc_no_seq;

create table if not exists self_audit_qc_checks (
  id uuid primary key default gen_random_uuid(),
  qc_no text not null unique default ('QC-' || lpad(nextval('self_audit_qc_no_seq')::text, 6, '0')),
  branch_id uuid not null references self_audit_branches (id),
  wip_no text not null,
  model text,
  odometer_in integer,
  purpose text not null check (purpose in ('quality_control', 'test_drive_customer', 'test_drive_pre_repair', 'test_drive_post_repair', 'comeback', 'diagnosis_verification')),
  repair_type text check (repair_type in ('periodic_maintenance', 'general_repair', 'both')),
  team_leader text,
  service_advisor text,
  replaced_parts text,
  defect_description text,
  status text not null check (status in ('failed', 'passed')),
  attempts integer not null default 1,
  final_odometer integer,
  passed_at timestamptz,
  drive_folder_id text,
  controller_id uuid references self_audit_users (id) on delete set null,
  controller_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists self_audit_qc_checks_branch_idx on self_audit_qc_checks (branch_id, status, created_at desc);
create index if not exists self_audit_qc_checks_wip_idx on self_audit_qc_checks (branch_id, wip_no);

-- One row per test: the first one and every test again after a fail.
create table if not exists self_audit_qc_tests (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references self_audit_qc_checks (id) on delete cascade,
  attempt_no integer not null,
  result text not null check (result in ('pass', 'fail')),
  comment text,
  -- [{ "id": "<user id>" | null, "name": "..." }] - the technicians who did the work tested here
  technicians jsonb not null default '[]',
  final_odometer integer,
  tested_by uuid references self_audit_users (id) on delete set null,
  tested_by_name text,
  created_at timestamptz not null default now(),
  unique (check_id, attempt_no)
);

create table if not exists self_audit_qc_files (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references self_audit_qc_checks (id) on delete cascade,
  test_id uuid references self_audit_qc_tests (id) on delete set null,
  drive_file_id text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid references self_audit_users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists self_audit_qc_files_check_idx on self_audit_qc_files (check_id);

-- Technicians the quality controller added by name (no account), offered again for his branch.
create table if not exists self_audit_qc_extra_technicians (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references self_audit_branches (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists self_audit_qc_extra_technicians_name_idx on self_audit_qc_extra_technicians (branch_id, lower(name));

alter table self_audit_qc_checks enable row level security;
alter table self_audit_qc_tests enable row level security;
alter table self_audit_qc_files enable row level security;
alter table self_audit_qc_extra_technicians enable row level security;

-- The vehicle models in the claims batches (MG5, ZS ...), for the QC form's model list. Server only.
create or replace function public.qc_vehicle_models() returns setof text
language sql stable set search_path = public, pg_temp as $$
  select distinct trim(vehicle_model) from self_audit_claims where nullif(trim(vehicle_model), '') is not null order by 1
$$;
revoke execute on function public.qc_vehicle_models() from public, anon, authenticated;
grant execute on function public.qc_vehicle_models() to service_role;
