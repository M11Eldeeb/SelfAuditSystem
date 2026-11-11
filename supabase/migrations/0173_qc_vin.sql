-- Quality control: the vehicle's VIN (read from the job card photo, or typed).
alter table self_audit_qc_checks add column if not exists vin text;
create index if not exists self_audit_qc_checks_vin_idx on self_audit_qc_checks (vin);
