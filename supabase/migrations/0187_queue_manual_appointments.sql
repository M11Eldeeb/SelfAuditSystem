-- Customer queue appointments made by hand: a service advisor or the queue (reception) manager adds one that is not in
-- the DMS sheet. Marked 'manual', with who added it (they, or a manager, may delete it).
alter table self_audit_queue_appointments drop constraint if exists self_audit_queue_appointments_source_check;
alter table self_audit_queue_appointments add constraint self_audit_queue_appointments_source_check check (source in ('mail', 'upload', 'manual'));
alter table self_audit_queue_appointments add column if not exists created_by uuid references self_audit_users (id) on delete set null;
alter table self_audit_queue_appointments add column if not exists created_by_name text;
