-- Quality supervisor: an account without a branch that sees the QC dashboard and the QC reports of every branch, exports
-- them (PDF / Excel) and comments on them. Read and written by the server only (service role): RLS on, no policies.
alter table self_audit_users drop constraint if exists branch_admin_requires_branch;
alter table self_audit_users add constraint branch_admin_requires_branch check (
  (role::text = any (array['branch_admin', 'workshop_supervisor', 'team_leader', 'service_manager', 'technician', 'claims_reviewer', 'service_advisor', 'quality_controller']) and branch_id is not null)
  or role::text = any (array['officer', 'finance', 'technical', 'manager', 'national_manager', 'data_analyst', 'queue_user', 'quality_supervisor'])
);

-- Each export of a QC report (who, when, PDF or Excel): the reports list marks the ones exported already.
create table if not exists self_audit_qc_exports (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references self_audit_qc_checks (id) on delete cascade,
  user_id uuid references self_audit_users (id) on delete set null,
  user_name text,
  format text not null check (format in ('pdf', 'excel')),
  exported_at timestamptz not null default now()
);
create index if not exists self_audit_qc_exports_check_idx on self_audit_qc_exports (check_id, exported_at desc);
alter table self_audit_qc_exports enable row level security;

-- Comments on a QC report (the quality supervisor and the warranty officers write them; everyone who sees the QC reads them).
create table if not exists self_audit_qc_comments (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references self_audit_qc_checks (id) on delete cascade,
  author_id uuid references self_audit_users (id) on delete set null,
  author_name text,
  author_role text,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists self_audit_qc_comments_check_idx on self_audit_qc_comments (check_id, created_at);
alter table self_audit_qc_comments enable row level security;
