-- Self audit documents (claim photos and branch operations photos) are also saved to Google Drive: My Drive / Self
-- Audit Documents / <month> / <branch> / <claim - work order> (or "Branch operations"). drive_file_id is the copy;
-- when a photo is replaced (new storage path) it is cleared, so the new one is copied again.
alter table self_audit_audit_photos add column if not exists drive_file_id text;
alter table self_audit_branch_operation_photos add column if not exists drive_file_id text;

create or replace function public.reset_photo_drive_copy()
 returns trigger
 language plpgsql
as $$
begin
  if new.storage_path is distinct from old.storage_path then
    new.drive_file_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_photos_reset_drive on self_audit_audit_photos;
create trigger audit_photos_reset_drive before update on self_audit_audit_photos
  for each row execute function public.reset_photo_drive_copy();
drop trigger if exists branch_ops_photos_reset_drive on self_audit_branch_operation_photos;
create trigger branch_ops_photos_reset_drive before update on self_audit_branch_operation_photos
  for each row execute function public.reset_photo_drive_copy();
