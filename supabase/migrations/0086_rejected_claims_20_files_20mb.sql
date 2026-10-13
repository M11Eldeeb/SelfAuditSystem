-- Rejected Claims Diary: up to 20 attachments per entry or comment, 20 MB each
-- (was 5 and 10 MB). The files live in Google Drive, so this does not use Supabase storage.

alter table self_audit_rejected_claim_attachments drop constraint self_audit_rejected_claim_attachments_size_bytes_check;
alter table self_audit_rejected_claim_attachments
  add constraint self_audit_rejected_claim_attachments_size_bytes_check check (size_bytes >= 1 and size_bytes <= 20971520);

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
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 20 then
    raise exception 'You can attach at most 20 files.';
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
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 20 then
    raise exception 'You can attach at most 20 files.';
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
