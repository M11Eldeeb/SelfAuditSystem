-- A claim's Parts Requisition may now hold several files, so self_audit_audit_photos can hold several rows per
-- (assignment, photo type). Every other document type still takes exactly one file: the unique key stays for them
-- (as a partial index). The app no longer uses ON CONFLICT on this table.
alter table self_audit_audit_photos drop constraint if exists audit_photos_assignment_id_photo_type_id_key;

create unique index if not exists audit_photos_single_file_key
  on self_audit_audit_photos (assignment_id, photo_type_id)
  where photo_type_id <> 'photo_parts_requisition';
