-- Verification code requests: a workshop supervisor / team leader sends the VIN and mileage (read from photos),
-- the module and the reason from their phone; the technical team (or a warranty officer) answers with the
-- verification code, which is e-mailed back to the requester. The website reads and writes this table with the
-- service role after checking the user's role; the policies below are for direct reads only.
create table if not exists self_audit_verification_requests (
  id uuid primary key default gen_random_uuid(),
  request_no bigint generated always as identity,
  branch_id uuid not null references self_audit_branches (id) on delete restrict,
  vin text not null,
  mileage integer,
  vin_photo_path text,
  mileage_photo_path text,
  module_name text not null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  code text,
  closed_by uuid references self_audit_users (id) on delete set null,
  closed_by_name text,
  closed_at timestamptz,
  created_by uuid references self_audit_users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists self_audit_verification_requests_status_idx on self_audit_verification_requests (status, created_at desc);
create index if not exists self_audit_verification_requests_branch_idx on self_audit_verification_requests (branch_id, created_at desc);

alter table self_audit_verification_requests enable row level security;
create policy "read verification requests" on self_audit_verification_requests for select using (
  (select current_user_role()::text) in ('officer', 'technical')
  or ((select current_user_role()::text) in ('workshop_supervisor', 'team_leader') and branch_id = (select current_user_branch_id()))
);

-- Photos: private bucket, served through short-lived signed links made by the server.
insert into storage.buckets (id, name, public) values ('verification-photos', 'verification-photos', false)
on conflict (id) do nothing;
