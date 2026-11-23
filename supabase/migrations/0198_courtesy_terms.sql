-- Courtesy car terms and conditions per branch, edited by the branch's reception manager (or a warranty officer).
-- Every save is a new version (never overwritten): who, when, what changed. A branch without a version uses the
-- standard terms. Each agreement keeps the version its customer read and signed, so its PDF always shows those terms.
create table if not exists self_audit_courtesy_terms (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references self_audit_branches(id),
  version integer not null,
  terms jsonb not null,
  note text not null,
  created_by uuid references self_audit_users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (branch_id, version)
);
alter table self_audit_courtesy_terms enable row level security;

alter table self_audit_courtesy_agreements add column if not exists terms_id uuid references self_audit_courtesy_terms(id);
