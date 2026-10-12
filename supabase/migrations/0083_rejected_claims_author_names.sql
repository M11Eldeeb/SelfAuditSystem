-- Show who wrote an entry or comment without letting every user read the users
-- table: the author's display name and role are copied onto the row when it is
-- written (the caller can always read their own profile). The diary is a
-- permanent record, so a name stored at the time is also what history should show.

alter table self_audit_rejected_claims add column created_by_name text;
alter table self_audit_rejected_claim_comments add column author_name text;
alter table self_audit_rejected_claim_comments add column author_role text;

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
  v_name text;
  v_role text;
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

  select coalesce(nullif(btrim(full_name), ''), email), role::text into v_name, v_role from self_audit_users where id = v_user;

  insert into self_audit_rejected_claim_comments (id, entry_id, author_id, author_name, author_role, body)
  values (p_id, p_entry_id, v_user, v_name, v_role, btrim(p_body));

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
