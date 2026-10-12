-- Sends one feedback message with its attachments in a single transaction, so a
-- failure can never leave a feedback saved without its files' records. Runs as
-- the caller (security invoker): the 0077 RLS policies still decide whether the
-- insert is allowed - only a branch admin, only as themselves, only for their
-- own branch.
create or replace function public.submit_feedback(
  p_id uuid,
  p_subject text,
  p_body text,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_prefix text := v_user::text || '/' || p_id::text || '/';
  a jsonb;
begin
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Attachments must be a list.';
  end if;
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 3 then
    raise exception 'You can attach at most 3 files.';
  end if;

  insert into self_audit_feedback (id, sender_id, branch_id, subject, body)
  values (p_id, v_user, current_user_branch_id(), btrim(p_subject), btrim(p_body));

  for a in select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    if (a->>'path') not like v_prefix || '%' then
      raise exception 'Invalid attachment path.';
    end if;
    insert into self_audit_feedback_attachments (feedback_id, storage_path, file_name, mime_type, size_bytes)
    values (p_id, a->>'path', a->>'name', a->>'type', (a->>'size')::bigint);
  end loop;

  return p_id;
end;
$$;

revoke all on function public.submit_feedback(uuid, text, text, jsonb) from public, anon;
grant execute on function public.submit_feedback(uuid, text, text, jsonb) to authenticated;
