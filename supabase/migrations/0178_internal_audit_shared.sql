-- Internal audit: every warranty officer may work on an audit in progress (several officers at the same time), not only
-- the one who started it. Still refused once the audit is finalized.
create or replace function public.save_internal_audit_claim_answers(p_audit_id uuid, p_claim_id uuid, p_answers jsonb, p_touch_note boolean, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status into v_status from self_audit_internal_audits where id = p_audit_id;
  if v_status is null then
    raise exception 'Internal audit not found.';
  end if;
  if v_status = 'finalized' then
    raise exception 'This audit has already been finalized.';
  end if;
  if current_user_role() is distinct from 'officer'::user_role then
    raise exception 'Only a warranty officer can edit an internal audit.';
  end if;

  insert into self_audit_internal_audit_answers (internal_audit_claim_id, question_id, answer_value, updated_at)
  select p_claim_id, entry.key, entry.value, now()
  from jsonb_each_text(p_answers) as entry
  on conflict (internal_audit_claim_id, question_id)
  do update set answer_value = excluded.answer_value, updated_at = excluded.updated_at;

  if p_touch_note then
    insert into self_audit_internal_audit_notes (internal_audit_claim_id, note_text, updated_at)
    values (p_claim_id, p_note, now())
    on conflict (internal_audit_claim_id)
    do update set note_text = excluded.note_text, updated_at = excluded.updated_at;
  end if;
end;
$function$;
