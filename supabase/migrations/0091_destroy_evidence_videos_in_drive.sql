-- Destroy-evidence videos now live in the company's Google Shared Drive
-- (Scrap evidence / <MM-YYYY> / <branch>), not in Supabase storage. A video row
-- therefore holds a Drive file id instead of a storage path, and the storage
-- policies that let branches and officers touch destroy-evidence files go away.

do $$
begin
  if exists (select 1 from self_audit_destroy_evidence_videos) then
    raise exception 'There are still destroy-evidence videos in the old storage - move or remove them before running this migration.';
  end if;
end $$;

alter table self_audit_destroy_evidence_videos
  drop column video_path,
  add column drive_file_id text not null,
  add column drive_url text,
  add column file_name text not null,
  add column mime_type text not null,
  add column size_bytes bigint not null check (size_bytes > 0);

drop policy "branch admins manage own destroy evidence files" on storage.objects;
drop policy "officers manage destroy evidence files" on storage.objects;
