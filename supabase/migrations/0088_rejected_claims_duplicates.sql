-- Logging the same work order again is allowed after a warning: the repeat is saved as
-- <work order>-1, -2, -3 ... and remembers which work order it repeats.

alter table self_audit_rejected_claims add column duplicate_of text
  check (duplicate_of is null or duplicate_of = upper(btrim(duplicate_of)));

-- The function gains a parameter, so the old version must go (a second overload
-- with a different argument list would make calls ambiguous).
drop function public.add_rejected_claim(uuid, uuid, text, text, date, text, jsonb);

create or replace function public.add_rejected_claim(
  p_id uuid,
  p_branch_id uuid,
  p_work_order text,
  p_claim_no text,
  p_date date,
  p_reason text,
  p_attachments jsonb default '[]'::jsonb,
  p_duplicate_of text default null
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

  insert into self_audit_rejected_claims (id, branch_id, work_order_no, claim_no, rejection_date, reason, created_by, created_by_name, duplicate_of)
  values (p_id, p_branch_id, upper(btrim(p_work_order)), nullif(btrim(coalesce(p_claim_no, '')), ''), p_date, btrim(p_reason), v_user, v_name,
          nullif(upper(btrim(coalesce(p_duplicate_of, ''))), ''));

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

revoke all on function public.add_rejected_claim(uuid, uuid, text, text, date, text, jsonb, text) from public, anon;
grant execute on function public.add_rejected_claim(uuid, uuid, text, text, date, text, jsonb, text) to authenticated;
