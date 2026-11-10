-- Service advisor: one branch; sees the branch dashboard (read only), Complaints, VOR Part Query, Open WIPs and Courtesy Cars.
alter type user_role add value if not exists 'service_advisor';

alter table self_audit_users drop constraint if exists branch_admin_requires_branch;
alter table self_audit_users add constraint branch_admin_requires_branch check (
  (role::text = any (array['branch_admin', 'workshop_supervisor', 'team_leader', 'service_manager', 'technician', 'claims_reviewer', 'service_advisor']) and branch_id is not null)
  or role::text = any (array['officer', 'finance', 'technical'])
);
