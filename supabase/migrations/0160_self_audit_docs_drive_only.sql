-- Self audit documents are stored in Google Drive only: storage_path is "drive:<file id>.<ext>" and drive_file_id the
-- Drive file. A replaced photo in Supabase (old style) still clears the Drive copy; a Drive path keeps its id.
create or replace function public.reset_photo_drive_copy()
 returns trigger
 language plpgsql
as $$
begin
  if new.storage_path is distinct from old.storage_path and new.storage_path not like 'drive:%' then
    new.drive_file_id := null;
  end if;
  return new;
end;
$$;
