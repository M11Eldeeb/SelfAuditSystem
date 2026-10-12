-- Rejected Claims Diary: a permanent log of work orders a branch rejected at the
-- workshop before they ever reached the warranty team, with comments and
-- attachments that can be added at any time, so the reason is still there if
-- the customer complains months later.
--
--   self_audit_rejected_claims             one entry per work order per branch
--   self_audit_rejected_claim_comments     thread under an entry
--   self_audit_rejected_claim_attachments  files (Supabase storage now; the
--                                          storage column lets Google Drive
--                                          take over later)
--
-- It is a record: nothing here can be edited or deleted by anyone (RLS has no
-- update/delete policies and a trigger blocks it for every role). A mistake is
-- corrected with a new comment.
--
-- Visibility: a branch admin sees and adds only their own branch's entries;
-- officers see and add everything. Branch admins are locked out ("coming soon")
-- until the self_audit_feature_flags row 'rejected_claims_branch_admins' is
-- switched on - enforced here, not just on the screen.

create table self_audit_feature_flags (
  key text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table self_audit_feature_flags enable row level security;
create policy "signed-in users read feature flags" on self_audit_feature_flags for select
  using ((select auth.role()) = 'authenticated');
create policy "officers manage feature flags" on self_audit_feature_flags for all
  using ((select current_user_role()) is not distinct from 'officer')
  with check ((select current_user_role()) is not distinct from 'officer');
insert into self_audit_feature_flags (key, enabled) values ('rejected_claims_branch_admins', false);

create or replace function public.feature_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select enabled from self_audit_feature_flags where key = p_key), false);
$$;
revoke all on function public.feature_enabled(text) from public, anon;
grant execute on function public.feature_enabled(text) to authenticated;

create table self_audit_rejected_claims (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references self_audit_branches (id) on delete restrict,
  work_order_no text not null check (work_order_no = upper(btrim(work_order_no)) and char_length(work_order_no) between 1 and 40),
  claim_no text check (claim_no is null or char_length(claim_no) between 1 and 40),
  rejection_date date not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 2000),
  created_by uuid references self_audit_users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (branch_id, work_order_no)
);
create index self_audit_rejected_claims_branch_idx on self_audit_rejected_claims (branch_id, rejection_date desc);
create index self_audit_rejected_claims_date_idx on self_audit_rejected_claims (rejection_date desc, created_at desc);

create table self_audit_rejected_claim_comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references self_audit_rejected_claims (id) on delete restrict,
  author_id uuid references self_audit_users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index self_audit_rejected_claim_comments_entry_idx on self_audit_rejected_claim_comments (entry_id, created_at);

create table self_audit_rejected_claim_attachments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references self_audit_rejected_claims (id) on delete restrict,
  comment_id uuid references self_audit_rejected_claim_comments (id) on delete restrict,
  storage text not null default 'supabase' check (storage in ('supabase', 'drive')),
  storage_path text,
  drive_file_id text,
  drive_url text,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid references self_audit_users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((storage = 'supabase' and storage_path is not null) or (storage = 'drive' and drive_file_id is not null))
);
create index self_audit_rejected_claim_attachments_entry_idx on self_audit_rejected_claim_attachments (entry_id);
create index self_audit_rejected_claim_attachments_path_idx on self_audit_rejected_claim_attachments (storage_path);

-- A permanent record: no edits, no deletes, for any role (service role included).
create or replace function public.rejected_claims_are_permanent()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The rejected claims diary is a permanent record - add a comment instead.';
end;
$$;
create trigger rejected_claims_permanent before update or delete on self_audit_rejected_claims
  for each row execute function public.rejected_claims_are_permanent();
create trigger rejected_claim_comments_permanent before update or delete on self_audit_rejected_claim_comments
  for each row execute function public.rejected_claims_are_permanent();
create trigger rejected_claim_attachments_permanent before update or delete on self_audit_rejected_claim_attachments
  for each row execute function public.rejected_claims_are_permanent();

alter table self_audit_rejected_claims enable row level security;
alter table self_audit_rejected_claim_comments enable row level security;
alter table self_audit_rejected_claim_attachments enable row level security;

-- Entries
create policy "officers read rejected claims" on self_audit_rejected_claims for select
  using ((select current_user_role()) is not distinct from 'officer');
create policy "officers add rejected claims" on self_audit_rejected_claims for insert
  with check ((select current_user_role()) is not distinct from 'officer' and created_by = (select auth.uid()));
create policy "branch admins read own rejected claims" on self_audit_rejected_claims for select
  using (
    (select current_user_role()) is not distinct from 'branch_admin'
    and branch_id = (select current_user_branch_id())
    and feature_enabled('rejected_claims_branch_admins')
  );
create policy "branch admins add own rejected claims" on self_audit_rejected_claims for insert
  with check (
    (select current_user_role()) is not distinct from 'branch_admin'
    and branch_id = (select current_user_branch_id())
    and created_by = (select auth.uid())
    and feature_enabled('rejected_claims_branch_admins')
  );

