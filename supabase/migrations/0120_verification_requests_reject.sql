-- Verification code requests can be rejected (with a reason) by the technical team or an officer; branch admins can
-- send requests too (from Technical Inquiries). closed_at / closed_by record who answered, either way.
alter table self_audit_verification_requests drop constraint if exists self_audit_verification_requests_status_check;
alter table self_audit_verification_requests add constraint self_audit_verification_requests_status_check check (status in ('open', 'closed', 'rejected'));
alter table self_audit_verification_requests add column if not exists reject_reason text;

drop policy if exists "read verification requests" on self_audit_verification_requests;
create policy "read verification requests" on self_audit_verification_requests for select using (
  (select current_user_role()::text) in ('officer', 'technical')
  or ((select current_user_role()::text) in ('branch_admin', 'workshop_supervisor', 'team_leader') and branch_id = (select current_user_branch_id()))
);
