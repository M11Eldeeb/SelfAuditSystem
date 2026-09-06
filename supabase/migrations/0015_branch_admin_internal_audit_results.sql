-- Lets a branch admin see their OWN branch's finalized internal audit
-- results (read-only) - internal audit is otherwise officer-only. These are
-- additive SELECT policies alongside the existing officer "for all" ones.

create policy "branch admins read own finalized internal_audits" on self_audit_internal_audits for select
  using (branch_id = current_user_branch_id() and status = 'finalized');

create policy "branch admins read own finalized internal_audit_claims" on self_audit_internal_audit_claims for select
  using (exists (
    select 1 from self_audit_internal_audits ia
    where ia.id = internal_audit_id and ia.branch_id = current_user_branch_id() and ia.status = 'finalized'
  ));

create policy "branch admins read own finalized internal_audit_answers" on self_audit_internal_audit_answers for select
  using (exists (
    select 1 from self_audit_internal_audit_claims iac
    join self_audit_internal_audits ia on ia.id = iac.internal_audit_id
    where iac.id = internal_audit_claim_id and ia.branch_id = current_user_branch_id() and ia.status = 'finalized'
  ));

create policy "branch admins read own finalized internal_audit_notes" on self_audit_internal_audit_notes for select
  using (exists (
    select 1 from self_audit_internal_audit_claims iac
    join self_audit_internal_audits ia on ia.id = iac.internal_audit_id
    where iac.id = internal_audit_claim_id and ia.branch_id = current_user_branch_id() and ia.status = 'finalized'
  ));

create policy "branch admins read own finalized internal_audit_branch_answers" on self_audit_internal_audit_branch_answers for select
  using (exists (
    select 1 from self_audit_internal_audits ia
    where ia.id = internal_audit_id and ia.branch_id = current_user_branch_id() and ia.status = 'finalized'
  ));

create policy "branch admins read own finalized internal_audit_department_remarks" on self_audit_internal_audit_department_remarks for select
  using (exists (
    select 1 from self_audit_internal_audits ia
    where ia.id = internal_audit_id and ia.branch_id = current_user_branch_id() and ia.status = 'finalized'
  ));
