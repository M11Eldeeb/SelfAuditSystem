-- Technician claims for someone who is not a technician (e.g. a branch's warranty admin who also repairs): he may
-- submit claims as a technician of his branch, next to his own role.
alter table self_audit_users add column if not exists tech_submit boolean not null default false;
