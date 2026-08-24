-- 1. Lets audit_photos rows survive after their storage bytes are deleted
--    (officer review triggers cleanup - see src/lib/photo-cleanup.ts), so the
--    UI can tell "was uploaded, cleaned up after review" apart from "never
--    uploaded".
-- 2. Adds a scope to audit_photo_types (mirrors audit_questions.scope) and
--    seeds the 3 branch-operation photos.
-- 3. Adds branch_operation_photos to hold those, with the same lifecycle.

alter table audit_photos add column if not exists deleted_at timestamptz;

alter table audit_photo_types add column if not exists scope text not null default 'claim';

insert into audit_photo_types (id, sort_order, scope, label, help_text, required)
values
  ('photo_scrapping', 1, 'branch', 'Scrapping area photo', 'Photo of the scrapped-parts staging/disposal area.', true),
  ('photo_warranty_room', 2, 'branch', 'Warranty room photo', 'Photo of the warranty parts storage room.', true),
  ('photo_warranty_archive', 3, 'branch', 'Warranty archive documents photo', 'Photo of the archived/filed job card documents.', true);

create table branch_operation_photos (
  cycle_id uuid not null references audit_cycles (id) on delete cascade,
  branch_id uuid not null references branches (id),
  photo_type_id text not null references audit_photo_types (id),
  storage_path text not null,
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (cycle_id, branch_id, photo_type_id)
);

alter table branch_operation_photos enable row level security;

create policy "officers manage branch_operation_photos" on branch_operation_photos for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins manage own branch_operation_photos" on branch_operation_photos for all
  using (branch_id = current_user_branch_id())
  with check (branch_id = current_user_branch_id());

-- Branch-ops photo files live at branch-ops/{branchId}/{cycleId}/{photoTypeId}.ext
-- in the same bucket as claim photos. Cleanup after review runs via the
-- service role, so only the branch admin's own upload/read policy is needed
-- here.
create policy "branch admins manage own branch ops photo files" on storage.objects for all
  using (
    bucket_id = 'audit-photos'
    and (storage.foldername(name)) [1] = 'branch-ops'
    and (storage.foldername(name)) [2] = current_user_branch_id()::text
  )
  with check (
    bucket_id = 'audit-photos'
    and (storage.foldername(name)) [1] = 'branch-ops'
    and (storage.foldername(name)) [2] = current_user_branch_id()::text
  );