-- Comments and attachments: allowed exactly where the entry itself is visible
-- (the subquery runs under the caller's RLS on entries).
create policy "read comments of visible entries" on self_audit_rejected_claim_comments for select
  using (exists (select 1 from self_audit_rejected_claims e where e.id = entry_id));
create policy "comment on visible entries" on self_audit_rejected_claim_comments for insert
  with check (author_id = (select auth.uid()) and exists (select 1 from self_audit_rejected_claims e where e.id = entry_id));
create policy "read attachments of visible entries" on self_audit_rejected_claim_attachments for select
  using (exists (select 1 from self_audit_rejected_claims e where e.id = entry_id));
create policy "attach to visible entries" on self_audit_rejected_claim_attachments for insert
  with check (uploaded_by = (select auth.uid()) and exists (select 1 from self_audit_rejected_claims e where e.id = entry_id));

-- Log an entry and its files in one transaction. Runs as the caller, so the
-- policies above decide whether it is allowed.
create or replace function public.add_rejected_claim(
  p_id uuid,
  p_branch_id uuid,
  p_work_order text,
  p_claim_no text,
  p_date date,
  p_reason text,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_prefix text := p_branch_id::text || '/' || p_id::text || '/';
  a jsonb;
begin
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Attachments must be a list.';
  end if;
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 5 then
    raise exception 'You can attach at most 5 files.';
  end if;
  if p_date > (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'The rejection date cannot be in the future.';
  end if;

  insert into self_audit_rejected_claims (id, branch_id, work_order_no, claim_no, rejection_date, reason, created_by)
  values (p_id, p_branch_id, upper(btrim(p_work_order)), nullif(btrim(coalesce(p_claim_no, '')), ''), p_date, btrim(p_reason), v_user);

  for a in select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    if (a->>'path') not like v_prefix || '%' then
      raise exception 'Invalid attachment path.';
    end if;
    insert into self_audit_rejected_claim_attachments (entry_id, storage, storage_path, file_name, mime_type, size_bytes, uploaded_by)
    values (p_id, 'supabase', a->>'path', a->>'name', a->>'type', (a->>'size')::bigint, v_user);
  end loop;
  return p_id;
end;
$$;

create or replace function public.add_rejected_claim_comment(
  p_id uuid,
  p_entry_id uuid,
  p_body text,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_branch uuid;
  v_prefix text;
  a jsonb;
begin
  select e.branch_id into v_branch from self_audit_rejected_claims e where e.id = p_entry_id;
  if v_branch is null then
    raise exception 'Entry not found.';
  end if;
  v_prefix := v_branch::text || '/' || p_entry_id::text || '/';
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Attachments must be a list.';
  end if;
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 5 then
    raise exception 'You can attach at most 5 files.';
  end if;

  insert into self_audit_rejected_claim_comments (id, entry_id, author_id, body) values (p_id, p_entry_id, v_user, btrim(p_body));

  for a in select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    if (a->>'path') not like v_prefix || '%' then
      raise exception 'Invalid attachment path.';
    end if;
    insert into self_audit_rejected_claim_attachments (entry_id, comment_id, storage, storage_path, file_name, mime_type, size_bytes, uploaded_by)
    values (p_entry_id, p_id, 'supabase', a->>'path', a->>'name', a->>'type', (a->>'size')::bigint, v_user);
  end loop;
  return p_id;
end;
$$;

revoke all on function public.add_rejected_claim(uuid, uuid, text, text, date, text, jsonb) from public, anon;
revoke all on function public.add_rejected_claim_comment(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.add_rejected_claim(uuid, uuid, text, text, date, text, jsonb) to authenticated;
grant execute on function public.add_rejected_claim_comment(uuid, uuid, text, jsonb) to authenticated;

-- Files: private bucket, 10 MB each, photos / PDFs / videos. Path:
-- {branch id}/{entry id}/{file}. Nobody can delete from the app - it is a record.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rejected-claims-files', 'rejected-claims-files', false, 10485760, array['image/*', 'application/pdf', 'video/*']);

create policy "officers read rejected claim files" on storage.objects for select
  using (bucket_id = 'rejected-claims-files' and (select current_user_role()) is not distinct from 'officer');
create policy "officers add rejected claim files" on storage.objects for insert
  with check (bucket_id = 'rejected-claims-files' and (select current_user_role()) is not distinct from 'officer');
create policy "branch admins read own rejected claim files" on storage.objects for select
  using (
    bucket_id = 'rejected-claims-files'
    and (select current_user_role()) is not distinct from 'branch_admin'
    and (storage.foldername(name))[1] = (select current_user_branch_id())::text
    and feature_enabled('rejected_claims_branch_admins')
  );
create policy "branch admins add own rejected claim files" on storage.objects for insert
  with check (
    bucket_id = 'rejected-claims-files'
    and (select current_user_role()) is not distinct from 'branch_admin'
    and (storage.foldername(name))[1] = (select current_user_branch_id())::text
    and feature_enabled('rejected_claims_branch_admins')
  );

-- Files uploaded but never saved with an entry (failed or abandoned send), for
-- the daily cleanup job. Service role only; same idea as get_orphan_feedback_files.
create or replace function public.get_orphan_rejected_claim_files(p_older_than interval default interval '24 hours')
returns setof text
language sql
stable
security definer
set search_path = public, storage
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'rejected-claims-files'
    and o.created_at < now() - p_older_than
    and not exists (select 1 from self_audit_rejected_claim_attachments a where a.storage_path = o.name)
  order by o.created_at
  limit 1000;
$$;
revoke all on function public.get_orphan_rejected_claim_files(interval) from public, anon, authenticated;
grant execute on function public.get_orphan_rejected_claim_files(interval) to service_role;
