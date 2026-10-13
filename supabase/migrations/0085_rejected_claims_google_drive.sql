-- Rejected Claims Diary attachments move to the company's Google Drive.
--
--   self_audit_google_drive_connection  the one connected Google account (its OAuth
--                                       refresh token). RLS on and NO policies: only the
--                                       server's service role can read or write it.
--   self_audit_drive_folders            Drive folder ids already created
--                                       (root / branch / work order), keyed by name
--   add_rejected_claim(_comment)        now take Google Drive attachments
--
-- Uploads to the Supabase bucket are switched off by dropping its insert policies,
-- so the diary can no longer fill the free storage. Reads stay (nothing is stored there).

create table self_audit_google_drive_connection (
  id smallint primary key default 1 check (id = 1),
  refresh_token text not null,
  account_email text not null,
  root_folder_id text not null,
  connected_by uuid references self_audit_users (id) on delete set null,
  connected_at timestamptz not null default now()
);
alter table self_audit_google_drive_connection enable row level security;

create table self_audit_drive_folders (
  key text primary key,
  drive_id text not null,
  created_at timestamptz not null default now()
);
alter table self_audit_drive_folders enable row level security;

drop policy "officers add rejected claim files" on storage.objects;
drop policy "branch admins add own rejected claim files" on storage.objects;

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
  v_name text;
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

  select coalesce(nullif(btrim(full_name), ''), email) into v_name from self_audit_users where id = v_user;

  insert into self_audit_rejected_claims (id, branch_id, work_order_no, claim_no, rejection_date, reason, created_by, created_by_name)
  values (p_id, p_branch_id, upper(btrim(p_work_order)), nullif(btrim(coalesce(p_claim_no, '')), ''), p_date, btrim(p_reason), v_user, v_name);

  for a in select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    if coalesce(a->>'driveFileId', '') = '' then
      raise exception 'Invalid attachment.';
    end if;
    insert into self_audit_rejected_claim_attachments (entry_id, storage, drive_file_id, drive_url, file_name, mime_type, size_bytes, uploaded_by)
    values (p_id, 'drive', a->>'driveFileId', a->>'driveUrl', a->>'name', a->>'type', (a->>'size')::bigint, v_user);
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
  v_exists boolean;
  v_name text;
  v_role text;
  a jsonb;
begin
  select true into v_exists from self_audit_rejected_claims e where e.id = p_entry_id;
  if v_exists is not true then
    raise exception 'Entry not found.';
  end if;
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Attachments must be a list.';
  end if;
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 5 then
    raise exception 'You can attach at most 5 files.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email), role::text into v_name, v_role from self_audit_users where id = v_user;

  insert into self_audit_rejected_claim_comments (id, entry_id, author_id, author_name, author_role, body)
  values (p_id, p_entry_id, v_user, v_name, v_role, btrim(p_body));

  for a in select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    if coalesce(a->>'driveFileId', '') = '' then
      raise exception 'Invalid attachment.';
    end if;
    insert into self_audit_rejected_claim_attachments (entry_id, comment_id, storage, drive_file_id, drive_url, file_name, mime_type, size_bytes, uploaded_by)
    values (p_entry_id, p_id, 'drive', a->>'driveFileId', a->>'driveUrl', a->>'name', a->>'type', (a->>'size')::bigint, v_user);
  end loop;
  return p_id;
end;
$$;
