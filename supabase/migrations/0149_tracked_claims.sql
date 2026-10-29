-- Reconciliation > Claims to review: claim numbers an officer wants to follow (e.g. just submitted). The claim's data
-- (status, main part, work order, total, branch) is read from the uploaded claims export by claim number, so a claim
-- added before its batch is uploaded shows "waiting for the next upload" until then.
create table if not exists self_audit_tracked_claims (
  claim_number text primary key,
  note text,
  completed boolean not null default false,
  completed_at timestamptz,
  completed_by_name text,
  added_by uuid references self_audit_users(id) on delete set null,
  added_by_name text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text
);
alter table self_audit_tracked_claims enable row level security;
