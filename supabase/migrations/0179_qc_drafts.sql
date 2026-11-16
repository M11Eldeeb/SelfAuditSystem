-- Quality control: a QC (or a retest) saved part-way, to be completed later. Removed when it is submitted.
create table if not exists self_audit_qc_drafts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references self_audit_branches (id) on delete cascade,
  controller_id uuid not null references self_audit_users (id) on delete cascade,
  -- 'new': a new QC; 'retest': a test again of check_id
  kind text not null check (kind in ('new', 'retest')),
  check_id uuid references self_audit_qc_checks (id) on delete cascade,
  wip text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists self_audit_qc_drafts_branch_idx on self_audit_qc_drafts (branch_id, updated_at desc);
create unique index if not exists self_audit_qc_drafts_retest_idx on self_audit_qc_drafts (check_id) where kind = 'retest';
alter table self_audit_qc_drafts enable row level security;
