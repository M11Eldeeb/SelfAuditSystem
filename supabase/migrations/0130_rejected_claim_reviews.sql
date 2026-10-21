-- Reconciliation → Rejected claims: SAIC-rejected claims (claims export status "Rejected...") must be reviewed within 30 days
-- of their verification date - after that the claim is closed and no appeal is possible. The officer marks each one as
-- resolved, appeal submitted or confirmed rejection, with notes.
create table if not exists self_audit_rejected_claim_reviews (
  claim_id uuid primary key references self_audit_claims (id) on delete cascade,
  status text check (status in ('resolved', 'appeal_submitted', 'confirmed_rejection')),
  note text,
  updated_by uuid references self_audit_users (id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
alter table self_audit_rejected_claim_reviews enable row level security;
create policy "officers read rejected claim reviews" on self_audit_rejected_claim_reviews for select using ((select current_user_role()::text) = 'officer');
