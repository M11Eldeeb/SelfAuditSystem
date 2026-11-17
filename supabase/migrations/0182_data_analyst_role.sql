-- Data Analyst: an account without a branch that sees the Sub-Dealer Analytics page only. The page reads its data on the
-- server, so the role needs no table access of its own: current_user_role() hands it back as it is, which no policy
-- matches. (It can still send feedback: that policy is open to every signed-in user.)
alter table self_audit_users drop constraint branch_admin_requires_branch;
alter table self_audit_users add constraint branch_admin_requires_branch check (
  (role::text in ('branch_admin', 'workshop_supervisor', 'team_leader', 'service_manager', 'technician', 'claims_reviewer', 'service_advisor', 'quality_controller') and branch_id is not null)
  or role::text in ('officer', 'finance', 'technical', 'manager', 'national_manager', 'data_analyst')
);
