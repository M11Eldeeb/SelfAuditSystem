-- Quality control: a QC can be closed without a pass (with a justification) - result "close", status "closed".
alter table self_audit_qc_checks drop constraint if exists self_audit_qc_checks_status_check;
alter table self_audit_qc_checks add constraint self_audit_qc_checks_status_check check (status in ('failed', 'passed', 'closed'));
alter table self_audit_qc_tests drop constraint if exists self_audit_qc_tests_result_check;
alter table self_audit_qc_tests add constraint self_audit_qc_tests_result_check check (result in ('pass', 'fail', 'close'));
alter table self_audit_qc_checks add column if not exists closed_at timestamptz;
