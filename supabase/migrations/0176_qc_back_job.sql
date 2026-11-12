-- Quality control: the purpose is now Quality Control or Back Job (older purposes stay valid for records already saved).
alter table self_audit_qc_checks drop constraint if exists self_audit_qc_checks_purpose_check;
alter table self_audit_qc_checks add constraint self_audit_qc_checks_purpose_check check (purpose in ('quality_control', 'back_job', 'test_drive_customer', 'test_drive_pre_repair', 'test_drive_post_repair', 'comeback', 'diagnosis_verification'));
