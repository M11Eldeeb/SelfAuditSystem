-- Combines the "is this officer allowed to edit this audit" check with the
-- answers/note writes into one database round trip instead of two separate
-- ones from the server action. This also closes a latent gap: RLS on
-- self_audit_internal_audit_answers/_notes only requires the caller to be
-- *an* officer, not specifically the officer who started this audit - that
-- narrower ownership rule has only ever been enforced in application code.
-- Running the check inside the same transaction as the write (via
-- security definer, like current_user_role()/current_user_branch_id())
-- closes that gap rather than widening it.
create or replace function public.save_internal_audit_claim_answers(
  p_audit_id uuid,
  p_claim_id uuid,
  p_answers jsonb,
  p_touch_note boolean,
  p_note text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_auditor_id uuid;
begin
  select status, auditor_id into v_status, v_auditor_id
  from self_audit_internal_audits
  where id = p_audit_id;

  if v_status is null then
    raise exception 'Internal audit not found.';
  end if;
  if v_status = 'finalized' then
    raise exception 'This audit has already been finalized.';
  end if;
  if v_auditor_id is distinct from auth.uid() then
    raise exception 'Only the officer who started this audit can edit it.';
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
$$;
