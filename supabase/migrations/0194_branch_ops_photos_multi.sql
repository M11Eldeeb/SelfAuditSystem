-- Branch operations photos may hold several files per photo type, so the table's key (cycle, branch, photo type) is
-- replaced by a row id. The app no longer uses ON CONFLICT on this table.
alter table self_audit_branch_operation_photos add column if not exists id uuid not null default gen_random_uuid();
alter table self_audit_branch_operation_photos drop constraint if exists branch_operation_photos_pkey;
alter table self_audit_branch_operation_photos add primary key (id);
create index if not exists branch_operation_photos_lookup on self_audit_branch_operation_photos (cycle_id, branch_id, photo_type_id);
