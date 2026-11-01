-- The claims reviewer belongs to one branch, like the other branch roles.
alter table self_audit_users drop constraint if exists branch_admin_requires_branch;
alter table self_audit_users add constraint branch_admin_requires_branch check (
  (role::text = any (array['branch_admin', 'workshop_supervisor', 'team_leader', 'service_manager', 'technician', 'claims_reviewer']) and branch_id is not null)
  or role::text = any (array['officer', 'finance', 'technical'])
);
