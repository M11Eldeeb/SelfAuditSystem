-- Technician claim submissions.
--  * New account type "technician" (value added by the separate migration "technician_enum" - a new enum value cannot be
--    used in the transaction that adds it), tied to a branch, with an optional employee number (technicians without a
--    company e-mail sign in with it).
--  * The technician submits VIN, work order, end of repair, photos / videos / PDFs. The files go straight from the phone to
--    Google Drive: Warranty Documents / <Branch> / <Technician> / <Work order>.
--  * The branch's warranty admin approves, returns (the technician corrects and sends again) or rejects with a reason.
-- Every write goes through the website (service role, after its own role checks); the tables only allow reading.

alter table self_audit_users drop constraint branch_admin_requires_branch;
alter table self_audit_users add constraint branch_admin_requires_branch check (
  (role::text in ('branch_admin', 'workshop_supervisor', 'team_leader', 'service_manager', 'technician') and branch_id is not null)
  or role::text in ('officer', 'finance', 'technical')
);
alter table self_audit_users add column if not exists employee_no text;
create unique index if not exists self_audit_users_employee_no_idx on self_audit_users (lower(employee_no)) where employee_no is not null;

create sequence if not exists self_audit_tech_claim_no_seq;

create table if not exists self_audit_tech_claims (
  id uuid primary key default gen_random_uuid(),
  claim_no text not null unique default ('TC-' || lpad(nextval('self_audit_tech_claim_no_seq')::text, 6, '0')),
  branch_id uuid not null references self_audit_branches (id),
  technician_id uuid references self_audit_users (id) on delete set null,
  technician_name text not null,
  vin text not null,
  work_order text not null,
  end_of_repair timestamptz not null,
  notes text,
  -- uploading: created, files still going to Drive (the technician finishes or retries it)
  status text not null default 'uploading' check (status in ('uploading', 'submitted', 'returned', 'approved', 'rejected')),
  review_comment text,
  reviewed_by uuid references self_audit_users (id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  drive_folder_id text,
  submitted_at timestamptz,
  times_submitted integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists self_audit_tech_claims_branch_idx on self_audit_tech_claims (branch_id, status, submitted_at desc);
create index if not exists self_audit_tech_claims_tech_idx on self_audit_tech_claims (technician_id, created_at desc);
create index if not exists self_audit_tech_claims_wo_idx on self_audit_tech_claims (branch_id, work_order);

create table if not exists self_audit_tech_claim_files (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references self_audit_tech_claims (id) on delete cascade,
  drive_file_id text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid references self_audit_users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists self_audit_tech_claim_files_claim_idx on self_audit_tech_claim_files (claim_id);

create table if not exists self_audit_tech_claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references self_audit_tech_claims (id) on delete cascade,
  kind text not null check (kind in ('submitted', 'resubmitted', 'approved', 'returned', 'rejected', 'edited')),
  body text,
  author_id uuid references self_audit_users (id) on delete set null,
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists self_audit_tech_claim_events_claim_idx on self_audit_tech_claim_events (claim_id, created_at);

alter table self_audit_tech_claims enable row level security;
alter table self_audit_tech_claim_files enable row level security;
alter table self_audit_tech_claim_events enable row level security;

create policy "read tech claims" on self_audit_tech_claims for select using (
  (select current_user_role()::text) = 'officer'
  or ((select current_user_role()::text) = 'branch_admin' and branch_id = (select current_user_branch_id()))
  or technician_id = (select auth.uid())
);
create policy "read tech claim files" on self_audit_tech_claim_files for select using (
  exists (select 1 from self_audit_tech_claims c where c.id = claim_id)
);
create policy "read tech claim events" on self_audit_tech_claim_events for select using (
  exists (select 1 from self_audit_tech_claims c where c.id = claim_id)
);
