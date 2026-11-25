-- Quality control: a QC closed as failed carries its root cause analysis - the 5 Whys, the root cause, the solution and who
-- it is assigned to (a team leader or workshop supervisor of the branch). One analysis per case, kept on the QC itself.
alter table self_audit_qc_checks add column if not exists rca_whys jsonb;
alter table self_audit_qc_checks add column if not exists rca_root_cause text;
alter table self_audit_qc_checks add column if not exists rca_solution text;
alter table self_audit_qc_checks add column if not exists rca_assigned_to uuid references self_audit_users (id) on delete set null;
alter table self_audit_qc_checks add column if not exists rca_assigned_name text;
alter table self_audit_qc_checks add column if not exists rca_assigned_role text;
